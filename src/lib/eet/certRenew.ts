import 'server-only';
import { CaApiError, createCaClient, type CaClient } from './caApi';
import { checkCertificate } from './certificate';
import { EetCredentialsError, encryptCredentials, getStoreCredentials, invalidateStoreCredentials, type PrivateEetDoc } from './credentials';
import { paths, toDate, ts, type Db } from './db';
import { isEetEnabled, resolveEetSettings } from './flags';
import { loadP12 } from './sign';
import type { EetCredentials } from './types';
import type { EetEnvironmentId, Store, StoreEetCertificateRenewal } from '@/types';

/*
 * Automatická obnova pokladního certifikátu přes API CA EET (plán, fáze 8 a kap. 2.6).
 * Jen u prodejny se zapnutým EET (`store.eet.enabled`) a certifikátem pro produkci.
 * Denní kontrola (GET /api/eet/cert-renew, CRON_SECRET): ≤ 21 dní do konce platnosti →
 *   renew (nebo navázání na neukončenou žádost) → status (polling) → claim-download →
 *   kontrola a zašifrování nového .p12 do `private/eetRenewal.staged` → ack-download
 *   (podepsáno ještě starým certifikátem) → nový certifikát do `private/eet` + metadata.
 * Každý krok je opakovatelný: rozpracovaný stav (reqId, staged) je v `private/eetRenewal`
 * (jen server), pro UI je stručný stav v `store.eet.certificateRenewal` (bez tajných dat).
 * Odpovědi CA (PKCS#12, heslo) se NIKDY nelogují.
 */

export const RENEW_BEFORE_DAYS = 21;
const DAY_MS = 86_400_000;
const DEFAULT_MAX_POLL_MS = 20_000;
const MAX_POLL_STEP_SEC = 10;

export type RenewOutcome =
  | { outcome: 'skipped'; reason: 'disabled' | 'no_certificate' | 'not_due' | 'expired' | 'not_production'; daysLeft?: number }
  | { outcome: 'in_process'; daysLeft: number; reqId: string }
  | { outcome: 'renewed'; daysLeft: number; validTo: string }
  | { outcome: 'rejected' | 'failed'; daysLeft?: number; message: string };

/** Rozpracovaná obnova (`private/eetRenewal`, jen Admin SDK). */
interface RenewalDoc {
  reqId?: string;
  startedAt?: unknown;
  oldSerial?: string;
  /** Nový certifikát zašifrovaný stejně jako `private/eet`, čeká na ack / převzetí. */
  staged?: PrivateEetDoc & { serial: string };
  acked?: boolean;
}

export interface RenewOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Načtení aktuálního certifikátu (testy); výchozí getStoreCredentials. */
  loadCredentials?: (uid: string, storeId: string) => Promise<EetCredentials>;
  sleep?: (ms: number) => Promise<void>;
  /** Jak dlouho v jednom běhu čekat na vydání (INPROCESS), pak pokračuje další běh. */
  maxPollMs?: number;
}

export const daysUntil = (to: Date, now: Date) => Math.ceil((to.getTime() - now.getTime()) / DAY_MS);

export async function renewStoreCertificate(db: Db, uid: string, storeId: string, opts: RenewOptions = {}): Promise<RenewOutcome> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const storeRef = db.doc(paths.store(uid, storeId));
  const renewalRef = db.doc(paths.privateEetRenewal(uid, storeId));

  const store = (await storeRef.get()).data() as Pick<Store, 'eet'> | undefined;
  if (!isEetEnabled(store)) return { outcome: 'skipped', reason: 'disabled' };
  const cert = store?.eet?.certificate;
  const validTo = toDate(cert?.validTo);
  if (!cert || !validTo) return { outcome: 'skipped', reason: 'no_certificate' };
  const daysLeft = daysUntil(validTo, now());

  const renewal = ((await renewalRef.get()).data() ?? {}) as RenewalDoc;
  const publish = (state: StoreEetCertificateRenewal['state'], message?: string) =>
    storeRef.update({ 'eet.certificateRenewal': { state, at: ts(now()), ...(message ? { message } : {}) } });

  if (!renewal.reqId) {
    if (cert.env !== 'production') return { outcome: 'skipped', reason: 'not_production', daysLeft };
    if (validTo.getTime() <= now().getTime()) return { outcome: 'skipped', reason: 'expired', daysLeft };
    if (daysLeft > RENEW_BEFORE_DAYS) return { outcome: 'skipped', reason: 'not_due', daysLeft };
  }

  try {
    const loadCredentials = opts.loadCredentials ?? ((u: string, s: string) => getStoreCredentials(db, u, s));
    // Aktuální (obnovovaný) certifikát: podepisuje JWT pro všechna volání této žádosti.
    const creds = await loadCredentials(uid, storeId);
    const ca = createCaClient({ creds, fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl, now });

    let reqId = renewal.reqId;
    if (!reqId) {
      // Navázat na neukončenou žádost (pád po renew před uložením reqId), jinak podat novou.
      reqId = (await ca.notFinished())[0] ?? (await ca.renew()).reqId;
      await renewalRef.set({ reqId, startedAt: ts(now()), oldSerial: cert.serial } satisfies RenewalDoc);
      await publish('in_process');
    }

    // Už převzato a potvrzeno, jen se nepovedlo přepnout → dokončit.
    if (renewal.staged && renewal.acked) return await promote(db, uid, storeId, renewal.staged, now, cert.env);

    const status = await pollStatus(ca, reqId, opts.maxPollMs ?? DEFAULT_MAX_POLL_MS, sleep);
    if (status.state === 'INPROCESS') return { outcome: 'in_process', daysLeft, reqId };
    if (status.state === 'REJECTED') {
      await renewalRef.delete();
      const message = `CA EET žádost o nový certifikát zamítla: ${status.rejectedReason || 'bez udání důvodu'}`;
      await publish('rejected', message);
      return { outcome: 'rejected', daysLeft, message };
    }
    if (status.state === 'FINISHED') {
      if (renewal.staged) return await promote(db, uid, storeId, renewal.staged, now, cert.env);
      await renewalRef.delete();
      const message = 'Žádost o nový certifikát je ukončená, ale certifikát se nepodařilo převzít. Stáhněte ho v DIS+ a nahrajte ručně.';
      await publish('failed', message);
      return { outcome: 'failed', daysLeft, message };
    }

    // ISSUED / DELIVERING: převzít (v DELIVERING jde opakovaně až do ack).
    let staged = renewal.staged;
    if (!staged) {
      const dl = await ca.claimDownload(reqId);
      const p12 = Buffer.from(dl.pkcs12, 'base64');
      let next: EetCredentials;
      try {
        next = loadP12(p12, dl.password);
      } catch {
        throw new RenewError('Nový certifikát z CA EET nejde otevřít');
      }
      const settings = resolveEetSettings(store?.eet);
      const { problems } = checkCertificate({ creds: next, eic: settings.eic || cert.subjectEic, environment: cert.env, now: now() });
      // Bez ack: certifikát jde do 30 dnů od vydání stáhnout znovu (ručně v DIS+ nebo dalším během).
      if (problems.length) throw new RenewError(`Nový certifikát z CA EET neprošel kontrolou: ${problems.join('; ')}`);
      staged = { ...encryptCredentials(uid, storeId, p12, dl.password), serial: next.serial };
      await renewalRef.update({ staged });
    }

    await ca.ackDownload(reqId);
    await renewalRef.update({ acked: true });
    return await promote(db, uid, storeId, staged, now, cert.env);
  } catch (e) {
    const message = renewErrorMessage(e);
    await publish('failed', message).catch(() => undefined);
    return { outcome: 'failed', daysLeft, message };
  }
}

