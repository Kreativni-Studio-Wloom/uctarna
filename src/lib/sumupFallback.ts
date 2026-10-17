// Záložní zápis SumUp prodeje z prohlížeče (návratová stránka i původní okno POS),
// když server (/api/sumup-callback) prodej neuložil.

import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withOfflineEet } from '@/lib/checkoutSale';

/** Objekt prodeje z payment dat v localStorage (stejný tvar jako před EET). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildFallbackSale(paymentData: any, foreignTxId: string, txCode: string | null) {
  const { storeId, userId, cartItems, totalAmount, documentId, discount, discountAmount, finalAmount, customerName, tipAmount: rawTip } = paymentData;
  const tipAmountFallback = typeof rawTip === 'number' && rawTip > 0 ? rawTip : null;
  return {
    items: cartItems,
    totalAmount: totalAmount || 0,
    paymentMethod: 'card',
    documentId: documentId || foreignTxId,
    createdAt: serverTimestamp(),
    storeId,
    userId,
    customerName: customerName || null,
    isRefund: false,
    refundAmount: null,
    served: false,
    discount: discount || null,
    discountAmount: discountAmount || 0,
    finalAmount: finalAmount || totalAmount || 0,
    tipAmount: tipAmountFallback,
    sumUpData: {
      foreignTxId: foreignTxId,
      sumUpTxCode: txCode,
      status: 'success',
      callbackReceived: true,
      callbackTimestamp: new Date()
    }
  };
}

export type EetFallbackResult = 'created' | 'exists' | 'skipped';

/**
 * EET 2.0 (jen `eet: true` v payment datech): doklad s `pendingNumber`, číslo dokladu a odeslání
 * do EET dodělá serverová fronta. Jen založí chybějící doklad: doklad, který už uložil server,
 * nikdy nepřepíše (přepsání `eet.status` na queued by tržbu odeslalo podruhé).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveEetFallbackSale(paymentData: any, foreignTxId: string, txCode: string | null): Promise<EetFallbackResult> {
  const { storeId, userId, documentId } = paymentData ?? {};
  if (!storeId || !userId || !Array.isArray(paymentData.cartItems)) return 'skipped';
  const saleRef = doc(db, 'users', userId, 'stores', storeId, 'sales', documentId || foreignTxId);
  const data = withOfflineEet(buildFallbackSale(paymentData, foreignTxId, txCode), new Date());
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(saleRef);
    if (existing.exists()) return 'exists' as const;
    tx.set(saleRef, data);
    return 'created' as const;
  });
}
