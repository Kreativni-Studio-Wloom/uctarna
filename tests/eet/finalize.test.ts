import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/eet/db';
import { finalizeInputSchema, finalizeSale } from '@/lib/eet/finalize';
import { saveSumUpSale } from '@/lib/eet/sumupSale';
import { formatReceiptNo, nextCounter, pragueYear, effectivePrefix } from '@/lib/eet/receiptNo';
import { STORE, STORE_PATH, UID, attrs, cashDraft, eetFetch, loadCredentials, okBody, salePath, setup, eetSettings } from './fixturesC';

const input = (documentId: string, over: Record<string, unknown> = {}, sale: Record<string, unknown> = {}) =>
  finalizeInputSchema.parse({ storeId: STORE, documentId, sale: cashDraft(sale), ...over });

describe('finalize: validace vstupu (Zod)', () => {
  it('projde stejný draft jako dnešní addDoc; neznámá pole (eet, receiptNo, userId) zahodí', () => {
    const parsed = finalizeInputSchema.parse({
      storeId: STORE,
      documentId: 'abc123defg',
      sale: { ...cashDraft(), eet: { status: 'sent', pok: 'x' }, receiptNo: '1', userId: 'cizi', isTest: false },
    });
    expect(parsed.sale).not.toHaveProperty('eet');
    expect(parsed.sale).not.toHaveProperty('receiptNo');
    expect(parsed.sale).not.toHaveProperty('userId');
  });

  it.each([
    ['prázdný košík', { sale: cashDraft({ items: [] }) }],
    ['neznámá platba', { sale: cashDraft({ paymentMethod: 'crypto' }) }],
    ['EUR bez kurzu', { sale: cashDraft({ currency: 'EUR', eurRate: null }) }],
    ['NaN částka', { sale: cashDraft({ totalAmount: Number.NaN }) }],
    ['neodeslat bez důvodu', { eetSend: false }],
    ['špatné documentId', { documentId: '../x' }],
    ['špatné storeId', { storeId: 'a/b' }],
  ])('odmítne: %s', (_name, over) => {
    expect(finalizeInputSchema.safeParse({ storeId: STORE, documentId: 'abc123defg', sale: cashDraft(), ...over }).success).toBe(false);
  });
});

