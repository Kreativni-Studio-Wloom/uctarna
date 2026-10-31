import 'server-only';
import { computeEetAmountCZK } from './amount';
import { EetValidationError, computeNextRetryAt, sendTrzbaAttempt, type EetAttempt } from './attempt';
import { getStoreCredentials } from './credentials';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { allocateReceiptNo, compact, paths, toDate, ts, type Db } from './db';
import { isEetEnabled, resolveEetSettings, type ResolvedEetSettings } from './flags';
import { formatAmount, formatDateTimePrague, validateTrzbaData } from './format';
import type { EetCredentials, EetTrzbaData } from './types';
import type { Sale, SaleEet, SaleEetAttempt, Store } from '@/types';

/*
 * registerSale: Firestore obal kolem sendTrzbaAttempt (fáze A). Jediná cesta, kterou se
 * doklad posílá do EET (finalize, SumUp callback, storno, ruční odeslání, fronta).
 *
 * Idempotence (dvojí volání, dvojí callback, souběh fronty a ručního odeslání):
 *  1. „Claim“ transakce: přečte doklad, rozhodne, zda se smí odeslat, a nastaví zámek
 *     `eet.lockUntil`. Souběžné volání zámek uvidí a nic neodešle. Doklad ve stavu
 *     sent / test / not_required se nikdy neodešle znovu.
 *  2. Při 1. pokusu zmrazí `eet.data` (a u offline dokladu přidělí číslo) a nastaví
 *     `firstAttemptAt` JEŠTĚ PŘED odesláním. Když server spadne po odeslání, další pokus
 *     je správně `prvni_zaslani=false` se stejnými Data.
 *  3. Po odeslání zapíše pokus, stav, `nextRetryAt` a zámek uvolní.
 */

export type RegisterMode = 'auto' | 'retry' | 'manual';

export interface RegisterOptions {
  /**
   * auto   – hned po uložení dokladu (pending/queued)
   * retry  – fronta (cron, retry-mine): jen pending/queued s nextRetryAt <= teď
   * manual – „Odeslat znovu“: i failed_permanent (po opravě nastavení)
   */
  mode?: RegisterMode;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  newUuid?: () => string;
  loadCredentials?: (db: Db, uid: string, storeId: string) => Promise<Pick<EetCredentials, 'privateKeyPem' | 'certDerB64'>>;
}

export type SkipReason = 'not_found' | 'no_eet' | 'final' | 'not_due' | 'locked' | 'disabled';

export type RegisterOutcome =
  | { outcome: 'sent' | 'queued' | 'failed_permanent'; eet: SaleEet; receiptNo?: string; message: string }
  | { outcome: 'skipped'; reason: SkipReason; eet?: SaleEet; receiptNo?: string };

/** Zámek musí přečkat timeout odeslání (max. desítky s) a zápis výsledku. */
export const LOCK_MS = 60_000;

const FINAL_STATUSES = new Set(['sent', 'test', 'not_required']);

type SaleDoc = Partial<Sale> & { eet?: SaleEet; createdAt?: unknown };

/*
 * soldCount offline dokladu (pendingNumber, bez receiptNo) přičítá server, a to právě jednou:
 * v transakci, která doklad očísluje (číslo se přidělí jen jednou). Klient ho u offline zálohy
 * nepřičítá (eetCheckout.ts), takže nevznikne dvojí přičtení ani při ztracené odpovědi
 * (serverový doklad už číslo má a soldCount přičetl finalize / callback), ani při opakované záloze.
 * Čtení produktů musí proběhnout před zápisy transakce; smazaný produkt se přeskočí.
 */
async function prepareOfflineSoldCount(tx: Transaction, db: Db, uid: string, storeId: string, sale: SaleDoc): Promise<() => void> {
  const qty = new Map<string, number>();
  for (const item of sale.items ?? []) {
    if (!item?.productId || typeof item.quantity !== 'number' || !item.quantity) continue;
    qty.set(item.productId, (qty.get(item.productId) ?? 0) + item.quantity);
  }
  const refs = [...qty.keys()].map((id) => db.doc(paths.product(uid, storeId, id)));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  return () => {
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      tx.update(refs[i], { soldCount: FieldValue.increment(qty.get(refs[i].id)!), updatedAt: FieldValue.serverTimestamp() });
    });
  };
}

