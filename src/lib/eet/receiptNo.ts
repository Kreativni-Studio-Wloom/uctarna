// Číselná řada dokladů (kap. 5.2): `users/{uid}/stores/{storeId}/counters/receipts` = { year, last }.
// Čisté funkce; přidělení v transakci dělá `allocateReceiptNo` (server).

export interface ReceiptCounter {
  year: number;
  last: number;
}

export interface ReceiptSeries {
  prefix: string;
  resetYearly: boolean;
}

const PORAD_CIS_RE = /^[0-9a-zA-Z.,:;/#\-_ ]{1,25}$/;
const DIGITS = 6;

/** Rok v Europe/Prague (doklad z 31. 12. 23:30 UTC patří do nového roku). */
export function pragueYear(date: Date): number {
  const y = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric' }).format(date);
  return Number(y);
}

/** Prefix s dosazeným rokem. Při ročním resetu musí rok v čísle být, jinak by se čísla opakovala. */
export function effectivePrefix(series: ReceiptSeries, year: number): string {
  const hasYear = series.prefix.includes('{YYYY}');
  const prefix = series.prefix.split('{YYYY}').join(String(year));
  return series.resetYearly && !hasYear ? `${prefix}${year}-` : prefix;
}

export function nextCounter(current: Partial<ReceiptCounter> | undefined, year: number, resetYearly: boolean): ReceiptCounter {
  const last = typeof current?.last === 'number' && current.last >= 0 ? Math.floor(current.last) : 0;
  const sameYear = current?.year === year;
  if (resetYearly && !sameYear) return { year, last: 1 };
  return { year, last: last + 1 };
}

export function formatReceiptNo(series: ReceiptSeries, counter: ReceiptCounter): string {
  const no = `${effectivePrefix(series, counter.year)}${String(counter.last).padStart(DIGITS, '0')}`;
  if (!PORAD_CIS_RE.test(no)) {
    throw new Error(`EET: číslo dokladu „${no}“ nevyhovuje porad_cis (max. 25 znaků, povolené znaky 0-9 a-z A-Z . , : ; / # - _ mezera)`);
  }
  return no;
}