describe('číselná řada', () => {
  it('formát, roční reset, rok v Praze', () => {
    expect(formatReceiptNo({ prefix: '{YYYY}-', resetYearly: true }, { year: 2027, last: 1235 })).toBe('2027-001235');
    expect(nextCounter({ year: 2026, last: 99 }, 2027, true)).toEqual({ year: 2027, last: 1 });
    expect(nextCounter({ year: 2026, last: 99 }, 2027, false)).toEqual({ year: 2027, last: 100 });
    expect(nextCounter(undefined, 2026, true)).toEqual({ year: 2026, last: 1 });
    expect(pragueYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
    // roční reset bez roku v prefixu by čísla opakoval → rok se doplní
    expect(effectivePrefix({ prefix: 'A-', resetYearly: true }, 2027)).toBe('A-2027-');
    expect(effectivePrefix({ prefix: 'A-', resetYearly: false }, 2027)).toBe('A-');
    expect(() => formatReceiptNo({ prefix: 'ž', resetYearly: false }, { year: 2027, last: 1 })).toThrow(/porad_cis/);
  });
});

describe('finalizeSale', () => {
  it('uloží doklad s číslem a eet, zvýší soldCount, odešle do EET', async () => {
    const { mock, db, now } = setup();
    mock.seed(`${STORE_PATH}/products/p1`, { soldCount: 5 });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await finalizeSale(db, UID, input('doc0000001'), { now, registerOptions: { fetchImpl, loadCredentials, now } });

    expect(r).toMatchObject({ saleId: 'doc0000001', receiptNo: '2026-000001', duplicate: false, eet: { status: 'sent' } });
    const doc = mock.read(salePath('doc0000001'))!;
    expect(doc).toMatchObject({ ...cashDraft(), documentId: 'doc0000001', userId: UID, storeId: STORE, receiptNo: '2026-000001' });
    expect(doc).not.toHaveProperty('isTest');
    expect((doc.createdAt as Timestamp).toDate()).toEqual(now());
    expect(mock.read(`${STORE_PATH}/products/p1`)).toMatchObject({ soldCount: 6 });
    expect(mock.read(`${STORE_PATH}/counters/receipts`)).toMatchObject({ year: 2026, last: 1 });
    expect(attrs(calls[0].body, 'Data')).toMatchObject({ porad_cis: '2026-000001', celk_trzba: '81.60', dat_trzby: '2026-10-17T12:00:00+02:00' });
  });

  it('čísla jdou po sobě, i souběžně (transakce)', async () => {
    const { mock, db, now } = setup();
    const ids = ['d000000001', 'd000000002', 'd000000003', 'd000000004', 'd000000005'];
    const rs = await Promise.all(ids.map((id) => finalizeSale(db, UID, input(id), { now, registerNow: false })));
    expect(rs.map((r) => r.receiptNo).sort()).toEqual(['2026-000001', '2026-000002', '2026-000003', '2026-000004', '2026-000005']);
    expect(mock.read(`${STORE_PATH}/counters/receipts`)).toMatchObject({ last: 5 });
    expect(mock.txRetries).toBeGreaterThan(0);
  });

  it('idempotence: stejné documentId podruhé = stejný doklad, žádné nové číslo, soldCount jen jednou', async () => {
    const { mock, db, now } = setup();
    mock.seed(`${STORE_PATH}/products/p1`, { soldCount: 0 });
    const { calls, fetchImpl } = eetFetch(okBody);
    const opts = { now, registerOptions: { fetchImpl, loadCredentials, now } };
    const a = await finalizeSale(db, UID, input('same000001'), opts);
    const b = await finalizeSale(db, UID, input('same000001'), opts);
    expect(b).toMatchObject({ duplicate: true, receiptNo: a.receiptNo, eet: { status: 'sent' } });
    expect(mock.read(`${STORE_PATH}/counters/receipts`)).toMatchObject({ last: 1 });
    expect(mock.read(`${STORE_PATH}/products/p1`)).toMatchObject({ soldCount: 1 });
    expect(calls).toHaveLength(1);
  });

  it('testovací doklad: číslo ze stejné řady, isTest, eet.status=test, nic se neodešle', async () => {
    const { mock, db, now } = setup();
    const { calls, fetchImpl } = eetFetch(okBody);
    const opts = { now, registerOptions: { fetchImpl, loadCredentials, now } };
    await finalizeSale(db, UID, input('real000001'), opts);
    const t = await finalizeSale(db, UID, input('test000001', { isTest: true }), opts);
    expect(t).toMatchObject({ receiptNo: '2026-000002', eet: { status: 'test' } });
    expect(mock.read(salePath('test000001'))).toMatchObject({ isTest: true, eet: { status: 'test' } });
    expect(calls).toHaveLength(1);
  });

  it('zákonná výjimka: not_required s důvodem, neodešle se', async () => {
    const { mock, db, now } = setup();
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await finalizeSale(db, UID, input('nr00000001', { eetSend: false, nonEvidenceReason: 'Převod na účet bez osobního kontaktu' }), {
      now,
      registerOptions: { fetchImpl, loadCredentials, now },
    });
    expect(r.eet).toMatchObject({ status: 'not_required', reason: 'Převod na účet bez osobního kontaktu' });
    expect(mock.read(salePath('nr00000001'))!.receiptNo).toBe('2026-000001');
    expect(calls).toHaveLength(0);
  });

  it('hotovostní vratka = záporná tržba', async () => {
    const { db, now } = setup();
    const { calls, fetchImpl } = eetFetch(okBody);
    await finalizeSale(
      db,
      UID,
      input('ref0000001', {}, { totalAmount: -81.6, finalAmount: -81.6, isRefund: true, refundAmount: 81.6, items: [{ productId: 'p1', productName: 'x', price: 81.6, quantity: -1 }] }),
      { now, registerOptions: { fetchImpl, loadCredentials, now } }
    );
    expect(attrs(calls[0].body, 'Data').celk_trzba).toBe('-81.60');
  });

  it('EET u prodejny vypnuté → 409 eet_disabled a nic se nezapíše', async () => {
    for (const eet of [null, { ...eetSettings, enabled: false }, {}]) {
      const { mock, db, now } = setup({ eet });
      await expect(finalizeSale(db, UID, input('x000000001'), { now })).rejects.toMatchObject({ status: 409, code: 'eet_disabled' });
      expect(mock.read(salePath('x000000001'))).toBeUndefined();
      expect(mock.read(`${STORE_PATH}/counters/receipts`)).toBeUndefined();
    }
  });

  it('cizí / neexistující prodejna → 404', async () => {
    const { db, now } = setup();
    await expect(finalizeSale(db, 'jiny-uzivatel', input('x000000001'), { now })).rejects.toBeInstanceOf(HttpError);
  });

  it('výpadek EET prodej neblokuje: doklad uložen, stav queued', async () => {
    const { mock, db, now } = setup();
    const { fetchImpl } = eetFetch(() => 'network');
    const r = await finalizeSale(db, UID, input('down000001'), { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r.eet?.status).toBe('queued');
    expect(mock.read(salePath('down000001'))).toMatchObject({ receiptNo: '2026-000001', eet: { status: 'queued' } });
  });
});

describe('SumUp callback (saveSumUpSale)', () => {
  const sale = { items: [{ productId: 'p1', quantity: 1 }], totalAmount: 120, paymentMethod: 'card', documentId: 'sumup00001', finalAmount: 120, tipAmount: null, served: false };

  it('EET vypnuté: zapíše přesně objekt `sale` (žádné nové pole), bez čítače, bez přihlášení', async () => {
    for (const eet of [null, { enabled: false }]) {
      const { mock, db } = setup({ eet });
      const r = await saveSumUpSale(db, { userId: UID, storeId: STORE, saleDocId: 'sumup00001', sale, authUid: null });
      expect(r).toEqual({ alreadyExists: false, eetEnabled: false });
      expect(mock.read(salePath('sumup00001'))).toEqual(sale);
      expect(mock.read(`${STORE_PATH}/counters/receipts`)).toBeUndefined();
    }
  });

  it('EET vypnuté: neexistující prodejna (debug cesty) = jako dřív', async () => {
    const { mock, db } = setup();
    await saveSumUpSale(db, { userId: 'debug-user', storeId: 'debug-store', saleDocId: 'x1', sale, authUid: null });
    expect(mock.read('users/debug-user/stores/debug-store/sales/x1')).toEqual(sale);
  });

  it('EET zapnuté bez přihlášení vlastníka → 401, nic se neuloží', async () => {
    const { mock, db } = setup();
    for (const authUid of [null, 'cizi-uzivatel']) {
      await expect(saveSumUpSale(db, { userId: UID, storeId: STORE, saleDocId: 'sumup00001', sale, authUid })).rejects.toMatchObject({ status: 401 });
    }
    expect(mock.read(salePath('sumup00001'))).toBeUndefined();
  });

  it('EET zapnuté: číslo v transakci + eet pending', async () => {
    const { mock, db, now } = setup();
    const r = await saveSumUpSale(db, { userId: UID, storeId: STORE, saleDocId: 'sumup00001', sale, authUid: UID, now: now() });
    expect(r).toMatchObject({ eetEnabled: true, receiptNo: '2026-000001', eet: { status: 'pending' } });
    expect(mock.read(salePath('sumup00001'))).toMatchObject({ ...sale, receiptNo: '2026-000001', eet: { status: 'pending', saleAt: '2026-10-17T10:00:00.000Z' } });
  });
});
