import { describe, expect, it } from 'vitest';
import {
  defaultTestSaleState,
  filterSales,
  formatIncludedTestSalesNote,
  isTestSale,
  resolveIsTestSale,
  saleAmountCzk,
  summarizeTestSales,
  testSalesCountGenitive,
  testSalesUiEnabled,
  withTestFlag,
} from '@/lib/testSales';

const real = { id: 'r1', totalAmount: 100, currency: 'CZK' };
const legacy = { id: 'r2', totalAmount: 50, currency: 'CZK', isTest: undefined };
const realFalse = { id: 'r3', totalAmount: 20, currency: 'CZK', isTest: false };
const test = { id: 't1', totalAmount: 80, currency: 'CZK', isTest: true };
const testEur = { id: 't2', totalAmount: 4, currency: 'EUR', eurRate: 25, isTest: true };

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('isTestSale', () => {
  it('jen isTest === true je testovací; staré doklady bez pole jsou reálné', () => {
    expect(isTestSale(test)).toBe(true);
    expect(isTestSale(real)).toBe(false);
    expect(isTestSale(legacy)).toBe(false);
    expect(isTestSale(realFalse)).toBe(false);
    expect(isTestSale({ isTest: 'true' })).toBe(false);
    expect(isTestSale(null)).toBe(false);
    expect(isTestSale(undefined)).toBe(false);
  });
});

describe('filterSales', () => {
  const all = [real, test, legacy, testEur, realFalse];

  it('ve výchozím stavu vynechá testovací prodeje', () => {
    expect(filterSales(all)).toEqual([real, legacy, realFalse]);
    expect(filterSales(all, false)).toEqual([real, legacy, realFalse]);
  });

  it('s includeTest vrátí vše beze změny (stejné pole)', () => {
    expect(filterSales(all, true)).toBe(all);
  });

  it('bez testovacích prodejů vrátí stejný obsah', () => {
    expect(filterSales([real, legacy])).toEqual([real, legacy]);
  });
});

describe('saleAmountCzk / summarizeTestSales', () => {
  it('EUR doklad přepočte kurzem z dokladu', () => {
    expect(saleAmountCzk(testEur)).toBe(100);
    expect(saleAmountCzk(real)).toBe(100);
    expect(saleAmountCzk({ currency: 'EUR', totalAmount: 4 })).toBe(4);
    expect(saleAmountCzk({})).toBe(0);
  });

  it('sečte jen testovací prodeje', () => {
    expect(summarizeTestSales([real, test, legacy, testEur])).toEqual({ count: 2, amount: 180 });
    expect(summarizeTestSales([real, legacy])).toEqual({ count: 0, amount: 0 });
    expect(summarizeTestSales([])).toEqual({ count: 0, amount: 0 });
  });
});

describe('defaultTestSaleState', () => {
  const ids = new Set(['p-test', 'p-test2']);

  it('zapne se jen při výhradně testovacích produktech', () => {
    expect(defaultTestSaleState([{ productId: 'p-test' }], ids)).toBe(true);
    expect(defaultTestSaleState([{ productId: 'p-test' }, { productId: 'p-test2' }], ids)).toBe(true);
    expect(defaultTestSaleState([{ productId: 'p-test' }, { productId: 'p-real' }], ids)).toBe(false);
    expect(defaultTestSaleState([{ productId: 'p-real' }], ids)).toBe(false);
  });

  it('prázdný košík nebo žádné testovací produkty → vypnuto', () => {
    expect(defaultTestSaleState([], ids)).toBe(false);
    expect(defaultTestSaleState([{ productId: 'p-test' }], [])).toBe(false);
  });

  it('extras patří ke své hlavní položce', () => {
    expect(
      defaultTestSaleState(
        [
          { productId: 'p-test', parentItemId: null },
          { productId: 'p-extra', parentItemId: 'item-1' },
        ],
        ids
      )
    ).toBe(true);
    expect(defaultTestSaleState([{ productId: 'p-test', parentItemId: 'item-1' }], ids)).toBe(false);
  });

  it('přijme i pole id', () => {
    expect(defaultTestSaleState([{ productId: 'a' }], ['a'])).toBe(true);
  });
});

describe('resolveIsTestSale / testSalesUiEnabled', () => {
  it('režim školení přebije přepínač', () => {
    expect(resolveIsTestSale({ testMode: true }, false)).toBe(true);
    expect(resolveIsTestSale({ testMode: false }, false)).toBe(false);
    expect(resolveIsTestSale({}, true)).toBe(true);
    expect(resolveIsTestSale(null, false)).toBe(false);
  });

  it('UI je vidět jen při zapnutém vypínači', () => {
    expect(testSalesUiEnabled({})).toBe(false);
    expect(testSalesUiEnabled(null)).toBe(false);
    expect(testSalesUiEnabled({ testMode: false, testSalesEnabled: false })).toBe(false);
    expect(testSalesUiEnabled({ testMode: true })).toBe(true);
    expect(testSalesUiEnabled({ testSalesEnabled: true })).toBe(true);
  });
});

describe('withTestFlag', () => {
  const sale = { items: [], totalAmount: 10, createdAt: 'ts', served: false };

  it('reálný prodej: tentýž objekt, žádné pole isTest (dokument beze změny)', () => {
    const out = withTestFlag(sale, false);
    expect(out).toBe(sale);
    expect('isTest' in out).toBe(false);
    expect(JSON.stringify(out)).toBe(JSON.stringify(sale));
  });

  it('testovací prodej: stejná pole + isTest: true na konci, originál nezměněn', () => {
    const out = withTestFlag(sale, true);
    expect(out).toEqual({ ...sale, isTest: true });
    expect(Object.keys(out)).toEqual([...Object.keys(sale), 'isTest']);
    expect('isTest' in sale).toBe(false);
  });
});

describe('texty', () => {
  it('skloňování po „včetně“', () => {
    expect(testSalesCountGenitive(1)).toBe('1 testovacího prodeje');
    expect(testSalesCountGenitive(2)).toBe('2 testovacích prodejů');
    expect(testSalesCountGenitive(5)).toBe('5 testovacích prodejů');
  });

  it('poznámka do uzávěrky', () => {
    expect(nbsp(formatIncludedTestSalesNote({ count: 3, amount: 1250.5 }))).toBe(
      'včetně 3 testovacích prodejů za 1 250,5 Kč'
    );
  });
});