/** Sestaví sekci Data z dokladu a nastavení prodejny (bez porad_cis). */
export function buildTrzbaData(sale: SaleDoc, settings: ResolvedEetSettings, receiptNo: string, now: Date): EetTrzbaData {
  const saleAt = toDate(sale.eet?.saleAt) ?? toDate(sale.createdAt) ?? now;
  const amount = computeEetAmountCZK(
    {
      totalAmount: Number(sale.totalAmount ?? 0),
      currency: sale.currency === 'EUR' ? 'EUR' : 'CZK',
      finalAmount: typeof sale.finalAmount === 'number' ? sale.finalAmount : undefined,
      eurRate: typeof sale.eurRate === 'number' ? sale.eurRate : undefined,
      tipAmount: typeof sale.tipAmount === 'number' ? sale.tipAmount : undefined,
      paymentMethod: sale.paymentMethod,
    },
    { tipsAreBusinessIncome: settings.tipsAreBusinessIncome }
  );
  return {
    eic: settings.eic,
    unitId: settings.unitId,
    registerId: settings.registerId,
    porad_cis: receiptNo,
    dat_trzby: formatDateTimePrague(saleAt),
    celk_trzba: formatAmount(amount),
  };
}

export function attemptRecord(a: EetAttempt): SaleEetAttempt {
  const r = a.result;
  return compact({
    uuid: r.uuid,
    sentAt: r.sentAt,
    first: r.firstAttempt,
    result: r.kind,
    code: r.kind === 'error' ? r.code : undefined,
    text: r.kind === 'error' ? r.text : r.kind === 'network' ? r.message : undefined,
    xGlobalTransactionId: r.xGlobalTransactionId,
    ms: r.ms,
  });
}

/** Nový stav `sale.eet` po pokusu (čistá funkce). */
export function applyAttempt(eet: SaleEet, a: EetAttempt): SaleEet {
  const r = a.result;
  const attempts = [...(eet.attempts ?? []), attemptRecord(a)];
  const code8Count = (eet.code8Count ?? 0) + (r.kind === 'error' && r.code === 8 ? 1 : 0);
  const base: SaleEet = { ...eet, attempts, code8Count, message: a.message, lockUntil: null };
  if (a.classification === 'ok' && r.kind === 'ok') {
    return compact({ ...base, status: 'sent', pok: r.pok, receivedAt: r.receivedAt, warnings: r.warnings, nextRetryAt: null, overdue: false });
  }
  if (a.classification === 'retryable') {
    return compact({ ...base, status: 'queued', nextRetryAt: a.nextRetryAt ? ts(a.nextRetryAt) : null, overdue: a.overdue });
  }
  return compact({ ...base, status: 'failed_permanent', nextRetryAt: null });
}

interface Claim {
  data: EetTrzbaData;
  env: NonNullable<SaleEet['env']>;
  first: boolean;
  attemptNo: number;
  settings: ResolvedEetSettings;
  eet: SaleEet;
  receiptNo: string;
  firstAttemptAt: Date;
}

type ClaimResult =
  | { kind: 'claim'; claim: Claim }
  | { kind: 'skip'; reason: SkipReason; eet?: SaleEet; receiptNo?: string }
  | { kind: 'failed'; eet: SaleEet; receiptNo?: string; message: string };

