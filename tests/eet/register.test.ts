import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { registerSale, LOCK_MS } from '@/lib/eet/register';
import { saveSumUpSale } from '@/lib/eet/sumupSale';
import type { SaleEet } from '@/types';
import { POK, STORE, STORE_PATH, UID, attrs, eetFetch, errBody, loadCredentials, okBody, salePath, setup } from './fixturesC';

// Firestore emulator potřebuje Javu (na tomto stroji chybí) → in-memory mock (tests/eet/firestoreMock.ts).

const MIN = 60_000;

function seedPendingSale(mock: ReturnType<typeof setup>['mock'], id = 'sale1', over: Record<string, unknown> = {}) {
  mock.seed(salePath(id), {
    items: [{ productId: 'p1', productName: 'Káva', price: 81.6, quantity: 1 }],
    totalAmount: 81.6,
    finalAmount: 81.6,
    paymentMethod: 'cash',
    currency: 'CZK',
    createdAt: Timestamp.fromDate(new Date('2026-10-17T10:00:00Z')),
    receiptNo: '2026-000001',
    eet: { status: 'pending', env: 'playground', saleAt: '2026-10-17T10:00:00.000Z', attempts: [], nextRetryAt: Timestamp.fromDate(new Date('2026-10-17T10:01:00Z')) },
    ...over,
  });
}

const eetOf = (mock: ReturnType<typeof setup>['mock'], id = 'sale1') => mock.read(salePath(id))!.eet as SaleEet & Record<string, unknown>;

