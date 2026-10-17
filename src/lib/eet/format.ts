import 'server-only';
import type { EetTrzbaData } from './types';

// Regexy podle XSD jsou v './patterns' (bez 'server-only', používá je i nastavení v prohlížeči).
import { RE_CASTKA, RE_DATETIME, RE_EIC, RE_ID_JEDNOTKY, RE_ID_POKL, RE_PORAD_CIS, RE_POK, RE_UUID } from './patterns';
export { RE_CASTKA, RE_DATETIME, RE_EIC, RE_ID_JEDNOTKY, RE_ID_POKL, RE_PORAD_CIS, RE_POK, RE_UUID };

/** Max. absolutní částka (XSD: exkluzivně ±100 000 000). */
const MAX_HALERE = 100_000_000 * 100;

/**
 * Částka v Kč → `celk_trzba`. Počítá v haléřích (`Math.round(n*100)`), vždy 2 desetinná místa,
 * nikdy `-0.00`. Hodnoty mimo rozsah XSD nebo NaN vyhodí chybu.
 */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`EET: neplatná částka ${n}`);
  // Korekce binární reprezentace (např. 1.005 * 100 = 100.49999…).
  // Zaokrouhlení od nuly (symetricky pro vratky): 0.005 → 0.01, -0.005 → -0.01.
  const scaled = Number((n * 100).toPrecision(15));
  const halere = Math.sign(scaled) * Math.round(Math.abs(scaled));
  if (Math.abs(halere) >= MAX_HALERE) throw new RangeError(`EET: částka ${n} je mimo rozsah`);
  if (halere === 0) return '0.00';
  const sign = halere < 0 ? '-' : '';
  const abs = Math.abs(halere);
  const kc = Math.floor(abs / 100);
  const h = abs % 100;
  return `${sign}${kc}.${String(h).padStart(2, '0')}`;
}

const PRAGUE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Okamžik → `YYYY-MM-DDTHH:mm:ss+01:00` / `+02:00` v čase Europe/Prague (sekundy se oříznou).
 */
export function formatDateTimePrague(date: Date): string {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new RangeError('EET: neplatné datum');
  const whole = Math.floor(ms / 1000) * 1000;
  const parts: Record<string, string> = {};
  for (const p of PRAGUE_PARTS.formatToParts(new Date(whole))) parts[p.type] = p.value;
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMin = Math.round((localAsUtc - whole) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

export const validateEic = (v: string) => RE_EIC.test(v);
export const validateRegisterId = (v: string) => RE_ID_POKL.test(v);
export const validateReceiptNo = (v: string) => RE_PORAD_CIS.test(v);
export const validateUnitId = (v: number) =>
  Number.isInteger(v) && v >= 1 && v <= 999_999_999 && RE_ID_JEDNOTKY.test(String(v));
export const validateDateTime = (v: string) => RE_DATETIME.test(v) && !Number.isNaN(Date.parse(v));
export const validateAmount = (v: string) => RE_CASTKA.test(v);
export const validateUuid = (v: string) => RE_UUID.test(v);
export const validatePok = (v: string) => RE_POK.test(v);

/** Vrátí seznam problémů (prázdný = data projdou XSD). */
export function validateTrzbaData(d: EetTrzbaData): string[] {
  const errs: string[] = [];
  if (!validateEic(d.eic)) errs.push(`eic_popl "${d.eic}" neodpovídá CZ + 8–10 číslic`);
  if (!validateUnitId(d.unitId)) errs.push(`id_jednotky "${d.unitId}" musí být celé číslo 1–999999999`);
  if (!validateRegisterId(d.registerId)) errs.push(`id_pokl "${d.registerId}" má 1–20 povolených znaků`);
  if (!validateReceiptNo(d.porad_cis)) errs.push(`porad_cis "${d.porad_cis}" má 1–25 povolených znaků`);
  if (!validateDateTime(d.dat_trzby)) errs.push(`dat_trzby "${d.dat_trzby}" není ve tvaru RRRR-MM-DDThh:mm:ss±hh:mm`);
  if (!validateAmount(d.celk_trzba)) errs.push(`celk_trzba "${d.celk_trzba}" není platná částka`);
  if (d.eic_poverujiciho !== undefined && !validateEic(d.eic_poverujiciho))
    errs.push(`eic_poverujiciho "${d.eic_poverujiciho}" neodpovídá CZ + 8–10 číslic`);
  if (d.urceno_cerp_zuct !== undefined && !validateAmount(d.urceno_cerp_zuct))
    errs.push(`urceno_cerp_zuct "${d.urceno_cerp_zuct}" není platná částka`);
  if (d.cerp_zuct !== undefined && !validateAmount(d.cerp_zuct))
    errs.push(`cerp_zuct "${d.cerp_zuct}" není platná částka`);
  return errs;
}
