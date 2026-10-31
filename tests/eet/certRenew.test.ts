import { X509Certificate, createPublicKey, generateKeyPairSync, verify as rsaVerify } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CA_JWT_TTL_SEC, CaApiError, buildCaJwt, createCaClient, x5tS256 } from '@/lib/eet/caApi';
import { RENEW_BEFORE_DAYS, renewDueCertificates, renewStoreCertificate } from '@/lib/eet/certRenew';
import { clearCredentialsCache, encryptCredentials, getStoreCredentials } from '@/lib/eet/credentials';
import { loadP12 } from '@/lib/eet/sign';
import type { EetCredentials } from '@/lib/eet/types';
import { certificateNotice } from '@/lib/eetUi';
import { MockFirestore, asDb } from './firestoreMock';
import { playgroundP12, playgroundPassword } from './helpers';

const UID = 'user1';
const STORE = 'store1';
const STORE_PATH = `users/${UID}/stores/${STORE}`;
const EIC = 'CZ00000019';
const PROD_OID = '1.2.203.19122063.10.1.102.0.1';
const PLAY_OID = '1.2.203.19122063.10.2.102.0.1';
const NOW = new Date('2026-12-15T09:00:00Z');
const DAY = 86_400_000;
const REQ = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const KEY = Buffer.alloc(32, 9).toString('base64');

/** Testovací .p12 (3DES jako u CA EET) s danou politikou a platností; klíč z node:crypto (rychlé). */
function makeP12(opts: { cn?: string; oid?: string; from: Date; to: Date; serial: string; password: string }) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.from;
  cert.validity.notAfter = opts.to;
  const attrs = [{ name: 'commonName', value: opts.cn ?? EIC }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'Test CA EET' }]);
  const policies = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer(opts.oid ?? PROD_OID).getBytes()),
    ]),
  ]);
  cert.setExtensions([{ id: '2.5.29.32', critical: false, value: forge.asn1.toDer(policies).getBytes() }]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], opts.password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const OLD_PASS = 'Old12345';
const NEW_PASS = 'New67890';
const oldP12 = makeP12({ from: new Date(NOW.getTime() - 346 * DAY), to: new Date(NOW.getTime() + 20 * DAY), serial: '0a01', password: OLD_PASS });
const newP12 = makeP12({ from: new Date(NOW.getTime() - 60_000), to: new Date(NOW.getTime() + 366 * DAY), serial: '0b02', password: NEW_PASS });
const oldCreds = loadP12(oldP12, OLD_PASS);

function seedStore(mock: MockFirestore, over: { validTo?: Date; env?: string; enabled?: boolean; eic?: string } = {}) {
  mock.seed(STORE_PATH, {
    name: 'Test',
    eet: {
      enabled: over.enabled ?? true,
      environment: over.env ?? 'production',
      eic: over.eic ?? EIC,
      unitId: 303,
      certificate: {
        subjectEic: EIC,
        serial: oldCreds.serial,
        validFrom: Timestamp.fromDate(oldCreds.notBefore),
        validTo: Timestamp.fromDate(over.validTo ?? oldCreds.notAfter),
        uploadedAt: Timestamp.fromDate(oldCreds.notBefore),
        env: over.env ?? 'production',
      },
    },
  });
  mock.seed(`${STORE_PATH}/private/eet`, { ...encryptCredentials(UID, STORE, oldP12, OLD_PASS), uploadedAt: Timestamp.fromDate(oldCreds.notBefore) });
}

type Handler = (req: { method: string; path: string; auth: string }) => { status: number; body?: unknown; headers?: Record<string, string> };

/** Mock CA API: odpovědi podle "METODA cesta"; zaznamená volání. */
function caFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: { method: string; path: string; auth: string }[] = [];
  const counters = new Map<string, number>();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://ca.caeet.gov.cz/api', '');
    const method = String(init.method);
    const auth = String((init.headers as Record<string, string>).Authorization ?? '');
    const req = { method, path, auth };
    calls.push(req);
    const key = `${method} ${path}`;
    const r = routes[key];
    if (!r) return new Response(JSON.stringify({ code: 4, message: 'Unknown object.' }), { status: 404 });
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const h = Array.isArray(r) ? r[Math.min(n, r.length - 1)] : r;
    const out = h(req);
    return new Response(out.status === 204 ? null : JSON.stringify(out.body ?? {}), { status: out.status, headers: out.headers });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const claimBody = () => ({
  pkcs12: newP12.toString('base64'),
  password: NEW_PASS,
  certificate: { sn: '2818', validFrom: '2026-12-15 08:59:00+00:00', validTo: '2027-12-16 09:00:00+00:00', state: 'VALID' },
});

