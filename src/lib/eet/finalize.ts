import 'server-only';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError, ID_RE, allocateReceiptNo, compact, paths, ts, type Db } from './db';
import { isEetEnabled, resolveEetSettings } from './flags';
import { registerSale, type RegisterOptions, type RegisterOutcome } from './register';
import type { CartItem, SaleEet, Store } from '@/types';

/*
 * Uložení prodeje u prodejny se zapnutým EET (/api/sales/finalize a SumUp callback).
 * V JEDNÉ transakci: kontrola duplicity (doc id = documentId), číslo dokladu z čítače,
 * zápis dokladu s `receiptNo` a `eet`. Po commitu best-effort `soldCount` a `registerSale`.
 */

/** Jak dlouho čeká 'pending' doklad, než ho převezme fronta (kdyby odeslání po uložení neproběhlo). */
export const PENDING_GRACE_MS = 60_000;

const num = z.number().finite();

const itemSchema = z
  .object({
    productId: z.string().min(1).max(200),
    productName: z.string().max(500),
    price: num,
    quantity: num,
    cost: num.nullable().optional(),
    itemId: z.string().max(200).optional(),
    parentItemId: z.string().max(200).nullable().optional(),
  })
  .passthrough();

/** Stejná pole jako dnešní `addDoc` v CheckoutModal (bez createdAt, storeId, userId – ty doplní server). */
export const saleDraftSchema = z.object({
  items: z.array(itemSchema).min(1).max(500),
  totalAmount: num,
  paymentMethod: z.enum(['cash', 'card', 'qr']),
  currency: z.enum(['CZK', 'EUR']),
  eurRate: num.positive().nullable(),
  originalAmountCZK: num.nullable().optional(),
  variableSymbol: z.string().regex(/^\d{1,10}$/).optional(),
  customerName: z.string().max(200).nullable(),
  isRefund: z.boolean(),
  refundAmount: num.nullable(),
  paidAmount: num.nullable(),
  paidCurrency: z.enum(['CZK', 'EUR']).nullable(),
  changeAmount: num.nullable(),
  changeAmountEUR: num.nullable(),
  discount: z.object({ type: z.enum(['percentage', 'amount']), value: num }).nullable(),
  discountAmount: num,
  finalAmount: num,
  tipAmount: num.nullable(),
  sumUpData: z
    .object({
      foreignTxId: z.string().max(100),
      sumUpTxCode: z.string().max(100),
      status: z.literal('success'),
      callbackReceived: z.boolean(),
    })
    .nullable()
    .optional(),
  served: z.boolean(),
});

export const finalizeInputSchema = z
  .object({
    storeId: z.string().regex(ID_RE),
    documentId: z.string().regex(/^[A-Za-z0-9]{6,40}$/),
    sale: saleDraftSchema,
    isTest: z.boolean().optional(),
    /** false = neodesílat (zákonná výjimka), vyžaduje `nonEvidenceReason` */
    eetSend: z.boolean().optional(),
    nonEvidenceReason: z.string().trim().min(3).max(200).optional(),
  })
  .refine((d) => d.sale.currency !== 'EUR' || typeof d.sale.eurRate === 'number', {
    message: 'Platba v EUR musí mít kurz (eurRate)',
    path: ['sale', 'eurRate'],
  })
  .refine((d) => d.eetSend !== false || d.isTest === true || !!d.nonEvidenceReason, {
    message: 'Doklad, který se neodešle do EET, musí mít důvod (nonEvidenceReason)',
    path: ['nonEvidenceReason'],
  });

export type FinalizeInput = z.infer<typeof finalizeInputSchema>;
export type SaleDraft = z.infer<typeof saleDraftSchema>;

export interface NewSaleEetOptions {
  isTest?: boolean;
  /** Doklad se do EET neposílá (zákonná výjimka) */
  notRequiredReason?: string;
  now: Date;
}

/**
 * Pole `receiptNo` + `eet` pro nový doklad. Čte čítač, proto se volá až po všech ostatních
 * čteních transakce; `commit()` zapíše čítač (zavolat spolu se zápisem dokladu).
 * Testovací doklady dostávají číslo ze stejné řady (souvislost řady, kap. 5.2).
 */
