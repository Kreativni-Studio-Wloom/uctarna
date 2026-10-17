// Uložení prodeje z checkoutu u prodejny se ZAPNUTÝM EET (klient).
// Bez EET se tato funkce nevolá a CheckoutModal ukládá postaru (addDoc).

import { doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { withOfflineEet, type SaleDraftObject } from '@/lib/checkoutSale';
import { EetApiError, finalizeSaleRequest, type FinalizeResponse } from '@/lib/eetClient';
import { withTestFlag } from '@/lib/testSales';
import type { CartItem } from '@/types';

export type EetSaveResult =
  | { kind: 'finalized'; result: FinalizeResponse }
  /** Server mezitím EET vypnul → uloženo postaru */
  | { kind: 'legacy' }
  /** Offline / chyba serveru → uloženo z klienta s pendingNumber, dokončí fronta */
  | { kind: 'offline'; error?: string };

const OFFLINE_WRITE_WAIT_MS = 3000;

export async function saveSaleWithEet(p: {
  uid: string;
  storeId: string;
  draft: SaleDraftObject;
  isTest: boolean;
  /** Výjimka z evidence (checkout „Platba nepodléhá evidenci“): doklad se uloží, ale do EET neodešle. */
  nonEvidenceReason?: string;
  cart: CartItem[];
  /** Dnešní uložení (addDoc + soldCount), použije se při 409 eet_disabled */
  legacySave: () => Promise<void>;
}): Promise<EetSaveResult> {
  const exemptReason = !p.isTest && p.nonEvidenceReason ? p.nonEvidenceReason : undefined;
  const offline = async (error?: string): Promise<EetSaveResult> => {
    const ref = doc(db, 'users', p.uid, 'stores', p.storeId, 'sales', p.draft.documentId);
    const data = withOfflineEet(withTestFlag({ ...p.draft, createdAt: serverTimestamp() }, p.isTest), new Date(), exemptReason);
    // merge: kdyby server doklad už uložil (ztracená odpověď), nepřepíše receiptNo/POK; register to srovná.
    const write = setDoc(ref, data, { merge: true });
    // Offline se promise vyřeší až po spojení; zápis je ale už v lokální frontě Firestore.
    await Promise.race([write, new Promise((r) => setTimeout(r, OFFLINE_WRITE_WAIT_MS))]);
    for (const item of p.cart) {
      void updateDoc(doc(db, 'users', p.uid, 'stores', p.storeId, 'products', item.productId), {
        soldCount: increment(item.quantity),
        updatedAt: serverTimestamp(),
      }).catch((e) => console.error('soldCount (offline EET):', e));
    }
    return { kind: 'offline', error };
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return offline('offline');
  try {
    const result = await finalizeSaleRequest({
      storeId: p.storeId,
      documentId: p.draft.documentId,
      sale: p.draft,
      isTest: p.isTest || undefined,
      ...(exemptReason ? { eetSend: false, nonEvidenceReason: exemptReason } : {}),
    });
    return { kind: 'finalized', result };
  } catch (e) {
    if (e instanceof EetApiError && e.code === 'eet_disabled') {
      await p.legacySave();
      return { kind: 'legacy' };
    }
    console.error('❌ /api/sales/finalize selhalo, ukládám offline:', e);
    return offline((e as Error).message);
  }
}