/** Nový certifikát do `private/eet` a metadata na prodejnu; rozpracovaná obnova se smaže. */
async function promote(
  db: Db,
  uid: string,
  storeId: string,
  staged: NonNullable<RenewalDoc['staged']>,
  now: () => Date,
  env: EetEnvironmentId
): Promise<RenewOutcome> {
  const enc: PrivateEetDoc = { p12Enc: staged.p12Enc, passEnc: staged.passEnc, keyVersion: staged.keyVersion };
  await db.doc(paths.privateEet(uid, storeId)).set({ ...enc, uploadedAt: ts(now()), source: 'ca-renew' });
  invalidateStoreCredentials(uid, storeId);
  let creds: EetCredentials;
  try {
    creds = await getStoreCredentials(db, uid, storeId, () => now().getTime());
  } catch (e) {
    throw new RenewError(`Nový certifikát se nepodařilo načíst: ${(e as Error).message}`);
  }
  const certificate = {
    subjectEic: creds.subjectCN.toUpperCase(),
    serial: creds.serial,
    validFrom: ts(creds.notBefore),
    validTo: ts(creds.notAfter),
    uploadedAt: ts(now()),
    env,
    source: 'ca-renew',
  };
  await db.doc(paths.store(uid, storeId)).update({
    'eet.certificate': certificate,
    'eet.certificateRenewal': { state: 'renewed', at: ts(now()) },
  });
  await db.doc(paths.privateEetRenewal(uid, storeId)).delete();
  return { outcome: 'renewed', daysLeft: daysUntil(creds.notAfter, now()), validTo: creds.notAfter.toISOString() };
}

async function pollStatus(ca: CaClient, reqId: string, maxPollMs: number, sleep: (ms: number) => Promise<void>) {
  let waited = 0;
  for (;;) {
    const st = await ca.status(reqId);
    if (st.state !== 'INPROCESS') return st;
    const step = Math.min(st.pollAfterSeconds, MAX_POLL_STEP_SEC) * 1000;
    if (waited + step > maxPollMs) return st;
    await sleep(step);
    waited += step;
  }
}

class RenewError extends Error {}

/** Text chyby bez citlivých dat (jen naše zprávy a ErrorDTO.message z CA). */
function renewErrorMessage(e: unknown): string {
  if (e instanceof CaApiError) {
    if (e.status === 401) return 'CA EET odmítla přihlášení certifikátem (je platný a pro produkci?). Nahrajte nový certifikát ručně.';
    if (e.status === 429) return 'CA EET: příliš mnoho požadavků, zkusí se to znovu zítra.';
    return e.message;
  }
  if (e instanceof RenewError || e instanceof EetCredentialsError) return e.message;
  console.error('EET cert-renew: neočekávaná chyba', (e as Error)?.name);
  return 'Automatická obnova certifikátu selhala, zkusí se znovu zítra.';
}

export interface RenewSummary {
  checked: number;
  results: ({ uid: string; storeId: string } & RenewOutcome)[];
}

/** Všechny prodejny se zapnutým EET (collection group `stores`, index v firestore.indexes.json). */
export async function renewDueCertificates(db: Db, opts: RenewOptions = {}): Promise<RenewSummary> {
  const snap = await db.collectionGroup('stores').where('eet.enabled', '==', true).get();
  const results: RenewSummary['results'] = [];
  for (const d of snap.docs) {
    const m = /^users\/([^/]+)\/stores\/([^/]+)$/.exec(d.ref.path);
    if (!m) continue;
    const r = await renewStoreCertificate(db, m[1], m[2], opts);
    results.push({ uid: m[1], storeId: m[2], ...r });
  }
  return { checked: snap.size, results };
}
