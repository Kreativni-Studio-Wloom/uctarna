import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { fetchSumUpPaymentState, fetchSumUpTerminalTip } from '@/lib/sumup-server';
import { serializeEet } from '@/lib/eet/db';
import { registerSale, type RegisterOutcome } from '@/lib/eet/register';
import { saveSumUpSale } from '@/lib/eet/sumupSale';

// ----------------------------------------------------------------------------
// Jistota zápisu kartové platby ze SumUp.
//
// Při spuštění SumUp klient zapíše „rozpracovanou platbu“ do Firestore
// (users/{uid}/stores/{sid}/state/sumup/sumupPending/{documentId}). Ta zůstává,
// dokud není doklad uložen (nebo SumUp nepotvrdí, že platba neproběhla).
// Doklad pak uloží kterákoli cesta, která uspěje dřív – návrat ze SumUp
// (/api/sumup-callback), dohledání z pokladny (/api/sumup/reconcile) nebo
// noční cron. Uložení je idempotentní (ID dokladu = documentId).
// ----------------------------------------------------------------------------

export const pendingPath = (uid: string, storeId: string, documentId: string) =>
  `users/${uid}/stores/${storeId}/state/sumup/sumupPending/${documentId}`;

/** Po této době bez nalezené transakce v SumUp rozpracovanou platbu zahodíme. */
const PENDING_EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;

export interface RecordSumUpInput {
  userId: string;
  storeId: string;
  documentId: string;
  foreignTxId: string;
  txCode: string | null;
  amount: number;
  cartItems: unknown[];
  discount?: unknown;
  discountAmount?: number;
  finalAmount?: number;
  customerName?: string | null;
  appTipAmount: number;
  /** uid z ověřeného ID tokenu; u cronu = userId z rozpracované platby (zapsat ji smí jen vlastník). */
  authUid: string | null;
}

/** Uloží prodej z úspěšné SumUp platby (spropitné, počty kusů, EET) a smaže rozpracovanou platbu. */
export async function recordSumUpPayment(input: RecordSumUpInput) {
  const { userId, storeId, documentId, foreignTxId, txCode, cartItems, appTipAmount } = input;
  const sentToSumUp = input.amount;

  // Spropitné z terminálu ze SumUp REST API (tip_amount nebo rozdíl částek). Při chybě 0 Kč.
  const terminalLookup = await fetchSumUpTerminalTip(
    txCode,
    documentId || foreignTxId,
    Number.isFinite(sentToSumUp) ? sentToSumUp : undefined
  );
  const terminalTip = terminalLookup.tipAmount;
  const combinedTip = appTipAmount + terminalTip;
  const tipAmount = combinedTip > 0 ? combinedTip : null;
  const saleTotalAmount = (Number.isFinite(sentToSumUp) ? sentToSumUp : 0) + terminalTip;
  const baseFinal = typeof input.finalAmount === 'number' ? input.finalAmount : sentToSumUp;
  const saleFinalAmount = baseFinal + terminalTip;

  const sale = {
    items: cartItems,
    totalAmount: saleTotalAmount,
    paymentMethod: 'card',
    documentId,
    createdAt: FieldValue.serverTimestamp(),
    storeId,
    userId,
    customerName: input.customerName || null,
    isRefund: false,
    refundAmount: null,
    served: false,
    discount: input.discount || null,
    discountAmount: input.discountAmount || 0,
    finalAmount: saleFinalAmount,
    tipAmount,
    sumUpData: {
      foreignTxId,
      sumUpTxCode: txCode,
      status: 'success',
      callbackReceived: true,
      callbackTimestamp: FieldValue.serverTimestamp(),
      sentToSumUp: Number.isFinite(sentToSumUp) ? sentToSumUp : null,
      terminalTip: terminalTip > 0 ? terminalTip : null,
      terminalTipSource: terminalLookup.source,
      terminalTipDebug: terminalLookup.debugError ?? null,
      sumUpAuthSource: terminalLookup.authSource ?? null,
    },
  };

  const saved = await saveSumUpSale(adminDb, { userId, storeId, saleDocId: documentId, sale, authUid: input.authUid });

  // Doklad je uložen (teď nebo dřív) – rozpracovaná platba už není potřeba.
  await adminDb.doc(pendingPath(userId, storeId, documentId)).delete().catch((e) => {
    console.warn('⚠️ Rozpracovanou SumUp platbu se nepodařilo smazat:', documentId, e);
  });

  if (saved.alreadyExists) {
    return {
      success: true,
      saleId: documentId,
      duplicate: true,
      message: 'Prodej už byl uložen dříve (duplicitní callback ignorován)',
      tipAmount,
      totalAmount: saleTotalAmount,
    };
  }

  // Počty prodaných kusů – best-effort, neblokuje odpověď.
  let inventoryUpdated = 0;
  let inventoryFailed = 0;
  for (const item of cartItems as { productId?: string; quantity?: number }[]) {
    try {
      if (!item?.productId) continue;
      await adminDb.doc(`users/${userId}/stores/${storeId}/products/${item.productId}`).update({
        soldCount: FieldValue.increment(item.quantity ?? 0),
        updatedAt: FieldValue.serverTimestamp(),
      });
      inventoryUpdated += 1;
    } catch (e) {
      inventoryFailed += 1;
      console.error('⚠️ Nepodařilo se aktualizovat produkt', item?.productId, e);
    }
  }

  // EET 2.0: odeslání až po commitu. Selhání EET platbu ani doklad neruší (fronta).
  let eetRegistration: RegisterOutcome | undefined;
  if (saved.eetEnabled && saved.eet?.status === 'pending') {
    try {
      eetRegistration = await registerSale(adminDb, userId, storeId, documentId, { mode: 'auto' });
    } catch (e) {
      console.error('⚠️ EET: odeslání po SumUp platbě selhalo, doklad zůstává ve frontě', e);
    }
  }
  const eetResponse = saved.eetEnabled
    ? {
        receiptNo: eetRegistration?.receiptNo ?? saved.receiptNo,
        eet: serializeEet(eetRegistration?.eet ?? saved.eet),
      }
    : {};

  return {
    success: true,
    saleId: documentId,
    message: 'Prodej byl úspěšně uložen',
    inventoryUpdated,
    inventoryFailed,
    terminalTip: terminalTip > 0 ? terminalTip : null,
    tipAmount,
    totalAmount: saleTotalAmount,
    terminalTipDebug: terminalLookup.debugError ?? null,
    ...eetResponse,
  };
}

