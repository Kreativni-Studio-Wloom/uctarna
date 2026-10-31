// Testovací prodeje (EET 2.0, fáze B). Samostatná funkce, funguje i bez EET.
// Testovací doklad má `isTest: true`; doklady bez pole jsou reálné (žádná migrace dat).
// Reporty, statistiky a AI je ve výchozím stavu vynechávají.

import type { CartItem, Store } from '@/types';

type MaybeTest = { isTest?: unknown };

type SaleAmountLike = MaybeTest & {
  totalAmount?: unknown;
  currency?: unknown;
  eurRate?: unknown;
};

export interface TestSalesSummary {
  count: number;
  /** Součet v Kč (EUR doklady přepočtené kurzem z dokladu). */
  amount: number;
}

// `object` místo MaybeTest: staré doklady pole isTest vůbec nemají.
export function isTestSale(sale: object | null | undefined): boolean {
  return (sale as MaybeTest | null | undefined)?.isTest === true;
}

/** Vrátí prodeje pro součty: bez testovacích, pokud nejsou výslovně zahrnuty. */
export function filterSales<T extends object>(sales: T[], includeTest = false): T[] {
  return includeTest ? sales : sales.filter((sale) => !isTestSale(sale));
}

/** Částka dokladu v Kč stejně jako v uzávěrkách (EUR × kurz z dokladu). */
export function saleAmountCzk(sale: SaleAmountLike): number {
  const total = typeof sale.totalAmount === 'number' ? sale.totalAmount : 0;
  if (sale.currency === 'EUR' && typeof sale.eurRate === 'number') {
    return total * sale.eurRate;
  }
  return total;
}

export function summarizeTestSales(sales: SaleAmountLike[]): TestSalesSummary {
  let count = 0;
  let amount = 0;
  for (const sale of sales) {
    if (!isTestSale(sale)) continue;
    count += 1;
    amount += saleAmountCzk(sale);
  }
  return { count, amount };
}

/** Zda prodejna používá testovací prodeje (režim školení nebo přepínač v checkoutu). */
export function testSalesUiEnabled(store: Pick<Store, 'testMode' | 'testSalesEnabled'> | null | undefined): boolean {
  return store?.testMode === true || store?.testSalesEnabled === true;
}

/**
 * Výchozí poloha přepínače „Testovací prodej“: zapnuto jen tehdy, když jsou na dokladu
 * výhradně testovací produkty. Rozhodují hlavní položky; extras (parentItemId) patří
 * ke své hlavní položce.
 */
export function defaultTestSaleState(
  items: Pick<CartItem, 'productId' | 'parentItemId'>[],
  testProductIds: Iterable<string>
): boolean {
  const ids = testProductIds instanceof Set ? testProductIds : new Set(testProductIds);
  if (ids.size === 0) return false;
  const mainItems = items.filter((item) => !item.parentItemId);
  return mainItems.length > 0 && mainItems.every((item) => ids.has(item.productId));
}

/** V režimu školení je každý prodej testovací; jinak rozhoduje přepínač. */
export function resolveIsTestSale(
  store: Pick<Store, 'testMode'> | null | undefined,
  toggle: boolean
): boolean {
  return store?.testMode === true || toggle;
}

/**
 * Přidá `isTest: true` jen u testovacího prodeje. Reálný prodej zůstane tentýž objekt,
 * takže uložený dokument je stejný jako před zavedením testovacích prodejů.
 */
export function withTestFlag<T extends object>(sale: T, isTest: boolean): T | (T & { isTest: true }) {
  return isTest ? { ...sale, isTest: true as const } : sale;
}

export function formatCzk(amount: number): string {
  return `${amount.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč`;
}

/** „1 testovacího prodeje“ / „3 testovacích prodejů“ (2. pád po „včetně“). */
export function testSalesCountGenitive(count: number): string {
  return count === 1 ? '1 testovacího prodeje' : `${count} testovacích prodejů`;
}

/** Text do uzávěrky: „včetně N testovacích prodejů za X Kč“. */
export function formatIncludedTestSalesNote(summary: TestSalesSummary): string {
  return `včetně ${testSalesCountGenitive(summary.count)} za ${formatCzk(summary.amount)}`;
}

export const TEST_MODE_BANNER_TEXT =
  'TESTOVACÍ REŽIM – prodeje se nepočítají do tržeb ani neodesílají do EET';

export const TEST_RECEIPT_WATERMARK = 'TESTOVACÍ DOKLAD – NEPLATNÝ';
