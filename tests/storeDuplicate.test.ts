import { describe, expect, it } from 'vitest';
import { saleRemovalPolicy } from '@/lib/eetUi';
import { duplicateSaleData, duplicateStoreData, duplicateStoreEet } from '@/lib/storeDuplicate';

const ctx = (saleIdMap: Record<string, string> = {}) => ({
  sourceStoreId: 'old',
  sourceSaleId: 's1',
  newStoreId: 'new',
  userId: 'u1',
  productIdMap: new Map([['p1', 'P1']]),
  saleIdMap: new Map(Object.entries(saleIdMap)),
});

const legacySale = {
  items: [{ productId: 'p1', quantity: 2 }, { productId: 'gone', quantity: 1 }],
  totalAmount: 100,
  paymentMethod: 'cash',
  storeId: 'old',
  userId: 'u1',
  documentId: 'ABCDEFGHIJ',
  createdAt: { seconds: 1 },
};

describe('Duplikovat prodejnu: doklady', () => {
  it('doklad bez EET se kopíruje přesně jako dřív (jen storeId, userId a produkty)', () => {
    expect(duplicateSaleData(legacySale, ctx())).toEqual({
      ...legacySale,
      items: [{ productId: 'P1', quantity: 2 }, { productId: 'gone', quantity: 1 }],
      storeId: 'new',
      userId: 'u1',
    });
  });

  it('EET doklad: bez receiptNo / eet / pendingNumber, s copiedFrom → v kopii se maže, do fronty nejde', () => {
    const sale = { ...legacySale, receiptNo: '2026-000007', eet: { status: 'queued', nextRetryAt: 1, attempts: [] } };
    const copy = duplicateSaleData(sale, ctx());
    expect(copy).not.toHaveProperty('receiptNo');
    expect(copy).not.toHaveProperty('eet');
    expect(copy).not.toHaveProperty('pendingNumber');
    expect(copy.copiedFrom).toEqual({ storeId: 'old', saleId: 's1', receiptNo: '2026-000007' });
    expect(saleRemovalPolicy({ eet: { enabled: false } }, copy)).toEqual({ action: 'delete' });
  });

  it('offline doklad (pendingNumber, eet queued, bez čísla) i odeslaný doklad s POK ztratí EET identitu', () => {
    const offline = duplicateSaleData({ ...legacySale, pendingNumber: true, eet: { status: 'queued', saleAt: 'x' } }, ctx());
    expect(offline).not.toHaveProperty('pendingNumber');
    expect(offline).not.toHaveProperty('eet');
    expect(offline.copiedFrom).toEqual({ storeId: 'old', saleId: 's1' });
    const sent = duplicateSaleData({ ...legacySale, receiptNo: '2026-000001', eet: { status: 'sent', pok: 'P' } }, ctx());
    expect(JSON.stringify(sent)).not.toContain('"pok"');
  });

  it('testovací doklad zůstane testovací (isTest), ale bez čísla z řady', () => {
    const copy = duplicateSaleData({ ...legacySale, isTest: true, receiptNo: '2026-000003', eet: { status: 'test' } }, ctx());
    expect(copy).toMatchObject({ isTest: true });
    expect(copy).not.toHaveProperty('receiptNo');
  });

  it('vazba storna se přemapuje na nová id; chybějící protějšek se vynechá', () => {
    const storno = duplicateSaleData({ ...legacySale, receiptNo: '2026-000002', stornoOf: 'orig', eet: { status: 'sent' } }, ctx({ orig: 'ORIG' }));
    expect(storno.stornoOf).toBe('ORIG');
    const orig = duplicateSaleData({ ...legacySale, storno: { by: 'u1', at: 1, saleId: 'st' } }, ctx({ st: 'ST' }));
    expect(orig.storno).toEqual({ by: 'u1', at: 1, saleId: 'ST' });
    const lonely = duplicateSaleData({ ...legacySale, stornoOf: 'missing', storno: { saleId: 'missing' } }, ctx());
    expect(lonely).not.toHaveProperty('stornoOf');
    expect(lonely).not.toHaveProperty('storno');
  });
});

describe('Duplikovat prodejnu: prodejna', () => {
  it('prodejna bez EET pole se kopíruje beze změny', () => {
    const store = { name: 'A', ico: '123', testMode: false };
    expect(duplicateStoreData(store)).toEqual(store);
  });

  it('EET u kopie vypnuté, bez certifikátu a evidenční jednotky; ostatní nastavení zůstane', () => {
    const store = {
      name: 'A',
      eet: {
        enabled: true,
        environment: 'production',
        eic: 'CZ00000019',
        unitId: 303,
        registerId: 'WEB1',
        certificate: { serial: '1', subjectEic: 'CZ00000019' },
        receiptSeries: { prefix: '{YYYY}-', resetYearly: true },
      },
    };
    const copy = duplicateStoreData(store);
    expect(copy.eet).toEqual({
      enabled: false,
      environment: 'production',
      eic: 'CZ00000019',
      registerId: 'WEB1',
      receiptSeries: { prefix: '{YYYY}-', resetYearly: true },
    });
    expect(store.eet.enabled).toBe(true); // původní objekt se nemění
    expect(duplicateStoreEet(null)).toBeUndefined();
    expect(duplicateStoreData({ name: 'B', eet: null })).toEqual({ name: 'B' });
  });
});