const happyRoutes = (): Record<string, Handler | Handler[]> => ({
  'GET /request/not-finished': () => ({ status: 200, body: { count: 0, data: [] } }),
  'POST /request/renew': () => ({ status: 201, body: { reqId: REQ } }),
  [`GET /request/${REQ}/status`]: [
    () => ({ status: 200, body: { reqId: REQ, state: 'INPROCESS', pollAfterSeconds: 2 }, headers: { 'Retry-After': '2' } }),
    () => ({ status: 200, body: { reqId: REQ, state: 'ISSUED' } }),
  ],
  [`POST /request/${REQ}/claim-download`]: () => ({ status: 200, body: claimBody() }),
  [`POST /request/${REQ}/ack-download`]: () => ({ status: 204 }),
});

/** JWT ověřený nezávisle: X509Certificate (veřejný klíč a otisk z DER), ne z našeho kódu. */
function verifyJwt(token: string, certDerB64: string, now: Date) {
  const [h, p, s] = token.split('.');
  const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
  const header = dec(h);
  const payload = dec(p);
  const x509 = new X509Certificate(Buffer.from(certDerB64, 'base64'));
  const fp = Buffer.from(x509.fingerprint256.replace(/:/g, ''), 'hex').toString('base64url');
  const ok = rsaVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey(x509.publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(s, 'base64url'));
  return { header, payload, ok, fp, nowSec: Math.floor(now.getTime() / 1000) };
}

let mock: MockFirestore;
const now = () => new Date(NOW);
const sleep = vi.fn(async () => undefined);
const loadCredentials = async (): Promise<EetCredentials> => getStoreCredentials(asDb(mock), UID, STORE, () => NOW.getTime());

