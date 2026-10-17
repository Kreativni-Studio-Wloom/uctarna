// Fáze D: malé úpravy serveru kvůli UI (výjimka z evidence offline, storno dokladu z doby před EET).
import { describe, expect, it } from 'vitest';
import { withOfflineEet } from '@/lib/checkoutSale';
import { finalizeInputSchema, finalizeSale } from '@/lib/eet/finalize';
import { registerSale } from '@/lib/eet/register';
import { PRE_EET_STORNO_REASON, stornoSale } from '@/lib/eet/storno';
import { STORE, STORE_PATH, UID, attrs, cashDraft, eetFetch, loadCredentials, okBody, salePath, setup } from './fixturesC';

describe('checkout: výjimka z evidence', () => {
  it('finalize s eetSend=false a důvodem → not_required, číslo, nic se neodešle', async () => {
    const { mock, db, now } = setup();
    const { calls, fetchImpl } = eetFetch(okBody);
    const input = finalizeInputSchema.parse({
      storeId: STORE,
      documentId: 'exempt0001',
      sale: cashDraft({ paymentMethod: 'qr' }),
      eetSend: false,
      nonEvidenceReason: 'Platba převodem na účet bez osobního kontaktu',
    });
    const r = await finalizeSale(db, UID, input, { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r).toMatchObject({ receiptNo: '2026-000001', eet: { status: 'not_required', reason: 'Platba převodem na účet bez osobního kontaktu' } });
    expect(calls).toHaveLength(0);
    expect(mock.read(salePath('exempt0001'))!.isTest).toBeUndefined();
  });

  it('withOfflineEet: důvod výjimky se uloží jako eet.exemptReason, bez důvodu beze změny', () => {
    const t = new Date('2026-10-17T10:00:00Z');
    expect(withOfflineEet({ a: 1 }, t)).toEqual({ a: 1, pendingNumber: true, eet: { status: 'queued', saleAt: t.toISOString(), nextRetryAt: t } });
    expect(withOfflineEet({ a: 1 }, t, 'Převod').eet).toMatchObject({ status: 'queued', exemptReason: 'Převod' });
  });

  it('offline doklad s výjimkou: fronta ho jen očísluje a označí not_required', async () => {
    const { mock, db, now } = setup();
    mock.seed(salePath('off1'), {
      ...cashDraft({ paymentMethod: 'qr' }),
      ...withOfflineEet({}, new Date(0), 'Platba převodem'),
    });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await registerSale(db, UID, STORE, 'off1', { mode: 'retry', fetchImpl, loadCredentials, now });
    expect(r).toMatchObject({ outcome: 'skipped', reason: 'final', receiptNo: '2026-000001' });
    expect(calls).toHaveLength(0);
    const doc = mock.read(salePath('off1'))!;
    expect(doc).toMatchObject({ receiptNo: '2026-000001', pendingNumber: false, eet: { status: 'not_required', reason: 'Platba převodem' } });
    expect((doc.eet as Record<string, unknown>).exemptReason).toBeUndefined();
  });
});

describe('storno dokladu z doby před zapnutím EET', () => {
  it('hotovostní doklad bez eet → storno se neeviduje (not_required), nedostane zápornou tržbu do EET', async () => {
    const { mock, db, now } = setup();
    mock.seed(`${STORE_PATH}/products/p1`, { soldCount: 3 });
    mock.seed(salePath('legacy0001'), { ...cashDraft(), documentId: 'legacy0001', createdAt: new Date('2026-01-01T10:00:00Z') });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await stornoSale(db, UID, STORE, 'legacy0001', { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r).toMatchObject({ receiptNo: '2026-000001', eet: { status: 'not_required', reason: PRE_EET_STORNO_REASON } });
    expect(calls).toHaveLength(0);
    expect(mock.read(salePath('legacy0001'))!.storno).toMatchObject({ saleId: r.saleId });
  });

  it('hotovostní doklad s EET → storno se dál eviduje', async () => {
    const { db, now } = setup();
    await finalizeSale(db, UID, finalizeInputSchema.parse({ storeId: STORE, documentId: 'orig000001', sale: cashDraft() }), { now, registerNow: false });
    const { calls, fetchImpl } = eetFetch(okBody);
    const r = await stornoSale(db, UID, STORE, 'orig000001', { now, registerOptions: { fetchImpl, loadCredentials, now } });
    expect(r.eet?.status).toBe('sent');
    expect(attrs(calls[0].body, 'Data').celk_trzba).toBe('-81.60');
  });
});
