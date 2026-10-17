import 'server-only';
import { randomInt } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { formatReceiptNo, nextCounter, pragueYear, type ReceiptSeries } from './receiptNo';

/*
 * Společné pomůcky pro Firestore část EET (Admin SDK). Funkce dostávají `db` parametrem,
 * aby šly testovat proti in-memory mocku (tests/eet/firestoreMock.ts).
 */

export type Db = Firestore;

export const paths = {
  store: (uid: string, storeId: string) => `users/${uid}/stores/${storeId}`,
  sales: (uid: string, storeId: string) => `users/${uid}/stores/${storeId}/sales`,
  sale: (uid: string, storeId: string, saleId: string) => `users/${uid}/stores/${storeId}/sales/${saleId}`,
  counter: (uid: string, storeId: string) => `users/${uid}/stores/${storeId}/counters/receipts`,
  privateEet: (uid: string, storeId: string) => `users/${uid}/stores/${storeId}/private/eet`,
  privateEetRenewal: (uid: string, storeId: string) => `users/${uid}/stores/${storeId}/private/eetRenewal`,
  product: (uid: string, storeId: string, productId: string) => `users/${uid}/stores/${storeId}/products/${productId}`,
};

/** `users/{uid}/stores/{storeId}/sales/{saleId}` → části cesty. */
export function parseSalePath(path: string): { uid: string; storeId: string; saleId: string } | null {
  const m = /^users\/([^/]+)\/stores\/([^/]+)\/sales\/([^/]+)$/.exec(path);
  return m ? { uid: m[1], storeId: m[2], saleId: m[3] } : null;
}

export const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/** Firestore odmítá `undefined`; odstraní ho z prostých objektů a polí (Timestamp, FieldValue nechá). */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => compact(v)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = compact(v);
    }
    return out as T;
  }
  return value;
}

/** Stejný formát jako `SumUpService.generateDocumentId()` (10 znaků a-z0-9). */
export function newDocumentId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[randomInt(chars.length)];
  return out;
}

export function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate(): Date }).toDate();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

export const ts = (d: Date) => Timestamp.fromDate(d);

/**
 * Přidělí další číslo dokladu v rámci transakce `tx`. Čtení proběhne hned, zápis čítače se
 * zaregistruje do transakce, takže volající musí všechna svá čtení udělat PŘED zavoláním
 * a zápisy až po něm (pravidlo Firestore transakcí).
 */
export async function allocateReceiptNo(
  tx: Transaction,
  db: Db,
  uid: string,
  storeId: string,
  series: ReceiptSeries,
  now: Date
): Promise<{ receiptNo: string; commit: () => void }> {
  const ref = db.doc(paths.counter(uid, storeId));
  const snap = await tx.get(ref);
  const next = nextCounter(snap.exists ? (snap.data() as { year?: number; last?: number }) : undefined, pragueYear(now), series.resetYearly);
  const receiptNo = formatReceiptNo(series, next);
  return { receiptNo, commit: () => tx.set(ref, { year: next.year, last: next.last, updatedAt: ts(now) }) };
}

/** Chyba s HTTP stavem pro API routy (`code` je strojově čitelný, `message` česky pro obsluhu). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** `sale.eet` pro JSON odpověď: Timestamp → ISO řetězec. */
export function serializeEet<T extends object | undefined>(eet: T): T {
  if (!eet) return eet;
  const out: Record<string, unknown> = { ...(eet as Record<string, unknown>) };
  for (const k of ['nextRetryAt', 'firstAttemptAt', 'lockUntil']) {
    const d = toDate(out[k]);
    out[k] = d ? d.toISOString() : out[k] === null ? null : undefined;
  }
  return compact(out) as T;
}
