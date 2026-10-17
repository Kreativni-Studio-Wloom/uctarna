import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCertificate, environmentFromPolicyOids } from '@/lib/eet/certificate';
import { clearCredentialsCache, encryptCredentials, getStoreCredentials, invalidateStoreCredentials } from '@/lib/eet/credentials';
import { finalizeInputSchema, finalizeSale } from '@/lib/eet/finalize';
import { retryDueAll, retryDueForStore } from '@/lib/eet/queue';
import { stornoSale } from '@/lib/eet/storno';
import { STORE, STORE_PATH, UID, attrs, cashDraft, creds, eetFetch, eetSettings, loadCredentials, okBody, salePath, setup } from './fixturesC';
import { playgroundP12, playgroundPassword } from './helpers';
import { asDb } from './firestoreMock';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('storno', () => {
  async function withSale(over: Record<string, unknown> = {}) {
    const s = setup();
    s.mock.seed(`${STORE_PATH}/products/p1`, { soldCount: 3 });
    await finalizeSale(s.db, UID, finalizeInputSchema.parse({ storeId: STORE, documentId: 'orig000001', sale: cashDraft(over), ...('isTest' in over ? { isTest: over.isTest } : {}) }), {
      now: s.now,
      registerNow: false,
    });
    return s;
  }

  it('hotovost: záporný doklad s novým číslem → EET záporná tržba; původní dostane storno', async () => {
    const { mock, db, now } = await withSale();
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await stornoSale(db, UID, STORE, 'orig000001', { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r).toMatchObject({ receiptNo: '2026-000002', duplicate: false, eet: { status: 'sent' } });
    const st = mock.read(salePath(r.saleId))!;
    expect(st).toMatchObject({ stornoOf: 'orig000001', isRefund: true, totalAmount: -81.6, finalAmount: -81.6, refundAmount: 81.6, items: [{ productId: 'p1', quantity: -1 }] });
    expect(mock.read(salePath('orig000001'))!.storno).toMatchObject({ by: UID, saleId: r.saleId });
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ celk_trzba: '-81.60', porad_cis: '2026-000002' });
    expect(mock.read(`${STORE_PATH}/products/p1`)).toMatchObject({ soldCount: 3 }); // +1 prodej, −1 storno
  });

  it('idempotence: druhé storno vrátí první, nové číslo nevznikne', async () => {
    const { mock, db, now } = await withSale();
    const a = await stornoSale(db, UID, STORE, 'orig000001', { now, registerNow: false });
    const b = await stornoSale(db, UID, STORE, 'orig000001', { now, registerNow: false });
    expect(b).toMatchObject({ duplicate: true, saleId: a.saleId, receiptNo: a.receiptNo });
    expect(mock.read(`${STORE_PATH}/counters/receipts`)).toMatchObject({ last: 2 });
  });

  it.each(['card', 'qr'] as const)('%s: bezhotovostní vratka zaevidovaného dokladu se odešle jako záporná tržba', async (paymentMethod) => {
    const { db, now } = await withSale({ paymentMethod, paidAmount: null, paidCurrency: null, changeAmount: null });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await stornoSale(db, UID, STORE, 'orig000001', { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r.eet).toMatchObject({ status: 'sent' });
    expect(calls).toHaveLength(1);
    expect(r.eet?.data?.celk_trzba).toMatch(/^-\d+\.\d\d$/);
  });

  it('testovací doklad, storno storna a vypnuté EET se odmítnou', async () => {
    const t = await withSale({ isTest: true });
    await expect(stornoSale(t.db, UID, STORE, 'orig000001', { now: t.now })).rejects.toMatchObject({ code: 'is_test' });

    const s = await withSale();
    const r = await stornoSale(s.db, UID, STORE, 'orig000001', { now: s.now, registerNow: false });
    await expect(stornoSale(s.db, UID, STORE, r.saleId, { now: s.now })).rejects.toMatchObject({ code: 'is_storno' });

    // Doklad bez EET identity (z doby před EET) při vypnutém EET: 409 jako dřív.
    s.mock.seed(salePath('legacy0001'), { ...cashDraft(), createdAt: Timestamp.fromDate(new Date('2026-10-01T10:00:00Z')) });
    s.mock.seed(STORE_PATH, { eet: { enabled: false } });
    await expect(stornoSale(s.db, UID, STORE, 'legacy0001', { now: s.now })).rejects.toMatchObject({ status: 409, code: 'eet_disabled' });
  });

  it('vypnuté EET: doklad s EET identitou jde stornovat, storno čeká (neodešle se) a dostane další číslo', async () => {
    const s = await withSale();
    s.mock.seed(STORE_PATH, { name: 'Test', eet: { ...eetSettings, enabled: false } });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await stornoSale(s.db, UID, STORE, 'orig000001', { now: s.now, registerOptions: { fetchImpl, loadCredentials, now: s.now } });
    expect(r).toMatchObject({ receiptNo: '2026-000002', duplicate: false, eet: { status: 'pending' } });
    expect(calls).toHaveLength(0);
    expect(s.mock.read(salePath('orig000001'))!.storno).toMatchObject({ saleId: r.saleId });
  });
});

