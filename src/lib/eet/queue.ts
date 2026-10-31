import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { parseSalePath, paths, toDate, type Db } from './db';
import { EET_OPEN_STATUSES } from './flags';
import { registerSale, type RegisterOptions, type RegisterOutcome } from './register';

/*
 * Fronta EET: doklady ve stavu pending/queued s nextRetryAt <= teď.
 *  - retryDueAll: všechny prodejny (cron /api/eet/retry), collection-group dotaz; potřebuje
 *    index z firestore.indexes.json (sales: eet.status ASC, eet.nextRetryAt ASC, collection group).
 *  - retryDueForStore: jedna prodejna (/api/eet/retry-mine z POS); filtr času v paměti,
 *    takže stačí automatický jednopolový index.
 */

export interface RetrySummary {
  checked: number;
  results: { saleId: string; storeId: string; outcome: RegisterOutcome['outcome']; reason?: string }[];
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function processRefs(
  db: Db,
  refs: { uid: string; storeId: string; saleId: string }[],
  concurrency: number,
  opts: RegisterOptions
): Promise<RetrySummary['results']> {
  const results: RetrySummary['results'] = [];
  await runPool(refs, concurrency, async (r) => {
    try {
      const out = await registerSale(db, r.uid, r.storeId, r.saleId, { ...opts, mode: 'retry' });
      results.push({ saleId: r.saleId, storeId: r.storeId, outcome: out.outcome, reason: out.outcome === 'skipped' ? out.reason : undefined });
    } catch (e) {
      console.error('EET retry: chyba u dokladu', r.saleId, e);
      results.push({ saleId: r.saleId, storeId: r.storeId, outcome: 'skipped', reason: 'error' });
    }
  });
  return results;
}

export async function retryDueAll(
  db: Db,
  { limit = 50, concurrency = 5, now = () => new Date(), ...opts }: RegisterOptions & { limit?: number; concurrency?: number } = {}
): Promise<RetrySummary> {
  const snap = await db
    .collectionGroup('sales')
    .where('eet.status', 'in', [...EET_OPEN_STATUSES])
    .where('eet.nextRetryAt', '<=', Timestamp.fromDate(now()))
    .limit(limit)
    .get();
  const refs = snap.docs.map((d) => parseSalePath(d.ref.path)).filter((r): r is NonNullable<typeof r> => !!r);
  return { checked: snap.size, results: await processRefs(db, refs, concurrency, { ...opts, now }) };
}

export async function retryDueForStore(
  db: Db,
  uid: string,
  storeId: string,
  { limit = 10, concurrency = 3, now = () => new Date(), ...opts }: RegisterOptions & { limit?: number; concurrency?: number } = {}
): Promise<RetrySummary> {
  const snap = await db
    .collection(paths.sales(uid, storeId))
    .where('eet.status', 'in', [...EET_OPEN_STATUSES])
    .limit(200)
    .get();
  const t = now().getTime();
  const due = snap.docs
    .filter((d) => {
      const at = toDate((d.data() as { eet?: { nextRetryAt?: unknown } }).eet?.nextRetryAt);
      return !at || at.getTime() <= t;
    })
    .slice(0, limit)
    .map((d) => ({ uid, storeId, saleId: d.id }));
  return { checked: snap.size, results: await processRefs(db, due, concurrency, { ...opts, now }) };
}
