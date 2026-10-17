import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  RE_CASTKA,
  formatAmount,
  formatDateTimePrague,
  validateAmount,
  validateDateTime,
  validateEic,
  validateReceiptNo,
  validateRegisterId,
  validateUnitId,
  validateUuid,
  validateTrzbaData,
} from '@/lib/eet/format';

describe('formatAmount', () => {
  it.each([
    [0, '0.00'],
    [-0, '0.00'],
    [-0.001, '0.00'],
    [-0.01, '-0.01'],
    [81.6, '81.60'],
    [81.599999999, '81.60'],
    [1.005, '1.01'],
    [-1.005, '-1.01'],
    [0.1 + 0.2, '0.30'],
    [109.35, '109.35'],
    [-120.5, '-120.50'],
    [99_999_999.99, '99999999.99'],
    [-99_999_999.99, '-99999999.99'],
    [1234, '1234.00'],
  ])('%s → %s', (n, s) => {
    const out = formatAmount(n);
    expect(out).toBe(s);
    expect(RE_CASTKA.test(out)).toBe(true);
  });

  it('nikdy nevrátí -0.00', () => {
    for (const n of [-0, -0.004, -0.0049, -1e-12]) expect(formatAmount(n)).not.toBe('-0.00');
  });

  it.each([NaN, Infinity, -Infinity, 100_000_000, -100_000_000, 1e12])('odmítne %s', (n) => {
    expect(() => formatAmount(n)).toThrow(RangeError);
  });

  it('zakázané tvary neprojdou regexem XSD', () => {
    for (const bad of ['-0.00', '1.5', '01.00', '1,00', '1', '.50', '+1.00', '100000000.00', '1.000'])
      expect(validateAmount(bad)).toBe(false);
  });
});

describe('formatDateTimePrague', () => {
  it.each([
    // zimní čas
    ['2026-01-15T12:00:00Z', '2026-01-15T13:00:00+01:00'],
    // letní čas
    ['2026-07-01T09:02:18Z', '2026-07-01T11:02:18+02:00'],
    // přechod na letní čas 29. 3. 2026 v 02:00 SEČ (01:00 UTC)
    ['2026-03-29T00:59:59Z', '2026-03-29T01:59:59+01:00'],
    ['2026-03-29T01:00:00Z', '2026-03-29T03:00:00+02:00'],
    // přechod na zimní čas 25. 10. 2026 v 03:00 SELČ (01:00 UTC); 02:xx nastane dvakrát
    ['2026-10-25T00:30:00Z', '2026-10-25T02:30:00+02:00'],
    ['2026-10-25T00:59:59Z', '2026-10-25T02:59:59+02:00'],
    ['2026-10-25T01:00:00Z', '2026-10-25T02:00:00+01:00'],
    ['2026-10-25T01:30:00Z', '2026-10-25T02:30:00+01:00'],
    // přelom roku a půlnoc
    ['2026-12-31T23:00:00Z', '2027-01-01T00:00:00+01:00'],
    ['2026-06-30T22:00:00Z', '2026-07-01T00:00:00+02:00'],
  ])('%s → %s', (iso, out) => {
    const s = formatDateTimePrague(new Date(iso));
    expect(s).toBe(out);
    expect(validateDateTime(s)).toBe(true);
    expect(new Date(s).getTime()).toBe(new Date(iso).getTime());
  });

  it('ořízne milisekundy', () => {
    expect(formatDateTimePrague(new Date('2026-01-15T12:00:00.999Z'))).toBe('2026-01-15T13:00:00+01:00');
  });

  it('odmítne neplatné datum', () => {
    expect(() => formatDateTimePrague(new Date('x'))).toThrow();
  });
});

describe('validace podle XSD', () => {
  it('UUID v4 z crypto.randomUUID', () => {
    for (let i = 0; i < 50; i++) expect(validateUuid(randomUUID())).toBe(true);
    expect(validateUuid('03965780-6457-4842-bd80-5f9195c0b8c8')).toBe(true);
    expect(validateUuid('03965780-6457-0842-bd80-5f9195c0b8c8')).toBe(false); // verze 0
    expect(validateUuid('03965780-6457-4842-cd80-5f9195c0b8c8')).toBe(false); // varianta
    expect(validateUuid('03965780645748428d805f9195c0b8c8')).toBe(false);
  });

  it('EIČ', () => {
    for (const ok of ['CZ00000019', 'CZ683555118', 'CZ8551015704']) expect(validateEic(ok)).toBe(true);
    for (const bad of ['CZ1234567', 'CZ12345678901', 'cz00000019', 'SK00000019', ' CZ00000019']) expect(validateEic(bad)).toBe(false);
  });

  it('id_pokl, porad_cis, id_jednotky', () => {
    expect(validateRegisterId('WEB1')).toBe(true);
    expect(validateRegisterId('/5604/MA65')).toBe(true);
    expect(validateRegisterId('a'.repeat(21))).toBe(false);
    expect(validateRegisterId('')).toBe(false);
    expect(validateRegisterId('Pokladna č.1')).toBe(false);
    expect(validateReceiptNo('2027-001235')).toBe(true);
    expect(validateReceiptNo('#135433c/11/2027')).toBe(true);
    expect(validateReceiptNo('x'.repeat(26))).toBe(false);
    expect(validateReceiptNo('a&b')).toBe(false);
    expect(validateUnitId(1)).toBe(true);
    expect(validateUnitId(999_999_999)).toBe(true);
    for (const bad of [0, -1, 1.5, 1_000_000_000, NaN]) expect(validateUnitId(bad)).toBe(false);
  });

  it('dat_trzby', () => {
    expect(validateDateTime('2026-07-01T09:02:18Z')).toBe(true);
    expect(validateDateTime('2026-07-01T09:02:18+02:00')).toBe(true);
    expect(validateDateTime('2026-07-01T09:02:18.123Z')).toBe(false);
    expect(validateDateTime('2026-07-01 09:02:18+02:00')).toBe(false);
    expect(validateDateTime('2026-07-01T09:02+02:00')).toBe(false);
  });

  it('validateTrzbaData vrátí všechny problémy', () => {
    const errs = validateTrzbaData({
      eic: 'CZ1',
      unitId: 0,
      registerId: '',
      porad_cis: 'x'.repeat(30),
      dat_trzby: 'dnes',
      celk_trzba: '-0.00',
    });
    expect(errs).toHaveLength(6);
  });
});