describe('fronta', () => {
  it('retryDueForStore: jen pending/queued po termínu, nic jiného', async () => {
    const { mock, db, now } = setup();
    const due = Timestamp.fromDate(new Date('2026-10-17T09:59:00Z'));
    const later = Timestamp.fromDate(new Date('2026-10-17T10:30:00Z'));
    const base = { totalAmount: 10, finalAmount: 10, paymentMethod: 'cash', currency: 'CZK', createdAt: due };
    mock.seed(salePath('q-due'), { ...base, receiptNo: '2026-000001', eet: { status: 'queued', nextRetryAt: due, attempts: [] } });
    mock.seed(salePath('q-later'), { ...base, receiptNo: '2026-000002', eet: { status: 'queued', nextRetryAt: later, attempts: [] } });
    mock.seed(salePath('sent'), { ...base, receiptNo: '2026-000003', eet: { status: 'sent', pok: 'x' } });
    mock.seed(salePath('legacy'), { ...base });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await retryDueForStore(db, UID, STORE, { fetchImpl, loadCredentials, now });
    expect(r.results).toEqual([{ saleId: 'q-due', storeId: STORE, outcome: 'sent', reason: undefined }]);
    expect(calls).toHaveLength(1);
  });

  it('retryDueAll: collection group přes prodejny, dotaz status in + nextRetryAt <=', async () => {
    const { mock, db, now } = setup();
    mock.seed('users/u2/stores/s2', { eet: { enabled: true, environment: 'playground', eic: 'CZ00000019', unitId: 101 } });
    const past = Timestamp.fromDate(new Date('2026-10-17T09:00:00Z'));
    const base = { totalAmount: 10, finalAmount: 10, paymentMethod: 'cash', currency: 'CZK', createdAt: past };
    mock.seed(salePath('a'), { ...base, receiptNo: 'A1', eet: { status: 'queued', nextRetryAt: past } });
    mock.seed('users/u2/stores/s2/sales/b', { ...base, receiptNo: 'B1', eet: { status: 'pending', nextRetryAt: past } });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await retryDueAll(db, { fetchImpl, loadCredentials, now });
    expect(r.results.map((x) => [x.saleId, x.outcome]).sort()).toEqual([
      ['a', 'sent'],
      ['b', 'sent'],
    ]);
    expect(calls).toHaveLength(2);
    expect(mock.queries.at(-1)!.map((f) => `${f.field} ${f.op}`)).toEqual(['eet.status in', 'eet.nextRetryAt <=']);
  });
});

describe('credentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearCredentialsCache();
  });

  it('šifrovaně uložený .p12 se dešifruje jen pro svou prodejnu; cache 5 min; invalidace', async () => {
    vi.stubEnv('EET_MASTER_KEY', KEY);
    const { mock } = setup();
    const db = asDb(mock);
    const p12 = playgroundP12('CZ00000019');
    const enc = encryptCredentials(UID, STORE, p12, playgroundPassword());
    expect(enc.p12Enc).not.toContain(p12.toString('base64').slice(0, 20));
    mock.seed(`${STORE_PATH}/private/eet`, { ...enc });

    const spy = vi.spyOn(mock, '_snap');
    let t = 0;
    const c1 = await getStoreCredentials(db, UID, STORE, () => t);
    expect(c1.subjectCN).toBe('CZ00000019');
    await getStoreCredentials(db, UID, STORE, () => t);
    expect(spy).toHaveBeenCalledTimes(1);
    t = 5 * 60_000 + 1;
    await getStoreCredentials(db, UID, STORE, () => t);
    expect(spy).toHaveBeenCalledTimes(2);
    invalidateStoreCredentials(UID, STORE);
    await getStoreCredentials(db, UID, STORE, () => t);
    expect(spy).toHaveBeenCalledTimes(3);

    // přenesený šifrovaný text do jiné prodejny nejde dešifrovat (aad)
    mock.seed(`users/${UID}/stores/jina/private/eet`, { ...enc });
    await expect(getStoreCredentials(db, UID, 'jina')).rejects.toThrow(/nejde načíst/);
    await expect(getStoreCredentials(db, UID, 'bez-certifikatu')).rejects.toThrow(/nemá nahraný/);
  });
});

describe('kontrola certifikátu', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  it('playground certifikát: CN = EIČ, platnost, prostředí z OID', () => {
    expect(environmentFromPolicyOids(creds.policyOids)).toBe('playground');
    expect(checkCertificate({ creds, eic: 'cz00000019', environment: 'playground', now })).toEqual({ problems: [], env: 'playground' });
  });

  it('odmítne jiné DIČ, jiné prostředí, prošlý certifikát a neznámé OID', () => {
    expect(checkCertificate({ creds, eic: 'CZ683555118', environment: 'playground', now }).problems.join()).toMatch(/vydaný pro CZ00000019/);
    expect(checkCertificate({ creds, eic: '', environment: 'playground', now }).problems.join()).toMatch(/vyplňte DIČ/);
    expect(checkCertificate({ creds, eic: 'CZ00000019', environment: 'production', now }).problems.join()).toMatch(/Playground/);
    expect(checkCertificate({ creds, eic: 'CZ00000019', environment: 'playground', now: new Date(creds.notAfter.getTime() + 1) }).problems.join()).toMatch(/skončila/);
    expect(checkCertificate({ creds: { ...creds, policyOids: ['1.2.3'] }, eic: 'CZ00000019', environment: 'playground', now }).problems.join()).toMatch(/Neznámá/);
  });
});