export async function registerSale(
  db: Db,
  uid: string,
  storeId: string,
  saleId: string,
  opts: RegisterOptions = {}
): Promise<RegisterOutcome> {
  const mode = opts.mode ?? 'auto';
  const now = opts.now ?? (() => new Date());
  const saleRef = db.doc(paths.sale(uid, storeId, saleId));
  const storeRef = db.doc(paths.store(uid, storeId));

  // Certifikát načteme před transakcí (transakce se může opakovat, dešifrování je drahé).
  let credentials: Pick<EetCredentials, 'privateKeyPem' | 'certDerB64'> | undefined;
  let credentialsError: string | undefined;
  try {
    credentials = await (opts.loadCredentials ?? ((d, u, s) => getStoreCredentials(d, u, s)))(db, uid, storeId);
  } catch (e) {
    credentialsError = (e as Error).message;
  }

  const claimed: ClaimResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(saleRef);
    if (!snap.exists) return { kind: 'skip', reason: 'not_found' };
    const sale = snap.data() as SaleDoc;
    const eet = sale.eet;
    if (!eet) return { kind: 'skip', reason: 'no_eet' };
    const t = now();

    // Oprava po offline zápisu z klienta (merge přepsal status, POK ale zůstal).
    if (eet.pok && eet.status !== 'sent') {
      const fixed: SaleEet = { ...eet, status: 'sent', nextRetryAt: null, lockUntil: null };
      tx.update(saleRef, { eet: fixed, pendingNumber: false });
      return { kind: 'skip', reason: 'final', eet: fixed, receiptNo: sale.receiptNo };
    }
    if (FINAL_STATUSES.has(eet.status)) return { kind: 'skip', reason: 'final', eet, receiptNo: sale.receiptNo };
    if (eet.status === 'failed_permanent' && mode !== 'manual') return { kind: 'skip', reason: 'final', eet, receiptNo: sale.receiptNo };
    if (mode === 'retry') {
      const due = toDate(eet.nextRetryAt);
      if (due && due.getTime() > t.getTime()) return { kind: 'skip', reason: 'not_due', eet, receiptNo: sale.receiptNo };
    }
    const lock = toDate(eet.lockUntil);
    if (lock && lock.getTime() > t.getTime()) return { kind: 'skip', reason: 'locked', eet, receiptNo: sale.receiptNo };

    const storeSnap = await tx.get(storeRef);
    const store = (storeSnap.exists ? storeSnap.data() : undefined) as Pick<Store, 'eet'> | undefined;
    // Vypnuté EET = nic se neposílá (ani z fronty). Po zapnutí se fronta dožene.
    if (!isEetEnabled(store)) return { kind: 'skip', reason: 'disabled', eet, receiptNo: sale.receiptNo };
    const settings = resolveEetSettings(store?.eet);

    // Testovací doklad se nikdy neodešle. Offline uložený (pendingNumber) jen dostane číslo.
    if (sale.isTest === true) {
      let receiptNo = sale.receiptNo;
      let commitCounter: (() => void) | undefined;
      let applySold: (() => void) | undefined;
      if (!receiptNo) {
        const alloc = await allocateReceiptNo(tx, db, uid, storeId, settings.receiptSeries, t);
        receiptNo = alloc.receiptNo;
        commitCounter = alloc.commit;
        if (sale.pendingNumber === true) applySold = await prepareOfflineSoldCount(tx, db, uid, storeId, sale);
      }
      applySold?.();
      const testEet: SaleEet = compact({ ...eet, status: 'test', env: eet.env ?? settings.environment, nextRetryAt: null, lockUntil: null });
      commitCounter?.();
      tx.update(saleRef, { eet: testEet, receiptNo, pendingNumber: false });
      return { kind: 'skip', reason: 'final', eet: testEet, receiptNo };
    }

    // Offline uložený doklad s výjimkou z evidence (checkout „Platba nepodléhá evidenci“): jen číslo, neodesílá se.
    if (eet.exemptReason && !eet.data && !eet.firstAttemptAt) {
      let receiptNo = sale.receiptNo;
      let commitCounter: (() => void) | undefined;
      let applySold: (() => void) | undefined;
      if (!receiptNo) {
        const alloc = await allocateReceiptNo(tx, db, uid, storeId, settings.receiptSeries, t);
        receiptNo = alloc.receiptNo;
        commitCounter = alloc.commit;
        if (sale.pendingNumber === true) applySold = await prepareOfflineSoldCount(tx, db, uid, storeId, sale);
      }
      applySold?.();
      const { exemptReason, ...rest } = eet;
      const exemptEet: SaleEet = compact({ ...rest, status: 'not_required', reason: exemptReason, env: eet.env ?? settings.environment, nextRetryAt: null, lockUntil: null });
      commitCounter?.();
      tx.update(saleRef, { eet: exemptEet, receiptNo, pendingNumber: false });
      return { kind: 'skip', reason: 'final', eet: exemptEet, receiptNo };
    }

    const fail = (message: string): ClaimResult => {
      const failed: SaleEet = compact({ ...eet, status: 'failed_permanent', message, nextRetryAt: null, lockUntil: null });
      tx.update(saleRef, { eet: failed });
      return { kind: 'failed', eet: failed, receiptNo: sale.receiptNo, message };
    };

    let data = eet.data;
    let receiptNo = sale.receiptNo;
    let commitCounter: (() => void) | undefined;
    let applySold: (() => void) | undefined;
    if (!data) {
      let draft: EetTrzbaData;
      try {
        draft = buildTrzbaData(sale, settings, receiptNo || '1', t);
      } catch (e) {
        return fail(`Doklad nejde zaevidovat: ${(e as Error).message}`);
      }
      const problems = validateTrzbaData(draft);
      if (problems.length) return fail(`Neplatné nastavení EET: ${problems.join('; ')}`);
      if (!receiptNo) {
        // Offline doklad (pendingNumber): číslo až teď, v téže transakci.
        const alloc = await allocateReceiptNo(tx, db, uid, storeId, settings.receiptSeries, t);
        receiptNo = alloc.receiptNo;
        commitCounter = alloc.commit;
        if (sale.pendingNumber === true) applySold = await prepareOfflineSoldCount(tx, db, uid, storeId, sale);
      }
      data = { ...draft, porad_cis: receiptNo };
    }
    // Bez certifikátu se doklad neočísluje (fail nezapíše číslo), takže ani soldCount; přičte se při dalším pokusu.
    if (credentialsError || !credentials) return fail(credentialsError ?? 'Chybí certifikát EET');
    receiptNo = receiptNo ?? data.porad_cis;

    const firstAttemptAt = toDate(eet.firstAttemptAt) ?? t;
    const env = eet.data ? (eet.env ?? settings.environment) : settings.environment;
    const next: SaleEet = compact({
      ...eet,
      status: eet.status === 'failed_permanent' ? 'queued' : eet.status,
      env,
      data,
      firstAttemptAt: ts(firstAttemptAt),
      lockUntil: ts(new Date(t.getTime() + LOCK_MS)),
    });
    commitCounter?.();
    applySold?.();
    tx.update(saleRef, compact({ eet: next, receiptNo, pendingNumber: sale.pendingNumber ? false : undefined }));
    return {
      kind: 'claim',
      claim: {
        data,
        env,
        first: !eet.firstAttemptAt,
        attemptNo: (eet.attempts?.length ?? 0) + 1,
        settings,
        eet: next,
        receiptNo,
        firstAttemptAt,
      },
    };
  });

  if (claimed.kind === 'skip') return { outcome: 'skipped', reason: claimed.reason, eet: claimed.eet, receiptNo: claimed.receiptNo };
  if (claimed.kind === 'failed') return { outcome: 'failed_permanent', eet: claimed.eet, receiptNo: claimed.receiptNo, message: claimed.message };

  const { claim } = claimed;
  let finalEet: SaleEet;
  let message: string;
  try {
    const attempt = await sendTrzbaAttempt({
      env: claim.env,
      credentials: credentials!,
      data: claim.data,
      firstAttempt: claim.first,
      timeoutMs: claim.settings.sendTimeoutMs,
      attemptNo: claim.attemptNo,
      previousCode8Count: claim.eet.code8Count ?? 0,
      firstAttemptAt: claim.firstAttemptAt,
      now,
      fetchImpl: opts.fetchImpl,
      endpoint: opts.endpoint,
      newUuid: opts.newUuid,
    });
    finalEet = applyAttempt(claim.eet, attempt);
    message = attempt.message;
  } catch (e) {
    const permanent = e instanceof EetValidationError;
    message = permanent ? `Neplatná data dokladu: ${(e as Error).message}` : `Chyba při odesílání: ${(e as Error).message}`;
    finalEet = compact({
      ...claim.eet,
      status: permanent ? 'failed_permanent' : 'queued',
      message,
      lockUntil: null,
      nextRetryAt: permanent ? null : ts(computeNextRetryAt(claim.attemptNo, now())),
    });
  }

  await saleRef.update({ eet: finalEet });
  return {
    outcome: finalEet.status === 'sent' ? 'sent' : finalEet.status === 'queued' ? 'queued' : 'failed_permanent',
    eet: finalEet,
    receiptNo: claim.receiptNo,
    message,
  };
}