export type ReconcileState = 'saved' | 'failed' | 'pending' | 'expired' | 'unknown';

/**
 * Dořeší jednu rozpracovanou platbu: ověří ji u SumUp a podle výsledku uloží
 * doklad, nebo ji zahodí. Bez nalezené transakce ji nechá na příště.
 */
export async function reconcilePendingPayment(
  userId: string,
  storeId: string,
  documentId: string,
  authUid: string | null
): Promise<{ state: ReconcileState; result?: Awaited<ReturnType<typeof recordSumUpPayment>> }> {
  const pendingRef = adminDb.doc(pendingPath(userId, storeId, documentId));
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) {
    const sale = await adminDb.doc(`users/${userId}/stores/${storeId}/sales/${documentId}`).get();
    return { state: sale.exists ? 'saved' : 'unknown' };
  }
  const p = pendingSnap.data() as Record<string, unknown>;

  const status = await fetchSumUpPaymentState(documentId);
  if (status.state === 'success') {
    const amount = Number(p.totalAmount);
    const tipRaw = Number(p.tipAmount);
    const result = await recordSumUpPayment({
      userId,
      storeId,
      documentId,
      foreignTxId: documentId,
      txCode: status.txCode,
      amount,
      cartItems: Array.isArray(p.cartItems) ? p.cartItems : [],
      discount: p.discount ?? null,
      discountAmount: typeof p.discountAmount === 'number' ? p.discountAmount : 0,
      finalAmount: typeof p.finalAmount === 'number' ? p.finalAmount : amount,
      customerName: typeof p.customerName === 'string' ? p.customerName : null,
      appTipAmount: Number.isFinite(tipRaw) && tipRaw > 0 ? tipRaw : 0,
      authUid,
    });
    return { state: 'saved', result };
  }
  if (status.state === 'failed') {
    await pendingRef.delete();
    return { state: 'failed' };
  }
  const createdAt = p.createdAt instanceof Timestamp ? p.createdAt.toMillis() : Number(p.timestamp) || Date.now();
  if (status.state === 'not_found' && Date.now() - createdAt > PENDING_EXPIRE_MS) {
    await pendingRef.delete();
    return { state: 'expired' };
  }
  return { state: 'pending' };
}

/** Cron: dořeší všechny rozpracované platby (starší než 2 min, ať nepředbíhá živý návrat). */
export async function reconcileAllPending(): Promise<Record<ReconcileState | 'errors', number>> {
  const counts: Record<ReconcileState | 'errors', number> = {
    saved: 0, failed: 0, pending: 0, expired: 0, unknown: 0, errors: 0,
  };
  const snap = await adminDb.collectionGroup('sumupPending').limit(200).get();
  for (const d of snap.docs) {
    // users/{uid}/stores/{sid}/state/sumup/sumupPending/{documentId}
    const parts = d.ref.path.split('/');
    if (parts.length !== 8 || parts[0] !== 'users' || parts[2] !== 'stores') continue;
    const [, uid, , storeId] = parts;
    const data = d.data();
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Number(data.timestamp) || 0;
    if (Date.now() - createdAt < 2 * 60 * 1000) continue;
    try {
      const r = await reconcilePendingPayment(uid, storeId, d.id, uid);
      counts[r.state] += 1;
    } catch (e) {
      counts.errors += 1;
      console.error('❌ SumUp reconcile selhal:', d.ref.path, e);
    }
  }
  return counts;
}
