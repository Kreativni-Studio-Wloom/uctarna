import { describe, expect, it } from 'vitest';
import { buildCashCardSaleDraft, buildQrSaleDraft, buildSumUpPaymentData, withOfflineEet } from '@/lib/checkoutSale';
import { decideSaleSavePath, isEetEnabled } from '@/lib/eet/flags';
import { withTestFlag } from '@/lib/testSales';

/*
 * Důkaz, že s vypnutým EET (všechny dnešní prodejny) checkout ukládá PŘESNĚ totéž co před fází C.
 * Očekávané objekty jsou opsané z původního `handlePayment` v CheckoutModal (commit 2ce00e20)
 * a vyhodnocené pro konkrétní vstupy.
 */

const SERVER_TS = { __sentinel: 'serverTimestamp' };
const cart = [
  { productId: 'p1', productName: 'Káva', price: 60, quantity: 1, cost: 12, itemId: 'i1', parentItemId: null },
  { productId: 'x1', productName: 'Mléko', price: 10, quantity: 1, cost: null, itemId: 'i2', parentItemId: 'i1' },
];
const common = {
  cart,
  actualTotalAmount: 75,
  totalAmount: 70,
  storeId: 's1',
  userId: 'u1',
  customerName: 'Jana',
  isRefund: false,
  refundAmount: 70,
  discount: null,
  discountAmount: undefined,
  tipParsed: 5,
};