beforeEach(() => {
  vi.stubEnv('EET_MASTER_KEY', KEY);
  clearCredentialsCache();
  mock = new MockFirestore(now);
  sleep.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('caApi: JWT RS256 s x5t#S256', () => {
  it('hlavička, payload a podpis ověřené nezávisle přes node:crypto (playground certifikát)', () => {
    const creds = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
    const jwt = buildCaJwt(creds, NOW);
    const v = verifyJwt(jwt, creds.certDerB64, NOW);
    expect(v.ok).toBe(true);
    expect(v.header).toEqual({ alg: 'RS256', typ: 'JWT', 'x5t#S256': v.fp });
    expect(v.header).not.toHaveProperty('x5c');
    expect(x5tS256(creds.certDerB64)).toBe(v.fp);
    expect(v.payload).toEqual({ iat: v.nowSec, exp: v.nowSec + CA_JWT_TTL_SEC });
    expect(v.payload.exp - v.payload.iat).toBeLessThanOrEqual(300);
    expect(jwt).not.toMatch(/[+/=]/); // base64url bez paddingu
  });

  it('podpis jiným klíčem neprojde ověřením', () => {
    const a = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
    const b = loadP12(playgroundP12('CZ683555118'), playgroundPassword());
    expect(verifyJwt(buildCaJwt(a, NOW), b.certDerB64, NOW).ok).toBe(false);
  });
});

describe('caApi: klient', () => {
  it('endpointy, metody, čerstvý token u každého volání, Retry-After', async () => {
    const { calls, fetchImpl } = caFetch({
      'POST /request/renew': () => ({ status: 201, body: { reqId: REQ } }),
      [`GET /request/${REQ}/status`]: () => ({ status: 200, body: { reqId: REQ, state: 'INPROCESS' }, headers: { 'Retry-After': '7' } }),
      'GET /request/not-finished': () => ({ status: 200, body: { count: 2, data: [REQ, 'nesmysl'] } }),
    });
    const ca = createCaClient({ creds: oldCreds, fetchImpl, now });
    expect(await ca.renew()).toEqual({ reqId: REQ });
    expect(await ca.status(REQ)).toEqual({ reqId: REQ, state: 'INPROCESS', pollAfterSeconds: 7 });
    expect(await ca.notFinished()).toEqual([REQ]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /request/renew', `GET /request/${REQ}/status`, 'GET /request/not-finished']);
    for (const c of calls) {
      expect(c.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(verifyJwt(c.auth.slice(7), oldCreds.certDerB64, NOW).ok).toBe(true);
    }
  });

  it('chyby: ErrorDTO → CaApiError se stavem a kódem; neplatné reqId se do URL nedostane', async () => {
    const { calls, fetchImpl } = caFetch({ 'POST /request/renew': () => ({ status: 429, body: { code: 6, message: 'Too many requests.' } }) });
    const ca = createCaClient({ creds: oldCreds, fetchImpl, now });
    await expect(ca.renew()).rejects.toMatchObject({ status: 429, caCode: 6, message: 'CA EET: Too many requests.' });
    await expect(ca.status('../../admin')).rejects.toBeInstanceOf(CaApiError);
    expect(calls).toHaveLength(1);
  });

  it('síťová chyba a ack s jiným stavem než 204', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createCaClient({ creds: oldCreds, fetchImpl: failing, now }).renew()).rejects.toMatchObject({ status: 0, message: 'CA EET: síťová chyba' });
    const { fetchImpl } = caFetch({ [`POST /request/${REQ}/ack-download`]: () => ({ status: 409, body: { code: 5, message: 'Conflict.' } }) });
    await expect(createCaClient({ creds: oldCreds, fetchImpl, now }).ackDownload(REQ)).rejects.toMatchObject({ status: 409 });
  });
});

describe('renewStoreCertificate', () => {
  it(`obnoví ≤ ${RENEW_BEFORE_DAYS} dní před koncem: renew → status → claim → uložit → ack; JWT starým certifikátem`, async () => {
    seedStore(mock);
    const { calls, fetchImpl } = caFetch(happyRoutes());
    const r = await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials });
    expect(r).toMatchObject({ outcome: 'renewed', daysLeft: 366 });
    expect(calls.map((c) => `${c.method} ${c.path.replace(REQ, ':id')}`)).toEqual([
      'GET /request/not-finished',
      'POST /request/renew',
      'GET /request/:id/status',
      'GET /request/:id/status',
      'POST /request/:id/claim-download',
      'POST /request/:id/ack-download',
    ]);
    expect(sleep).toHaveBeenCalledWith(2000);
    for (const c of calls) expect(verifyJwt(c.auth.slice(7), oldCreds.certDerB64, NOW).header['x5t#S256']).toBe(x5tS256(oldCreds.certDerB64));

    const store = mock.read(STORE_PATH)!.eet as Record<string, any>;
    expect(store.certificate).toMatchObject({ serial: '0b02', subjectEic: EIC, env: 'production', source: 'ca-renew' });
    expect(store.certificate.validTo.toDate().toISOString()).toBe(new Date(NOW.getTime() + 366 * DAY).toISOString().replace(/\.\d+Z$/, '.000Z'));
    expect(store.certificateRenewal).toMatchObject({ state: 'renewed' });
    expect(store.enabled).toBe(true);
    expect(mock.read(`${STORE_PATH}/private/eetRenewal`)).toBeUndefined();
    clearCredentialsCache();
    expect((await loadCredentials()).serial).toBe('0b02');
    // Tajná data ve Firestore jen šifrovaně
    expect(JSON.stringify(mock.read(`${STORE_PATH}/private/eet`))).not.toContain(NEW_PASS);
  });

  it('nic nezaloguje z odpovědí CA (PKCS#12, heslo)', async () => {
    seedStore(mock);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { fetchImpl } = caFetch({ ...happyRoutes(), [`POST /request/${REQ}/ack-download`]: () => ({ status: 500, body: { code: 99, message: 'Internal error.' } }) });
    await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(NEW_PASS);
    expect(logged).not.toContain(newP12.toString('base64').slice(0, 40));
  });

  it('mimo lhůtu, vypnuté EET, playground a prošlý certifikát: nic nevolá', async () => {
    const { calls, fetchImpl } = caFetch(happyRoutes());
    const run = () => renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials });
    seedStore(mock, { validTo: new Date(NOW.getTime() + 22 * DAY) });
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'not_due', daysLeft: 22 });
    seedStore(mock, { enabled: false });
    expect(await run()).toEqual({ outcome: 'skipped', reason: 'disabled' });
    seedStore(mock, { env: 'playground' });
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'not_production' });
    seedStore(mock, { validTo: new Date(NOW.getTime() - DAY) });
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'expired' });
    expect(calls).toHaveLength(0);
  });

  it('INPROCESS déle než jeden běh: uloží reqId, další běh naváže (bez nového renew)', async () => {
    seedStore(mock);
    const routes = happyRoutes();
    routes[`GET /request/${REQ}/status`] = () => ({ status: 200, body: { reqId: REQ, state: 'INPROCESS', pollAfterSeconds: 30 } });
    const first = caFetch(routes);
    expect(await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl: first.fetchImpl, sleep, loadCredentials, maxPollMs: 5_000 })).toMatchObject({
      outcome: 'in_process',
      reqId: REQ,
    });
    expect(mock.read(`${STORE_PATH}/private/eetRenewal`)).toMatchObject({ reqId: REQ, oldSerial: '0a01' });
    expect((mock.read(STORE_PATH)!.eet as Record<string, any>).certificateRenewal).toMatchObject({ state: 'in_process' });
    expect(certificateNotice(mock.read(STORE_PATH) as never, NOW)?.text).toContain('čeká se na vydání');

    const second = caFetch({ ...happyRoutes(), [`GET /request/${REQ}/status`]: () => ({ status: 200, body: { reqId: REQ, state: 'ISSUED' } }) });
    expect(await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl: second.fetchImpl, sleep, loadCredentials })).toMatchObject({ outcome: 'renewed' });
    expect(second.calls.some((c) => c.path === '/request/renew' || c.path === '/request/not-finished')).toBe(false);
  });

  it('neukončená žádost z dřívějška (not-finished) se převezme místo nového renew', async () => {
    seedStore(mock);
    const { calls, fetchImpl } = caFetch({ ...happyRoutes(), 'GET /request/not-finished': () => ({ status: 200, body: { count: 1, data: [REQ] } }) });
    expect(await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials })).toMatchObject({ outcome: 'renewed' });
    expect(calls.some((c) => c.path === '/request/renew')).toBe(false);
  });

  it('ack selže: starý certifikát zůstane, nový čeká zašifrovaný; další běh (DELIVERING) jen potvrdí a přepne', async () => {
    seedStore(mock);
    const first = caFetch({ ...happyRoutes(), [`POST /request/${REQ}/ack-download`]: () => ({ status: 500, body: { code: 99, message: 'Internal error.' } }) });
    expect(await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl: first.fetchImpl, sleep, loadCredentials })).toMatchObject({
      outcome: 'failed',
      message: 'CA EET: Internal error.',
    });
    expect((mock.read(STORE_PATH)!.eet as Record<string, any>).certificate.serial).toBe('0a01');
    expect(mock.read(`${STORE_PATH}/private/eetRenewal`)).toMatchObject({ reqId: REQ, staged: { serial: '0b02' } });

    const second = caFetch({ ...happyRoutes(), [`GET /request/${REQ}/status`]: () => ({ status: 200, body: { reqId: REQ, state: 'DELIVERING' } }) });
    expect(await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl: second.fetchImpl, sleep, loadCredentials })).toMatchObject({ outcome: 'renewed' });
    expect(second.calls.map((c) => c.path.replace(REQ, ':id'))).toEqual(['/request/:id/status', '/request/:id/ack-download']);
    expect((mock.read(STORE_PATH)!.eet as Record<string, any>).certificate.serial).toBe('0b02');
  });

  it('REJECTED: zpráva pro obsluhu, rozpracovaná žádost smazaná, banner červený', async () => {
    seedStore(mock);
    const { fetchImpl } = caFetch({
      ...happyRoutes(),
      [`GET /request/${REQ}/status`]: () => ({ status: 200, body: { reqId: REQ, state: 'REJECTED', rejectedReason: 'Selhání kontroly parametrů žádosti' } }),
    });
    const r = await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials });
    expect(r).toMatchObject({ outcome: 'rejected', message: expect.stringContaining('Selhání kontroly parametrů žádosti') });
    expect(mock.read(`${STORE_PATH}/private/eetRenewal`)).toBeUndefined();
    expect(certificateNotice(mock.read(STORE_PATH) as never, NOW)).toMatchObject({ tone: 'danger', daysLeft: 20 });
  });

  it('nový certifikát pro jiné DIČ se neuloží ani nepotvrdí (jde stáhnout znovu)', async () => {
    seedStore(mock);
    const wrong = makeP12({ cn: 'CZ683555118', from: new Date(NOW.getTime() - 60_000), to: new Date(NOW.getTime() + 366 * DAY), serial: '0c03', password: NEW_PASS });
    const { calls, fetchImpl } = caFetch({ ...happyRoutes(), [`POST /request/${REQ}/claim-download`]: () => ({ status: 200, body: { ...claimBody(), pkcs12: wrong.toString('base64') } }) });
    const r = await renewStoreCertificate(asDb(mock), UID, STORE, { now, fetchImpl, sleep, loadCredentials });
    expect(r).toMatchObject({ outcome: 'failed', message: expect.stringContaining('CZ683555118') });
    expect(calls.some((c) => c.path.endsWith('/ack-download'))).toBe(false);
    expect((mock.read(STORE_PATH)!.eet as Record<string, any>).certificate.serial).toBe('0a01');
  });

  it('renewDueCertificates projde jen prodejny se zapnutým EET', async () => {
    seedStore(mock, { validTo: new Date(NOW.getTime() + 100 * DAY) });
    mock.seed(`users/u2/stores/s2`, { name: 'Bez EET' });
    mock.seed(`users/u3/stores/s3`, { name: 'Vypnuté', eet: { enabled: false } });
    const { calls, fetchImpl } = caFetch(happyRoutes());
    const r = await renewDueCertificates(asDb(mock), { now, fetchImpl, sleep, loadCredentials });
    expect(r).toEqual({ checked: 1, results: [{ uid: UID, storeId: STORE, outcome: 'skipped', reason: 'not_due', daysLeft: 100 }] });
    expect(calls).toHaveLength(0);
  });
});

