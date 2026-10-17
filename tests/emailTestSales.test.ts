import { describe, expect, it } from 'vitest';
import { buildEmailReportData, generateEmailContent } from '@/lib/email';

const meta = { storeName: 'Prodejna', period: 'Denní', startDate: '1.10.2026', endDate: '1.10.2026' };
const totals = {
  totalSales: 0, salesInCZK: 0, salesInEUR: 0, cashSales: 0, cardSales: 0, qrSales: 0,
  customerCount: 0, totalCosts: 0, totalProfit: 0, totalDiscounts: 0, salesWithDiscount: 0, totalTips: 0,
};

const realSale = {
  paymentMethod: 'cash',
  totalAmount: 100,
  currency: 'CZK',
  documentId: 'REAL000001',
  items: [{ productId: 'a', productName: 'Káva', quantity: 2, price: 50 }],
};
const testSale = {
  paymentMethod: 'card',
  totalAmount: 4,
  currency: 'EUR',
  eurRate: 25,
  isTest: true,
  documentId: 'TEST000001',
  createdAt: new Date('2026-10-01T08:30:00Z'),
  items: [{ productId: 't', productName: 'Zkušební čaj', quantity: 1, price: 100 }],
};

const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('buildEmailReportData + testovací prodeje', () => {
  it('ve výchozím stavu testovací prodeje vynechá (položky, počty, žádná poznámka)', () => {
    const data = buildEmailReportData(meta, totals, [realSale, testSale], []);
    expect(data.productSummary.map((r) => r.name)).toEqual(['Káva']);
    expect(data.numCardSales).toBe(0);
    expect(data.totalItemsSold).toBe(2);
    expect(data.testSales).toBeUndefined();
    const { html, text } = generateEmailContent(data);
    expect(html).not.toMatch(/[Tt]estovac/);
    expect(text).not.toMatch(/[Tt]estovac/);
  });

  it('s includeTest je započítá a vypíše zvlášť s poznámkou', () => {
    const data = buildEmailReportData(meta, totals, [realSale, testSale], [], { includeTest: true });
    expect(data.productSummary.map((r) => r.name).sort()).toEqual(['Káva', 'Zkušební čaj']);
    expect(data.numCardSales).toBe(1);
    expect(data.testSales).toMatchObject({ count: 1, amount: 100 });
    expect(plain(data.testSales!.note)).toBe('včetně 1 testovacího prodeje za 100 Kč');
    expect(data.testSales!.rows[0]).toMatchObject({ documentId: 'TEST000001', paymentMethod: 'Karta', amount: 100 });
    expect(data.testSales!.rows[0].time).toContain('10:30'); // Europe/Prague (UTC+2)

    const { html, text } = generateEmailContent(data);
    expect(plain(html)).toContain('Uzávěrka je včetně 1 testovacího prodeje za 100 Kč.');
    expect(html).toContain('Testovací prodeje (1)');
    expect(html).toContain('TEST000001');
    expect(plain(text)).toContain('TESTOVACÍ PRODEJE (1)');
  });

  it('includeTest bez testovacích prodejů nic nepřidá', () => {
    const a = buildEmailReportData(meta, totals, [realSale], []);
    const b = buildEmailReportData(meta, totals, [realSale], [], { includeTest: true });
    expect(b).toEqual(a);
  });

  it('escapuje HTML v číslech dokladů', () => {
    const data = buildEmailReportData(meta, totals, [{ ...testSale, documentId: '<b>x</b>' }], [], { includeTest: true });
    expect(generateEmailContent(data).html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