describe('vypnuté EET = dnešní chování', () => {
  it('rozhodnutí: bez store.eet.enabled === true vždy legacy (addDoc)', () => {
    for (const store of [null, undefined, {}, { eet: undefined }, { eet: {} }, { eet: { enabled: false } }, { eet: { enabled: 'true' as unknown as boolean } }]) {
      expect(isEetEnabled(store as never)).toBe(false);
      expect(decideSaleSavePath(store as never)).toBe('legacy');
    }
    expect(decideSaleSavePath({ eet: { enabled: true } })).toBe('finalize');
  });

  it('QR: stejný dokument jako původní addDoc', () => {
    const doc = withTestFlag({ ...buildQrSaleDraft({ ...common, documentId: 'abcdefghij', variableSymbol: '0123456789' }), createdAt: SERVER_TS }, false);
    expect(doc).toStrictEqual({
      items: cart,
      totalAmount: 75,
      paymentMethod: 'qr',
      currency: 'CZK',
      eurRate: null,
      originalAmountCZK: 70,
      documentId: 'abcdefghij',
      variableSymbol: '0123456789',
      createdAt: SERVER_TS,
      storeId: 's1',
      userId: 'u1',
      customerName: 'Jana',
      isRefund: false,
      refundAmount: null,
      paidAmount: null,
      paidCurrency: null,
      changeAmount: null,
      changeAmountEUR: null,
      discount: null,
      discountAmount: 0,
      finalAmount: 75,
      tipAmount: 5,
      served: false,
    });
  });

  it('hotovost v EUR: stejný dokument jako původní addDoc', () => {
    const draft = buildCashCardSaleDraft({
      ...common,
      paymentMethod: 'cash',
      documentId: 'abcdefghij',
      payInEUR: true,
      eurAmount: 3,
      eurRate: 25,
      paidAmount: 5,
      paidCurrency: 'EUR',
      changeAmountCZK: 50,
      changeAmountInEUR: 2,
      redirectToSumUp: true,
      manualSumUpCode: '',
      discount: { type: 'percentage', value: 10 },
      discountAmount: 7,
    });
    expect({ ...draft, createdAt: SERVER_TS }).toStrictEqual({
      items: cart,
      totalAmount: 3,
      paymentMethod: 'cash',
      currency: 'EUR',
      eurRate: 25,
      originalAmountCZK: 70,
      documentId: 'abcdefghij',
      createdAt: SERVER_TS,
      storeId: 's1',
      userId: 'u1',
      customerName: 'Jana',
      isRefund: false,
      refundAmount: null,
      paidAmount: 5,
      paidCurrency: 'EUR',
      changeAmount: null,
      changeAmountEUR: 2,
      discount: { type: 'percentage', value: 10 },
      discountAmount: 7,
      finalAmount: 75,
      tipAmount: 5,
      sumUpData: null,
      served: false,
    });
  });

  it('hotovostní vratka v Kč', () => {
    const draft = buildCashCardSaleDraft({
      ...common,
      actualTotalAmount: -70,
      isRefund: true,
      tipParsed: 0,
      paymentMethod: 'cash',
      documentId: 'abcdefghij',
      payInEUR: false,
      eurAmount: -2.8,
      eurRate: 25,
      paidAmount: 0,
      paidCurrency: 'CZK',
      changeAmountCZK: 70,
      changeAmountInEUR: 2.8,
      redirectToSumUp: true,
      manualSumUpCode: '',
    });
    expect(draft).toMatchObject({ totalAmount: -70, currency: 'CZK', eurRate: null, isRefund: true, refundAmount: 70, paidAmount: 0, paidCurrency: 'CZK', changeAmount: 70, changeAmountEUR: null, tipAmount: null, finalAmount: -70 });
  });

  it('karta bez přesměrování s ručním kódem SumUp', () => {
    const draft = buildCashCardSaleDraft({
      ...common,
      paymentMethod: 'card',
      documentId: 'abcdefghij',
      payInEUR: false,
      eurAmount: 3,
      eurRate: 25,
      paidAmount: 100,
      paidCurrency: 'CZK',
      changeAmountCZK: 25,
      changeAmountInEUR: 1,
      redirectToSumUp: false,
      manualSumUpCode: 'TX123',
    });
    expect(draft).toMatchObject({
      paymentMethod: 'card',
      paidAmount: null,
      paidCurrency: null,
      changeAmount: null,
      changeAmountEUR: null,
      sumUpData: { foreignTxId: 'abcdefghij', sumUpTxCode: 'TX123', status: 'success', callbackReceived: false },
    });
    // s přesměrováním (nebo bez kódu) sumUpData null jako dřív
    expect(buildCashCardSaleDraft({ ...common, paymentMethod: 'card', documentId: 'a', payInEUR: false, eurAmount: 0, eurRate: 25, paidAmount: 0, paidCurrency: 'CZK', changeAmountCZK: 0, changeAmountInEUR: 0, redirectToSumUp: true, manualSumUpCode: 'TX' }).sumUpData).toBeNull();
  });

  it('žádné pole EET na dokladu (eet, receiptNo, pendingNumber, isTest u reálného)', () => {
    const draft = buildQrSaleDraft({ ...common, documentId: 'a', variableSymbol: '1' });
    const doc = withTestFlag({ ...draft, createdAt: SERVER_TS }, false);
    for (const key of ['eet', 'receiptNo', 'pendingNumber', 'isTest', 'stornoOf', 'storno']) expect(doc).not.toHaveProperty(key);
  });

  it('SumUp payment data v localStorage: bajt po bajtu stejný JSON jako dřív', () => {
    const p = {
      storeId: 's1',
      userId: 'u1',
      cart,
      actualTotalAmount: 75,
      documentId: 'abcdefghij',
      timestamp: 1760000000000,
      discount: null,
      discountAmount: undefined,
      tipAmountKc: 5,
      customerName: null,
    };
    const original = JSON.stringify({
      storeId: 's1',
      userId: 'u1',
      cartItems: cart,
      totalAmount: 75,
      currency: 'CZK',
      documentId: 'abcdefghij',
      foreignTxId: 'abcdefghij',
      timestamp: 1760000000000,
      discount: null,
      discountAmount: 0,
      finalAmount: 75,
      tipAmount: 5,
      customerName: null,
    });
    expect(JSON.stringify(buildSumUpPaymentData(p, false))).toBe(original);
    expect(buildSumUpPaymentData(p, true)).toMatchObject({ eet: true });
  });
});

describe('zapnuté EET: offline záloha', () => {
  it('withOfflineEet přidá pendingNumber a frontu, zbytek dokladu beze změny', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const sale = { totalAmount: 10, documentId: 'a' };
    expect(withOfflineEet(sale, now)).toEqual({
      totalAmount: 10,
      documentId: 'a',
      pendingNumber: true,
      eet: { status: 'queued', saleAt: '2026-10-17T10:00:00.000Z', nextRetryAt: now },
    });
  });
});