describe('certificateNotice (banner, záloha k obnově)', () => {
  const store = (days: number, env = 'production', extra: object = {}) => ({
    eet: { enabled: true, certificate: { env, validTo: new Date(NOW.getTime() + days * DAY) } as never, ...extra },
  });
  it('bez EET, bez certifikátu a víc než 21 dní: nic', () => {
    expect(certificateNotice({ eet: { enabled: false, certificate: store(5).eet.certificate } }, NOW)).toBeNull();
    expect(certificateNotice({ eet: { enabled: true } }, NOW)).toBeNull();
    expect(certificateNotice(store(22), NOW)).toBeNull();
  });
  it('produkce: info → oranžová (≤ 14) → červená (≤ 3, prošlý, selhání)', () => {
    expect(certificateNotice(store(21), NOW)).toMatchObject({ tone: 'info', text: expect.stringContaining('vyprší za 21 dní') });
    expect(certificateNotice(store(10), NOW)?.tone).toBe('warning');
    expect(certificateNotice(store(2), NOW)).toMatchObject({ tone: 'danger', text: expect.stringContaining('za 2 dny') });
    expect(certificateNotice(store(-1), NOW)).toMatchObject({ tone: 'danger', text: expect.stringContaining('vypršel') });
    expect(certificateNotice(store(15, 'production', { certificateRenewal: { state: 'failed', at: NOW, message: 'X' } }), NOW)).toMatchObject({
      tone: 'danger',
      text: expect.stringContaining('selhala: X'),
    });
  });
  it('playground: obnova se nedělá, rovnou „nahrajte nový“', () => {
    expect(certificateNotice(store(10, 'playground'), NOW)).toMatchObject({ tone: 'warning', text: expect.stringContaining('Nahrajte nový') });
  });
});