describe('registerSale', () => {
  it('1. pokus OK: zmrazí Data, uloží POK a pokus, uvolní zámek', async () => {
    const { mock, db, now } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });

    expect(r.outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    const eet = eetOf(mock);
    expect(eet).toMatchObject({ status: 'sent', pok: POK, nextRetryAt: null, lockUntil: null, overdue: false });
    expect(eet.data).toEqual({
      eic: 'CZ00000019',
      unitId: 303,
      registerId: 'WEB1',
      porad_cis: '2026-000001',
      dat_trzby: '2026-10-17T12:00:00+02:00',
      celk_trzba: '81.60',
    });
    expect(eet.attempts).toHaveLength(1);
    expect(eet.attempts![0]).toMatchObject({ first: true, result: 'ok', xGlobalTransactionId: 'gtid-1', uuid: calls[0].uuid });
    expect((eet.firstAttemptAt as Timestamp).toDate().toISOString()).toBe('2026-10-17T10:00:00.000Z');
    expect(attrs(calls[0].body, 'Hlavicka').prvni_zaslani).toBe('true');
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ porad_cis: '2026-000001', celk_trzba: '81.60', id_pokl: 'WEB1' });
  });

  it('timeout → queued + nextRetryAt; opakování: prvni_zaslani=false, nové UUID, stejná Data', async () => {
    const { mock, db, now, clock } = setup();
    mock.seed(STORE_PATH, { eet: { enabled: true, environment: 'playground', eic: 'CZ00000019', unitId: 303, sendTimeoutMs: 2000 } });
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(() => 'timeout', okBody);

    const r1 = await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });
    expect(r1.outcome).toBe('queued');
    let eet = eetOf(mock);
    expect(eet.status).toBe('queued');
    expect(eet.attempts![0]).toMatchObject({ first: true, result: 'timeout' });
    expect((eet.nextRetryAt as Timestamp).toMillis() - clock.t.getTime()).toBe(MIN);
    expect(eet.message).toMatch(/neodpověděla/);

    // Fronta před termínem nic neodešle.
    const early = await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now });
    expect(early).toMatchObject({ outcome: 'skipped', reason: 'not_due' });
    expect(calls).toHaveLength(1);

    clock.t = new Date(clock.t.getTime() + 2 * MIN);
    const r2 = await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now });
    expect(r2.outcome).toBe('sent');
    expect(calls).toHaveLength(2);
    expect(calls[1].uuid).not.toBe(calls[0].uuid);
    expect(attrs(calls[1].body, 'Hlavicka').prvni_zaslani).toBe('false');
    expect(attrs(calls[1].body, 'Data')).toEqual(attrs(calls[0].body, 'Data'));
    eet = eetOf(mock);
    expect(eet.attempts!.map((a) => [a.first, a.result])).toEqual([
      [true, 'timeout'],
      [false, 'ok'],
    ]);
  }, 10_000);

  it('síťová chyba při 2. pokusu: backoff podle pořadí pokusu (2 min)', async () => {
    const { mock, db, now, clock } = setup();
    seedPendingSale(mock);
    const { fetchImpl } = eetFetch(() => 'network');
    await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });
    clock.t = new Date(clock.t.getTime() + 5 * MIN);
    await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now });
    const eet = eetOf(mock);
    expect(eet.attempts).toHaveLength(2);
    expect((eet.nextRetryAt as Timestamp).toMillis() - clock.t.getTime()).toBe(2 * MIN);
  });

  it('trvalá chyba (kód 4) → failed_permanent; fronta ji přeskočí, ruční odeslání ano', async () => {
    const { mock, db, now, clock } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(errBody(4), okBody);
    const r = await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });
    expect(r.outcome).toBe('failed_permanent');
    expect(eetOf(mock)).toMatchObject({ status: 'failed_permanent', nextRetryAt: null });
    expect(eetOf(mock).attempts![0]).toMatchObject({ result: 'error', code: 4 });

    clock.t = new Date(clock.t.getTime() + 60 * MIN);
    expect(await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now })).toMatchObject({ outcome: 'skipped', reason: 'final' });
    expect(calls).toHaveLength(1);

    const manual = await registerSale(db, UID, STORE, 'sale1', { mode: 'manual', fetchImpl, loadCredentials, now });
    expect(manual.outcome).toBe('sent');
    expect(attrs(calls[1].body, 'Hlavicka').prvni_zaslani).toBe('false');
  });

  it('chyba 8 se zkusí 3× znovu, pak je trvalá', async () => {
    const { mock, db, now, clock } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(errBody(8));
    const statuses: string[] = [];
    for (let i = 0; i < 5; i++) {
      await registerSale(db, UID, STORE, 'sale1', { mode: i === 0 ? 'auto' : 'retry', fetchImpl, loadCredentials, now });
      statuses.push(eetOf(mock).status);
      clock.t = new Date(clock.t.getTime() + 60 * MIN);
    }
    expect(statuses).toEqual(['queued', 'queued', 'queued', 'failed_permanent', 'failed_permanent']);
    expect(calls).toHaveLength(4);
  });

  it('idempotence: dvě souběžná volání odešlou jen jednou (zámek v transakci)', async () => {
    const { mock, db, now } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(okBody);
    const [a, b] = await Promise.all([
      registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now }),
      registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now }),
    ]);
    expect(calls).toHaveLength(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['sent', 'skipped']);
    const skipped = [a, b].find((x) => x.outcome === 'skipped')!;
    expect(skipped).toMatchObject({ reason: 'locked' });
    expect(mock.txRetries).toBeGreaterThan(0);
    expect(eetOf(mock).attempts).toHaveLength(1);
  });

  it('idempotence: odeslaný doklad se znovu neodešle (ani ručně)', async () => {
    const { mock, db, now } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(okBody);
    await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });
    for (const mode of ['auto', 'retry', 'manual'] as const) {
      expect(await registerSale(db, UID, STORE, 'sale1', { mode, fetchImpl, loadCredentials, now })).toMatchObject({ outcome: 'skipped', reason: 'final' });
    }
    expect(calls).toHaveLength(1);
  });

  it('pád serveru po odeslání: po vypršení zámku je další pokus prvni_zaslani=false se stejnými Data', async () => {
    const { mock, db, now, clock } = setup();
    const frozen = { eic: 'CZ00000019', unitId: 303, registerId: 'WEB1', porad_cis: '2026-000001', dat_trzby: '2026-10-17T12:00:00+02:00', celk_trzba: '81.60' };
    seedPendingSale(mock, 'sale1', {
      eet: {
        status: 'pending',
        env: 'playground',
        data: frozen,
        attempts: [],
        firstAttemptAt: Timestamp.fromDate(clock.t),
        lockUntil: Timestamp.fromDate(new Date(clock.t.getTime() + LOCK_MS)),
        nextRetryAt: Timestamp.fromDate(new Date(clock.t.getTime() + MIN)),
      },
    });
    const { calls, fetchImpl } = eetFetch(okBody);
    expect(await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now })).toMatchObject({ reason: 'not_due' });
    clock.t = new Date(clock.t.getTime() + 30_000);
    expect(await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now })).toMatchObject({ reason: 'locked' });
    clock.t = new Date(clock.t.getTime() + LOCK_MS);
    expect((await registerSale(db, UID, STORE, 'sale1', { mode: 'retry', fetchImpl, loadCredentials, now })).outcome).toBe('sent');
    expect(attrs(calls[0].body, 'Hlavicka').prvni_zaslani).toBe('false');
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ porad_cis: '2026-000001', dat_trzby: '2026-10-17T12:00:00+02:00' });
  });

  it('dvojí SumUp callback: doklad i číslo jen jednou, odeslání jen jednou', async () => {
    const { mock, db, now } = setup();
    const sale = { items: [{ productId: 'p1', quantity: 1 }], totalAmount: 120, finalAmount: 120, paymentMethod: 'card', documentId: 'abc123defg', tipAmount: null };
    const input = { userId: UID, storeId: STORE, saleDocId: 'abc123defg', sale, authUid: UID, now: now() };
    const [s1, s2] = await Promise.all([saveSumUpSale(db, input), saveSumUpSale(db, input)]);
    expect([s1.alreadyExists, s2.alreadyExists].sort()).toEqual([false, true]);
    expect(mock.read(`${STORE_PATH}/counters/receipts`)).toMatchObject({ last: 1 });

    const { calls, fetchImpl } = eetFetch(okBody);
    await Promise.all([s1, s2].filter((s) => !s.alreadyExists).flatMap(() => [
      registerSale(db, UID, STORE, 'abc123defg', { fetchImpl, loadCredentials, now }),
      registerSale(db, UID, STORE, 'abc123defg', { fetchImpl, loadCredentials, now }),
    ]));
    expect(calls).toHaveLength(1);
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ celk_trzba: '120.00', porad_cis: '2026-000001' });
  });

  it('vypnuté EET: z fronty se nic neodešle (stav zůstane)', async () => {
    const { mock, db, now } = setup({ eet: { ...{ enabled: false, eic: 'CZ00000019', unitId: 303 } } });
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(okBody);
    expect(await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now })).toMatchObject({ outcome: 'skipped', reason: 'disabled' });
    expect(calls).toHaveLength(0);
    expect(eetOf(mock).status).toBe('pending');
  });

  it('doklad bez eet (prodejna bez EET, starý doklad) se nikdy neodešle', async () => {
    const { mock, db, now } = setup();
    mock.seed(salePath('old'), { totalAmount: 10, paymentMethod: 'cash' });
    const { calls, fetchImpl } = eetFetch(okBody);
    expect(await registerSale(db, UID, STORE, 'old', { mode: 'manual', fetchImpl, loadCredentials, now })).toMatchObject({ reason: 'no_eet' });
    expect(calls).toHaveLength(0);
    expect(mock.read(salePath('old'))).toEqual({ totalAmount: 10, paymentMethod: 'cash' });
  });

  it('offline doklad (pendingNumber): číslo z řady až při odeslání, dat_trzby = okamžik prodeje', async () => {
    const { mock, db, now, clock } = setup();
    mock.seed(`${STORE_PATH}/counters/receipts`, { year: 2026, last: 41 });
    mock.seed(salePath('off1'), {
      items: [], totalAmount: -50, finalAmount: -50, paymentMethod: 'cash', currency: 'CZK', isRefund: true,
      pendingNumber: true,
      eet: { status: 'queued', saleAt: '2026-10-17T08:30:00.000Z', nextRetryAt: new Date('2026-10-17T08:30:00Z') },
    });
    clock.t = new Date('2026-10-17T11:00:00Z');
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await registerSale(db, UID, STORE, 'off1', { mode: 'retry', fetchImpl, loadCredentials, now });
    expect(r).toMatchObject({ outcome: 'sent', receiptNo: '2026-000042' });
    const doc = mock.read(salePath('off1'))!;
    expect(doc).toMatchObject({ receiptNo: '2026-000042', pendingNumber: false });
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ porad_cis: '2026-000042', dat_trzby: '2026-10-17T10:30:00+02:00', celk_trzba: '-50.00' });
    expect(attrs(calls[0].body, 'Hlavicka').prvni_zaslani).toBe('true');
  });

  it('offline testovací doklad: dostane číslo, ale nikdy se neodešle', async () => {
    const { mock, db, now } = setup();
    mock.seed(salePath('t1'), { totalAmount: 10, paymentMethod: 'cash', isTest: true, pendingNumber: true, eet: { status: 'queued', nextRetryAt: new Date(0) } });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await registerSale(db, UID, STORE, 't1', { mode: 'retry', fetchImpl, loadCredentials, now });
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'final', receiptNo: '2026-000001' });
    expect(calls).toHaveLength(0);
    expect(mock.read(salePath('t1'))).toMatchObject({ receiptNo: '2026-000001', pendingNumber: false, eet: { status: 'test' } });
  });

  it('klientský merge přepsal stav, POK zůstal → opraví na sent bez odeslání', async () => {
    const { mock, db, now } = setup();
    seedPendingSale(mock, 'sale1', { eet: { status: 'queued', pok: POK, data: {}, attempts: [] }, pendingNumber: true });
    const { calls, fetchImpl } = eetFetch(okBody);
    expect(await registerSale(db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now })).toMatchObject({ reason: 'final' });
    expect(calls).toHaveLength(0);
    expect(eetOf(mock).status).toBe('sent');
  });

  it('chybí certifikát nebo nastavení → failed_permanent se zprávou, nic se neodešle', async () => {
    const { mock, db, now } = setup();
    seedPendingSale(mock);
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await registerSale(db, UID, STORE, 'sale1', {
      fetchImpl,
      now,
      loadCredentials: async () => {
        throw new Error('Prodejna nemá nahraný certifikát EET');
      },
    });
    expect(r.outcome).toBe('failed_permanent');
    expect(eetOf(mock)).toMatchObject({ status: 'failed_permanent', message: 'Prodejna nemá nahraný certifikát EET' });
    expect(eetOf(mock).firstAttemptAt).toBeUndefined();

    const s2 = setup({ eet: { enabled: true, environment: 'playground', eic: 'XX123', unitId: 303 } });
    seedPendingSale(s2.mock);
    const r2 = await registerSale(s2.db, UID, STORE, 'sale1', { fetchImpl, loadCredentials, now });
    expect(r2.outcome).toBe('failed_permanent');
    expect(eetOf(s2.mock).message).toMatch(/eic_popl/);
    expect(eetOf(s2.mock).data).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('spropitné, které není příjmem podniku, se do celk_trzba nezapočte; EUR přes kurz', async () => {
    const { mock, db, now } = setup({ eet: { enabled: true, environment: 'playground', eic: 'CZ00000019', unitId: 303, tipsAreBusinessIncome: false } });
    seedPendingSale(mock, 's-eur', { currency: 'EUR', totalAmount: 4, eurRate: 25, finalAmount: 100, tipAmount: 0.4 });
    const { calls, fetchImpl } = eetFetch(okBody);
    await registerSale(db, UID, STORE, 's-eur', { fetchImpl, loadCredentials, now });
    expect(attrs(calls[0].body, 'Data').celk_trzba).toBe('90.00');
  });
});