export async function prepareNewSaleEet(
  tx: Transaction,
  db: Db,
  uid: string,
  storeId: string,
  store: Pick<Store, 'eet'>,
  opts: NewSaleEetOptions
): Promise<{ fields: { receiptNo: string; eet: SaleEet }; commit: () => void }> {
  const settings = resolveEetSettings(store.eet);
  const { receiptNo, commit } = await allocateReceiptNo(tx, db, uid, storeId, settings.receiptSeries, opts.now);
  const saleAt = opts.now.toISOString();
  let eet: SaleEet;
  if (opts.isTest) eet = { status: 'test', env: settings.environment, saleAt };
  else if (opts.notRequiredReason) eet = { status: 'not_required', env: settings.environment, reason: opts.notRequiredReason, saleAt };
  else
    eet = {
      status: 'pending',
      env: settings.environment,
      saleAt,
      attempts: [],
      nextRetryAt: ts(new Date(opts.now.getTime() + PENDING_GRACE_MS)),
    };
  return { fields: { receiptNo, eet }, commit };
}

/** Best-effort jako v SumUp callbacku: chyba u jednoho produktu (smazaný produkt) nic nezastaví. */
export async function incrementSoldCounts(db: Db, uid: string, storeId: string, items: Pick<CartItem, 'productId' | 'quantity'>[], sign = 1) {
  const results = await Promise.allSettled(
    items.map((item) =>
      db.doc(paths.product(uid, storeId, item.productId)).update({
        soldCount: FieldValue.increment(sign * item.quantity),
        updatedAt: FieldValue.serverTimestamp(),
      })
    )
  );
  return { updated: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
}

export interface FinalizeResult {
  saleId: string;
  receiptNo?: string;
  duplicate: boolean;
  eet?: SaleEet;
  registration?: RegisterOutcome;
}

export interface FinalizeOptions {
  now?: () => Date;
  /** false = neodesílat hned (jen testy); odeslání pak převezme fronta. */
  registerNow?: boolean;
  registerOptions?: RegisterOptions;
}

export async function finalizeSale(db: Db, uid: string, input: FinalizeInput, opts: FinalizeOptions = {}): Promise<FinalizeResult> {
  const now = (opts.now ?? (() => new Date()))();
  const { storeId, documentId } = input;
  const storeRef = db.doc(paths.store(uid, storeId));
  const saleRef = db.doc(paths.sale(uid, storeId, documentId));

  const written = await db.runTransaction(async (tx) => {
    const storeSnap = await tx.get(storeRef);
    if (!storeSnap.exists) throw new HttpError(404, 'store_not_found', 'Prodejna nenalezena');
    const store = storeSnap.data() as Pick<Store, 'eet'>;
    if (!isEetEnabled(store)) throw new HttpError(409, 'eet_disabled', 'EET není u prodejny zapnuté');

    const existing = await tx.get(saleRef);
    if (existing.exists) {
      const d = existing.data() as { receiptNo?: string; eet?: SaleEet };
      return { duplicate: true, receiptNo: d.receiptNo, eet: d.eet };
    }

    const prepared = await prepareNewSaleEet(tx, db, uid, storeId, store, {
      isTest: input.isTest === true,
      notRequiredReason: !input.isTest && input.eetSend === false ? input.nonEvidenceReason : undefined,
      now,
    });
    const doc = compact({
      ...input.sale,
      documentId,
      createdAt: ts(now),
      storeId,
      userId: uid,
      ...(input.isTest ? { isTest: true } : {}),
      ...prepared.fields,
    });
    prepared.commit();
    tx.set(saleRef, doc);
    return { duplicate: false, receiptNo: prepared.fields.receiptNo, eet: prepared.fields.eet };
  });

  if (!written.duplicate) await incrementSoldCounts(db, uid, storeId, input.sale.items);

  let registration: RegisterOutcome | undefined;
  let eet = written.eet;
  if (opts.registerNow !== false && eet?.status === 'pending') {
    registration = await registerSale(db, uid, storeId, documentId, { mode: 'auto', ...opts.registerOptions });
    if (registration.eet) eet = registration.eet;
  }
  return { saleId: documentId, receiptNo: registration?.receiptNo ?? written.receiptNo, duplicate: written.duplicate, eet, registration };
}
