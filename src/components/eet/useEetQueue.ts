'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { EetSaleLike } from '@/lib/eetUi';

export type EetQueueSale = EetSaleLike & { id: string };

/**
 * Neodeslané doklady prodejny (pending / queued / failed_permanent), živě přes onSnapshot.
 * Jen při zapnutém EET; jinak žádný posluchač (dnešní chování beze změny).
 * Stačí automatický jednopolový index na `eet.status`.
 */
export function useEetQueue<T extends EetSaleLike = EetSaleLike>(uid: string | undefined, storeId: string, enabled: boolean): (T & { id: string })[] {
  const [sales, setSales] = useState<(T & { id: string })[]>([]);
  useEffect(() => {
    if (!enabled || !uid || !storeId) {
      setSales([]);
      return;
    }
    const q = query(
      collection(db, 'users', uid, 'stores', storeId, 'sales'),
      where('eet.status', 'in', ['pending', 'queued', 'failed_permanent']),
      limit(200)
    );
    return onSnapshot(
      q,
      (snap) => setSales(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))),
      (e) => console.warn('EET fronta (posluchač):', e)
    );
  }, [uid, storeId, enabled]);
  return sales;
}

/** Překreslení jednou za minutu (stáří dokladů ve frontě). Bez EET (`active` = false) neběží. */
export function useMinuteTick(active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
