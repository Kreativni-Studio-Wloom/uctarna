import 'server-only';
import { HttpError, compact, newDocumentId, paths, ts, type Db } from './db';
import { incrementSoldCounts, prepareNewSaleEet } from './finalize';
import { hasEetIdentity, isEetEnabled } from './flags';
import { registerSale, type RegisterOptions, type RegisterOutcome } from './register';
import type { CartItem, Sale, SaleEet, Store } from '@/types';

/*
 * Storno dokladu (místo mazání u prodejny s EET): nový doklad se zápornou částkou, novým
 * číslem a aktuálním časem. Původní doklad zůstane a dostane `storno: {by, at, saleId}`.
 * Do EET jde jen hotovostní vratka; bezhotovostní (karta, QR) se neeviduje (kap. 2.2).
 * Idempotentní: druhé storno téhož dokladu vrátí to první.
 */

export const PRE_EET_STORNO_REASON = 'Původní doklad byl vystaven před zapnutím EET';
export const NON_CASH_REFUND_REASON = 'Bezhotovostní vratka (karta / QR) se do EET neeviduje';

const neg = (v: unknown) => (typeof v === 'number' && v !== 0 ? -v : v);

/** Záporný doklad k `original` (čistá funkce, bez createdAt/receiptNo/eet). */
export function buildStornoSale(original: Partial<Sale>, originalId: string, documentId: string, uid: string, storeId: string) {
  const items = (original.items ?? []).map((item: CartItem) => ({ ...item, quantity: -item.quantity }));
  const finalAmount = typeof original.finalAmount === 'number' ? -original.finalAmount : undefined;
  const total = typeof original.totalAmount === 'number' ? -original.totalAmount : 0;
  return compact({
    items,
    totalAmount: total,
    paymentMethod: original.paymentMethod ?? 'cash',
    currency: original.currency ?? 'CZK',
    eurRate: original.eurRate ?? null,
    originalAmountCZK: neg(original.originalAmountCZK) ?? null,
    documentId,
    storeId,
    userId: uid,
    customerName: original.customerName ?? null,
    isRefund: true,
    refundAmount: Math.abs(finalAmount ?? total),
    paidAmount: null,
    paidCurrency: null,
    changeAmount: null,
    changeAmountEUR: null,
    discount: original.discount ?? null,
    discountAmount: neg(original.discountAmount ?? 0),
    finalAmount,
    tipAmount: typeof original.tipAmount === 'number' ? -original.tipAmount : null,
    served: true,
    stornoOf: originalId,
  });
}

export interface StornoResult {
  saleId: string;
  receiptNo?: string;
  duplicate: boolean;
  eet?: SaleEet;
  registration?: RegisterOutcome;
}

export async function stornoSale(
  db: Db,
  uid: string,
  storeId: string,
  originalId: string,
  opts: { now?: () => Date; registerNow?: boolean; registerOptions?: RegisterOptions } = {}
): Promise<StornoResult> {
  const now = (opts.now ?? (() => new Date()))();
  const storeRef = db.doc(paths.store(uid, storeId));
  const originalRef = db.doc(paths.sale(uid, storeId, originalId));
  const stornoId = newDocumentId();
  const stornoRef = db.doc(paths.sale(uid, storeId, stornoId));

  const written = await db.runTransaction(async (tx) => {
    const storeSnap = await tx.get(storeRef);
    if (!storeSnap.exists) throw new HttpError(404, 'store_not_found', 'Prodejna nenalezena');
    const store = storeSnap.data() as Pick<Store, 'eet'>;

    const origSnap = await tx.get(originalRef);
    if (!origSnap.exists) throw new HttpError(404, 'sale_not_found', 'Doklad nenalezen');
    const original = origSnap.data() as Partial<Sale>;
    // Doklad s EET identitou se stornuje i při vypnutém EET (smazat ho nejde, viz saleRemovalPolicy).
    // Storno pak dostane číslo a zůstane 'pending'; fronta ho odešle až po opětovném zapnutí.
    if (!isEetEnabled(store) && !hasEetIdentity(original)) throw new HttpError(409, 'eet_disabled', 'EET není u prodejny zapnuté');
    if (original.storno?.saleId) {
      const prev = await tx.get(db.doc(paths.sale(uid, storeId, original.storno.saleId)));
      const d = prev.data() as Partial<Sale> | undefined;
      return { duplicate: true, saleId: original.storno.saleId, receiptNo: d?.receiptNo, eet: d?.eet };
    }
    if (original.stornoOf) throw new HttpError(400, 'is_storno', 'Storno nejde znovu stornovat');
    if (original.isTest === true) throw new HttpError(400, 'is_test', 'Testovací doklad se nestornuje, smažte ho');

    // Do EET jen hotovostní vratka reálného dokladu, který do EET patřil.
    // Doklad z doby před zapnutím EET (bez `eet`) se nikdy neevidoval, jeho storno tedy taky ne.
    const originalNotSent = original.eet?.status === 'not_required' || !original.eet;
    const reason =
      original.paymentMethod !== 'cash'
        ? NON_CASH_REFUND_REASON
        : originalNotSent
          ? original.eet?.reason ?? (original.eet ? 'Původní doklad se do EET neevidoval' : PRE_EET_STORNO_REASON)
          : undefined;
    const prepared = await prepareNewSaleEet(tx, db, uid, storeId, store, { notRequiredReason: reason, now });
    const doc = compact({
      ...buildStornoSale(original, originalId, stornoId, uid, storeId),
      createdAt: ts(now),
      ...prepared.fields,
    });
    prepared.commit();
    tx.set(stornoRef, doc);
    tx.update(originalRef, { storno: { by: uid, at: ts(now), saleId: stornoId } });
    return { duplicate: false, saleId: stornoId, receiptNo: prepared.fields.receiptNo, eet: prepared.fields.eet, items: original.items ?? [] };
  });

  if (!written.duplicate && 'items' in written) await incrementSoldCounts(db, uid, storeId, written.items as CartItem[], -1);

  let registration: RegisterOutcome | undefined;
  let eet = written.eet;
  if (opts.registerNow !== false && eet?.status === 'pending') {
    registration = await registerSale(db, uid, storeId, written.saleId, { mode: 'auto', ...opts.registerOptions });
    if (registration.eet) eet = registration.eet;
  }
  return { saleId: written.saleId, receiptNo: registration?.receiptNo ?? written.receiptNo, duplicate: written.duplicate, eet, registration };
}
