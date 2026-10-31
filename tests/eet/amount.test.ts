import { describe, expect, it } from 'vitest';
import { computeEetAmountCZK } from '@/lib/eet/amount';
import { formatAmount } from '@/lib/eet/format';

const tipsIncome = { tipsAreBusinessIncome: true };
const tipsNotIncome = { tipsAreBusinessIncome: false };

describe('computeEetAmountCZK', () => {
  it('bere finalAmount (po slevě) před totalAmount', () => {
    expect(computeEetAmountCZK({ totalAmount: 100, finalAmount: 81.6, currency: 'CZK' }, tipsIncome)).toBe(81.6);
    expect(computeEetAmountCZK({ totalAmount: 100, currency: 'CZK' }, tipsIncome)).toBe(100);
  });

  it('spropitné: příjem podniku se nechá, jinak se odečte', () => {
    const sale = { totalAmount: 120, finalAmount: 120, tipAmount: 20, currency: 'CZK' as const };
    expect(computeEetAmountCZK(sale, tipsIncome)).toBe(120);
    expect(computeEetAmountCZK(sale, tipsNotIncome)).toBe(100);
  });

  it('EUR: finalAmount je už v Kč; spropitné v EUR se přepočte kurzem', () => {
    // 4.00 € + 0.50 € spropitné při kurzu 24.30 → finalAmount 109.35 Kč
    const sale = { totalAmount: 4.5, finalAmount: 109.35, tipAmount: 0.5, eurRate: 24.3, currency: 'EUR' as const };
    expect(computeEetAmountCZK(sale, tipsIncome)).toBe(109.35);
    expect(computeEetAmountCZK(sale, tipsNotIncome)).toBe(97.2);
  });

  it('EUR bez finalAmount: totalAmount × kurz', () => {
    expect(computeEetAmountCZK({ totalAmount: 10, eurRate: 24.315, currency: 'EUR' }, tipsIncome)).toBe(243.15);
  });

  it('EUR bez kurzu vyhodí chybu', () => {
    expect(() => computeEetAmountCZK({ totalAmount: 10, currency: 'EUR' }, tipsIncome)).toThrow(/kurz/);
  });

  it('vratka je záporná', () => {
    const out = computeEetAmountCZK({ totalAmount: -120.5, finalAmount: -120.5, currency: 'CZK' }, tipsIncome);
    expect(formatAmount(out)).toBe('-120.50');
  });

  it('zaokrouhlení hotovosti na koruny jen když je zapnuté a jen u hotovosti v Kč', () => {
    const cash = { totalAmount: 81.6, finalAmount: 81.6, currency: 'CZK' as const, paymentMethod: 'cash' as const };
    expect(computeEetAmountCZK(cash, tipsIncome)).toBe(81.6);
    expect(computeEetAmountCZK(cash, { ...tipsIncome, roundCashToWholeCzk: true })).toBe(82);
    expect(computeEetAmountCZK({ ...cash, finalAmount: -81.5 }, { ...tipsIncome, roundCashToWholeCzk: true })).toBe(-82);
    expect(computeEetAmountCZK({ ...cash, paymentMethod: 'card' }, { ...tipsIncome, roundCashToWholeCzk: true })).toBe(81.6);
  });

  it('nevrací -0', () => {
    const out = computeEetAmountCZK({ totalAmount: 20, finalAmount: 20, tipAmount: 20, currency: 'CZK' }, tipsNotIncome);
    expect(Object.is(out, -0)).toBe(false);
    expect(formatAmount(out)).toBe('0.00');
  });
});
