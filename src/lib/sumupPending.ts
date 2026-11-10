'use client';

import { collection, doc, getDocs, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { eetAuthHeaders } from '@/lib/eetClient';

// Klientská část jistoty zápisu kartové platby (viz src/lib/sumupRecord.ts).

const pendingCollection = (uid: string, storeId: string) =>
  collection(db, 'users', uid, 'stores', storeId, 'state', 'sumup', 'sumupPending');

/**
 * Zapíše rozpracovanou platbu (data z uctarna_payment_data) do Firestore.
 * Čeká max. 3 s – offline Firestore zápis dokončí sám, až bude síť.
 */
export async function recordPendingSumUpPayment(uid: string, storeId: string, documentId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('uctarna_payment_data');
    const data = raw ? JSON.parse(raw) : {};
    const write = setDoc(doc(pendingCollection(uid, storeId), documentId), {
      ...data,
      documentId,
      storeId,
      userId: uid,
      createdAt: serverTimestamp(),
    });
    await Promise.race([write, new Promise((r) => setTimeout(r, 3000))]);
  } catch (e) {
    console.error('⚠️ Rozpracovanou SumUp platbu se nepodařilo zapsat:', e);
  }
}

export type ReconcileResponse = {
  state: 'saved' | 'failed' | 'pending' | 'expired' | 'unknown' | 'error';
  result?: { saleId?: string; duplicate?: boolean; tipAmount?: number | null; totalAmount?: number };
};

/** Ověří platbu u SumUp a na serveru uloží doklad (idempotentně). */
export async function reconcileSumUpPayment(storeId: string, documentId: string): Promise<ReconcileResponse> {
  try {
    const res = await fetch('/api/sumup/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await eetAuthHeaders()) },
      body: JSON.stringify({ storeId, documentId }),
      cache: 'no-store',
    });
    if (!res.ok) return { state: 'error' };
    return (await res.json()) as ReconcileResponse;
  } catch {
    return { state: 'error' };
  }
}

/**
 * Tiše dořeší starší rozpracované platby prodejny (např. když se návrat ze SumUp
 * nepovedl). Aktuální platbu (skipDocumentId) a čerstvé (< 2 min) přeskočí,
 * aby nepředbíhala živý návrat.
 */
export async function sweepPendingSumUpPayments(uid: string, storeId: string, skipDocumentId?: string | null) {
  try {
    const snap = await getDocs(pendingCollection(uid, storeId));
    for (const d of snap.docs) {
      if (d.id === skipDocumentId) continue;
      const createdAt = d.data().createdAt;
      const ms = createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
      if (ms && Date.now() - ms < 2 * 60 * 1000) continue;
      const r = await reconcileSumUpPayment(storeId, d.id);
      if (r.state === 'saved') console.log('✅ Dořešena dříve nezapsaná SumUp platba:', d.id);
    }
  } catch (e) {
    console.warn('⚠️ Kontrola rozpracovaných SumUp plateb selhala:', e);
  }
}
