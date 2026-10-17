// EET 2.0, fáze D: čistá logika uživatelského rozhraní (stavy, texty, kdo smí mazat / stornovat).
// Bez Firebase a bez 'server-only', aby šla testovat a importovat z komponent.
// Vše se používá jen u prodejny se zapnutým EET (`isEetEnabled`), mimo nastavení.

import { hasEetIdentity, isEetEnabled, resolveEetSettings } from '@/lib/eet/flags';
import { RE_EIC, RE_ID_JEDNOTKY, RE_ID_POKL } from '@/lib/eet/patterns';
import { formatReceiptNo, pragueYear } from '@/lib/eet/receiptNo';
import { isTestSale, saleAmountCzk } from '@/lib/testSales';
import type { EetEnvironmentId, SaleEet, SaleEetStatus, Store, StoreEetSettings } from '@/types';

type StoreLike = Pick<Store, 'eet'> | null | undefined;

/** Časový údaj z Firestore (Timestamp / Date), z API (ISO řetězec) nebo milisekundy. */
export function toDateLoose(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  }
  return null;
}

/** Doklad, jak ho UI zná (Firestore dokument nebo odpověď API). */
export interface EetSaleLike {
  isTest?: unknown;
  receiptNo?: string;
  pendingNumber?: boolean;
  stornoOf?: string;
  storno?: { saleId?: string } | null;
  /** Časy jako Timestamp (Firestore) nebo ISO řetězec (odpověď API). */
  eet?:
    | (Partial<Omit<SaleEet, 'status' | 'nextRetryAt' | 'firstAttemptAt' | 'lockUntil'>> & {
        status?: SaleEetStatus | string;
        nextRetryAt?: unknown;
        firstAttemptAt?: unknown;
        lockUntil?: unknown;
      })
    | null;
  createdAt?: unknown;
  totalAmount?: unknown;
  currency?: unknown;
  eurRate?: unknown;
}

// ---------------------------------------------------------------------------
// Mazání a storno
// ---------------------------------------------------------------------------

export type SaleRemovalAction = 'delete' | 'storno' | 'none';

export interface SaleRemovalPolicy {
  action: SaleRemovalAction;
  /** Proč nejde smazat (pro tooltip / AI odpověď). */
  reason?: string;
}

export const DELETE_BLOCKED_REASON = 'Doklad evidovaný v EET (s číslem z řady) nejde smazat. Použijte Stornovat.';

/**
 * Co jde s dokladem udělat místo / kromě smazání (kap. 6.4). Platí pro historii, čistič duplicit i AI:
 * - testovací doklad: smazat,
 * - doklad s EET identitou (`receiptNo` nebo `eet` mimo 'test', viz `hasEetIdentity`): jen stornovat,
 *   a to i při vypnutém EET (vypnutí je nouzová brzda, ne cesta ke smazání evidovaných dokladů);
 *   storno a už stornovaný doklad nic,
 * - ostatní (doklady bez EET): bez EET jako dřív smazat; se zapnutým EET stornovat.
 */
export function saleRemovalPolicy(store: StoreLike, sale: EetSaleLike): SaleRemovalPolicy {
  if (isTestSale(sale)) return { action: 'delete' };
  if (!hasEetIdentity(sale) && !isEetEnabled(store)) return { action: 'delete' };
  if (sale.stornoOf) return { action: 'none', reason: 'Storno dokladu nejde smazat ani znovu stornovat.' };
  if (sale.storno?.saleId) return { action: 'none', reason: 'Doklad je už stornovaný.' };
  return { action: 'storno', reason: DELETE_BLOCKED_REASON };
}

export function canDeleteSale(store: StoreLike, sale: EetSaleLike): boolean {
  return saleRemovalPolicy(store, sale).action === 'delete';
}

// ---------------------------------------------------------------------------
// Stav dokladu v EET (štítky, filtr, banner fronty)
// ---------------------------------------------------------------------------

/** Odesílání „pending“ trvá sekundy; déle visící doklad už patří do fronty (záchranný nextRetryAt je +60 s). */
export const STALE_PENDING_MS = 2 * 60_000;

/** Doklad čeká na odeslání nebo selhal (kromě testovacích a výjimek). */
export function isEetUnsent(sale: EetSaleLike, now: Date = new Date()): boolean {
  if (isTestSale(sale)) return false;
  const status = sale.eet?.status;
  if (status === 'queued' || status === 'failed_permanent') return true;
  if (status === 'pending') {
    const at = toDateLoose(sale.eet?.saleAt) ?? toDateLoose(sale.createdAt);
    return !at || now.getTime() - at.getTime() > STALE_PENDING_MS;
  }
  return false;
}

export type EetBadgeTone = 'success' | 'warning' | 'danger' | 'pending' | 'neutral' | 'test';

export interface EetBadge {
  label: string;
  tone: EetBadgeTone;
  title: string;
}

/** Štítek stavu EET v historii (kap. 6.4). `null` = doklad bez EET (stará data / prodejna bez EET). */
export function eetBadge(sale: EetSaleLike): EetBadge | null {
  if (isTestSale(sale)) return { label: 'TEST', tone: 'test', title: 'Testovací doklad, do EET se neodesílá' };
  const eet = sale.eet;
  if (!eet?.status) return null;
  switch (eet.status) {
    case 'sent':
      return eet.warnings?.length
        ? { label: '✓ EET s varováním', tone: 'warning', title: eet.warnings.map((w) => w.text).join('; ') }
        : { label: '✓ EET', tone: 'success', title: eet.pok ? `POK ${eet.pok}` : 'Zaevidováno' };
    case 'pending':
      return { label: 'Odesílá se', tone: 'pending', title: 'Doklad se právě odesílá do EET' };
    case 'queued':
      return {
        label: eet.overdue ? '⏳ Po lhůtě 48 h' : '⏳ Ve frontě',
        tone: eet.overdue ? 'danger' : 'pending',
        title: eet.message ?? 'Čeká na opakované odeslání do EET',
      };
    case 'failed_permanent':
      return { label: '✗ Chyba EET', tone: 'danger', title: eet.message ?? 'Odeslání do EET selhalo' };
    case 'not_required':
      return { label: 'Neeviduje se', tone: 'neutral', title: eet.reason ?? 'Doklad nepodléhá evidenci' };
    case 'test':
      return { label: 'TEST', tone: 'test', title: 'Testovací doklad, do EET se neodesílá' };
    default:
      return null;
  }
}

/** Ruční „Odeslat znovu“ dává smysl jen u neodeslaného reálného dokladu. */
export function canResendToEet(store: StoreLike, sale: EetSaleLike): boolean {
  if (!isEetEnabled(store) || isTestSale(sale)) return false;
  const s = sale.eet?.status;
  return s === 'queued' || s === 'failed_permanent' || (s === 'pending' && isEetUnsent(sale));
}

export type QueueBannerTone = 'info' | 'warning' | 'danger';

export interface EetQueueSummary {
  count: number;
  failedCount: number;
  oldestAt: Date | null;
  /** Stáří nejstaršího dokladu v hodinách (zaokrouhleno dolů). */
  oldestHours: number;
  tone: QueueBannerTone;
}

/** Banner „X dokladů čeká na odeslání do EET“: po 24 h oranžový, po 48 h nebo při trvalé chybě červený. */
export function summarizeEetQueue(sales: EetSaleLike[], now: Date = new Date()): EetQueueSummary {
  let count = 0;
  let failedCount = 0;
  let oldest: Date | null = null;
  for (const sale of sales) {
    if (!isEetUnsent(sale, now)) continue;
    count += 1;
    if (sale.eet?.status === 'failed_permanent') failedCount += 1;
    const at = toDateLoose(sale.eet?.firstAttemptAt) ?? toDateLoose(sale.eet?.saleAt) ?? toDateLoose(sale.createdAt);
    if (at && (!oldest || at < oldest)) oldest = at;
  }
  const hours = oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 3_600_000)) : 0;
  const tone: QueueBannerTone = failedCount > 0 || hours >= 48 ? 'danger' : hours >= 24 ? 'warning' : 'info';
  return { count, failedCount, oldestAt: oldest, oldestHours: hours, tone };
}

/** „1 doklad“, „2 doklady“, „5 dokladů“ */
export function pluralDoklad(n: number): string {
  if (n === 1) return '1 doklad';
  if (n >= 2 && n <= 4) return `${n} doklady`;
  return `${n} dokladů`;
}

export function eetQueueBannerText(s: EetQueueSummary): string {
  const verb = s.count === 1 ? 'čeká' : s.count >= 2 && s.count <= 4 ? 'čekají' : 'čeká';
  const age = s.oldestAt ? (s.oldestHours >= 1 ? ` (nejstarší před ${s.oldestHours} h)` : ' (nejstarší před méně než hodinou)') : '';
  const failed = s.failedCount > 0 ? `, z toho ${s.failedCount} s chybou, kterou je třeba vyřešit` : '';
  return `${pluralDoklad(s.count)} ${verb} na odeslání do EET${age}${failed}.`;
}

// ---------------------------------------------------------------------------
// Reporty (kap. 6.6)
// ---------------------------------------------------------------------------

export interface EetReportSummary {
  sentCount: number;
  /** Součet zaevidovaných dokladů v Kč (EUR přepočtené kurzem z dokladu, vratky záporně). */
  sentAmount: number;
  unsentCount: number;
}

export function summarizeEetReport(sales: EetSaleLike[], now: Date = new Date()): EetReportSummary {
  let sentCount = 0;
  let sentAmount = 0;
  let unsentCount = 0;
  for (const sale of sales) {
    if (isTestSale(sale)) continue;
    if (sale.eet?.status === 'sent') {
      sentCount += 1;
      sentAmount += saleAmountCzk(sale);
    } else if (isEetUnsent(sale, now)) {
      unsentCount += 1;
    }
  }
  return { sentCount, sentAmount, unsentCount };
}

// ---------------------------------------------------------------------------
// Okno s výsledkem (kap. 6.3)
// ---------------------------------------------------------------------------

export type EetResultTone = 'success' | 'error' | 'timeout' | 'pending' | 'info';

export interface EetResultView {
  tone: EetResultTone;
  title: string;
  message?: string;
  /** Doplňující řádek (fronta, kontrola nastavení). */
  hint?: string;
  receiptNo?: string;
  pok?: string;
  playground: boolean;
  warnings: string[];
  canRetry: boolean;
}

export const EET_AUTO_RETRY_HINT = 'Doklad je uložen a odešle se automaticky znovu (do 48 h).';
export const EET_CHECK_SETTINGS_HINT = 'Zkontrolujte nastavení EET (certifikát, DIČ, evidenční jednotka).';

/** Zkrácený POK pro okno: první a poslední skupina. */
export function shortPok(pok: string): string {
  return pok.length > 16 ? `${pok.slice(0, 8)}…${pok.slice(-6)}` : pok;
}

export interface EetResultInput {
  eet?: EetSaleLike['eet'];
  receiptNo?: string;
  isTest?: boolean;
  /** Doklad uložený offline z klienta (`EetSaveResult.kind === 'offline'`). */
  offline?: boolean;
  timeoutMs?: number;
}

export function eetResultView(input: EetResultInput): EetResultView {
  const eet = input.eet ?? undefined;
  const base = {
    receiptNo: input.receiptNo,
    playground: eet?.env === 'playground',
    warnings: (eet?.warnings ?? []).map((w) => w.text),
    canRetry: false,
  };
  if (input.isTest || eet?.status === 'test') {
    return { ...base, tone: 'info', title: 'Testovací doklad', message: 'Doklad je uložen, do EET se neodesílá.' };
  }
  if (input.offline && !eet?.pok) {
    return {
      ...base,
      tone: 'timeout',
      title: 'Doklad čeká ve frontě EET',
      message: 'Spojení se serverem není k dispozici, doklad je uložen v zařízení.',
      hint: 'Číslo dokladu se přidělí a tržba odešle, jakmile bude spojení zpět.',
    };
  }
  switch (eet?.status) {
    case 'sent':
      return { ...base, tone: 'success', title: 'Tržba zaevidována v EET', pok: eet.pok };
    case 'not_required':
      return { ...base, tone: 'info', title: 'Doklad se do EET neodesílá', message: eet.reason };
    case 'pending':
      return { ...base, tone: 'pending', title: 'Odesílám tržbu do EET…' };
    case 'queued': {
      const last = eet.attempts?.[eet.attempts.length - 1];
      if (last?.result === 'timeout') {
        const s = Math.round((input.timeoutMs ?? 4000) / 1000);
        return {
          ...base,
          tone: 'timeout',
          canRetry: true,
          title: 'EET neodpovědělo včas',
          message: `EET neodpovědělo do ${s} s, doklad čeká ve frontě.`,
          hint: EET_AUTO_RETRY_HINT,
        };
      }
      return {
        ...base,
        tone: 'error',
        canRetry: true,
        title: 'Tržbu se nepodařilo odeslat do EET',
        message: eet.message,
        hint: eet.overdue ? 'Uplynulo 48 h od prvního pokusu, odešlete doklad co nejdřív.' : EET_AUTO_RETRY_HINT,
      };
    }
    case 'failed_permanent':
      return {
        ...base,
        tone: 'error',
        canRetry: true,
        title: 'Tržbu se nepodařilo odeslat do EET',
        message: eet.message,
        hint: EET_CHECK_SETTINGS_HINT,
      };
    default:
      return { ...base, tone: 'pending', title: 'Ukládám doklad…' };
  }
}

/** Režim „jen při chybě“ ukáže okno jen u chyby a fronty. */
export function shouldShowEetResult(view: EetResultView, mode: StoreEetSettings['showResultModal']): boolean {
  if (mode !== 'errorsOnly') return true;
  return view.tone === 'error' || view.tone === 'timeout';
}

export const DEFAULT_AUTO_CLOSE_SEC = 3;

export function autoCloseSeconds(eet: StoreEetSettings | undefined | null): number {
  const v = eet?.autoCloseSuccessSec;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30 ? Math.round(v) : DEFAULT_AUTO_CLOSE_SEC;
}

// ---------------------------------------------------------------------------
// Checkout: „Evidovat v EET“ (kap. 6.2)
// ---------------------------------------------------------------------------

export type EetEvidenceChoice = { mode: 'send' } | { mode: 'test' } | { mode: 'exempt'; reason: string };

export const NON_EVIDENCE_REASONS = [
  'Platba převodem na účet bez osobního kontaktu',
  'Platba nepodléhá evidenci (zákonná výjimka)',
] as const;

export interface CheckoutEvidence {
  isTest: boolean;
  /** Výjimka z evidence → finalize s `eetSend: false` a tímto důvodem. */
  nonEvidenceReason?: string;
  /** Řádek je zamčený (režim školení). */
  locked: boolean;
  /** Výjimku nejde použít (platba přes SumUp terminál se eviduje vždy). */
  exemptIgnored: boolean;
  effective: EetEvidenceChoice['mode'];
}

/** Výchozí volba: jen testovací produkty → testovací doklad, jinak evidovat. */
export function defaultEvidenceChoice(onlyTestProducts: boolean): EetEvidenceChoice {
  return onlyTestProducts ? { mode: 'test' } : { mode: 'send' };
}

export function resolveCheckoutEvidence(p: {
  store: Pick<Store, 'testMode'> | null | undefined;
  choice: EetEvidenceChoice;
  viaSumUpRedirect: boolean;
}): CheckoutEvidence {
  if (p.store?.testMode === true) return { isTest: true, locked: true, exemptIgnored: false, effective: 'test' };
  if (p.choice.mode === 'test') return { isTest: true, locked: false, exemptIgnored: false, effective: 'test' };
  if (p.choice.mode === 'exempt') {
    const reason = p.choice.reason.trim();
    if (p.viaSumUpRedirect || reason.length < 3) return { isTest: false, locked: false, exemptIgnored: true, effective: 'send' };
    return { isTest: false, nonEvidenceReason: reason, locked: false, exemptIgnored: false, effective: 'exempt' };
  }
  return { isTest: false, locked: false, exemptIgnored: false, effective: 'send' };
}

// ---------------------------------------------------------------------------
// Nastavení (kap. 6.1)
// ---------------------------------------------------------------------------

export interface EetSettingsForm {
  environment: EetEnvironmentId;
  eic: string;
  unitId: string;
  registerId: string;
  tipsAreBusinessIncome: boolean;
  sendTimeoutMs: number;
  showResultModal: 'always' | 'errorsOnly';
  autoCloseSuccessSec: number;
  receiptPrefix: string;
  resetYearly: boolean;
}

export function eetSettingsToForm(eet: StoreEetSettings | undefined | null, storeDic?: string): EetSettingsForm {
  const r = resolveEetSettings(eet);
  return {
    environment: r.environment,
    eic: r.eic || (storeDic ?? '').trim().toUpperCase(),
    unitId: Number.isFinite(r.unitId) ? String(r.unitId) : '',
    registerId: r.registerId,
    tipsAreBusinessIncome: r.tipsAreBusinessIncome,
    sendTimeoutMs: r.sendTimeoutMs,
    showResultModal: eet?.showResultModal === 'errorsOnly' ? 'errorsOnly' : 'always',
    autoCloseSuccessSec: autoCloseSeconds(eet),
    receiptPrefix: r.receiptSeries.prefix,
    resetYearly: r.receiptSeries.resetYearly,
  };
}

/** Pole pro `updateDoc` (tečkové cesty, takže `enabled` a `certificate` zůstanou). */
export function eetFormToUpdate(f: EetSettingsForm): Record<string, unknown> {
  return {
    'eet.environment': f.environment,
    'eet.eic': f.eic.trim().toUpperCase(),
    'eet.unitId': Number(f.unitId),
    'eet.registerId': f.registerId.trim(),
    'eet.tipsAreBusinessIncome': f.tipsAreBusinessIncome,
    'eet.sendTimeoutMs': Math.max(2000, Math.round(f.sendTimeoutMs)),
    'eet.showResultModal': f.showResultModal,
    'eet.autoCloseSuccessSec': Math.min(30, Math.max(1, Math.round(f.autoCloseSuccessSec))),
    'eet.receiptSeries': { prefix: f.receiptPrefix, resetYearly: f.resetYearly },
  };
}

export interface CertificateMeta {
  subjectEic: string;
  serial: string;
  validFrom: unknown;
  validTo: unknown;
  env: EetEnvironmentId | string;
}

export interface EetSettingsCheck {
  /** Chyby polí (klíč = pole formuláře). */
  fieldErrors: Partial<Record<keyof EetSettingsForm, string>>;
  /** Co brání zapnutí EET (čitelné věty). */
  blockers: string[];
  warnings: string[];
  /** Ukázka dalšího čísla dokladu, nebo null při chybném prefixu. */
  receiptPreview: string | null;
}

export function checkEetSettings(f: EetSettingsForm, cert: CertificateMeta | null | undefined, now: Date = new Date()): EetSettingsCheck {
  const fieldErrors: EetSettingsCheck['fieldErrors'] = {};
  const blockers: string[] = [];
  const warnings: string[] = [];
  const eic = f.eic.trim().toUpperCase();

  if (!RE_EIC.test(eic)) fieldErrors.eic = 'DIČ musí být ve tvaru CZ a 8–10 číslic.';
  if (!RE_ID_JEDNOTKY.test(f.unitId.trim())) fieldErrors.unitId = 'Číslo evidenční jednotky je 1 až 9 číslic, nezačíná nulou.';
  else if (!/[1-4]$/.test(f.unitId.trim()))
    warnings.push('Číslo evidenční jednotky obvykle končí číslicí 1–4 (kontrolní číslice z DIS+). Zkontrolujte ho.');
  if (!RE_ID_POKL.test(f.registerId.trim())) fieldErrors.registerId = 'Označení pokladny: 1–20 znaků (písmena bez diakritiky, číslice, . , : ; / # - _ mezera).';
  if (!(f.sendTimeoutMs >= 2000)) fieldErrors.sendTimeoutMs = 'Mezní doba odezvy musí být nejméně 2 s.';

  let receiptPreview: string | null = null;
  try {
    receiptPreview = formatReceiptNo({ prefix: f.receiptPrefix, resetYearly: f.resetYearly }, { year: pragueYear(now), last: 1 });
  } catch {
    fieldErrors.receiptPrefix = 'Prefix obsahuje nepovolené znaky nebo je číslo delší než 25 znaků.';
  }

  if (!cert) blockers.push('Nahrajte certifikát pro EET.');
  else {
    const validTo = toDateLoose(cert.validTo);
    if (cert.env !== f.environment)
      blockers.push(`Certifikát je pro ${envLabel(cert.env)}, ale je vybráno prostředí ${envLabel(f.environment)}.`);
    if (!fieldErrors.eic && cert.subjectEic.toUpperCase() !== eic) blockers.push(`DIČ ${eic} neodpovídá certifikátu (${cert.subjectEic}).`);
    if (validTo && validTo.getTime() <= now.getTime()) blockers.push('Platnost certifikátu vypršela, nahrajte nový.');
    else if (validTo) {
      const days = Math.ceil((validTo.getTime() - now.getTime()) / 86_400_000);
      if (days <= 30) warnings.push(`Certifikát vyprší za ${days} ${days === 1 ? 'den' : days <= 4 ? 'dny' : 'dní'}. Včas nahrajte nový.`);
    }
  }
  const labels: Partial<Record<keyof EetSettingsForm, string>> = {
    eic: 'DIČ',
    unitId: 'číslo evidenční jednotky',
    registerId: 'označení pokladny',
    sendTimeoutMs: 'mezní doba odezvy',
    receiptPrefix: 'prefix číselné řady',
  };
  for (const key of Object.keys(fieldErrors) as (keyof EetSettingsForm)[]) blockers.push(`Vyplňte správně pole ${labels[key] ?? key}.`);
  return { fieldErrors, blockers, warnings, receiptPreview };
}

export function envLabel(env: string): string {
  return env === 'production' ? 'produkci' : 'Playground (test)';
}

// ---------------------------------------------------------------------------
// PDF účtenka (kap. 6.5)
// ---------------------------------------------------------------------------

export interface ReceiptEetInfo {
  /** Číslo dokladu na účtence. */
  receiptNo: string;
  /** DIČ (u dokladů s EET). */
  dic?: string;
  rows: { label: string; value: string }[];
  pok?: string;
  /** „TEST – POK neplatný“ u Playgroundu. */
  pokNote?: string;
  /** Centrované poznámky (fronta, výjimka). */
  notes: string[];
}

export const RECEIPT_QUEUED_NOTE = 'Tržba bude zaevidována dodatečně (EET ve frontě).';
export const RECEIPT_PENDING_NUMBER_NOTE = 'Číslo dokladu bude přiděleno dodatečně.';

/**
 * Údaje EET na účtence. Doklad bez `eet` a `receiptNo` (prodejna bez EET, staré doklady)
 * vrací jen dnešní číslo dokladu, takže se účtenka nemění.
 */
export function receiptEetInfo(
  sale: EetSaleLike & { documentId?: string; id?: string },
  store: Pick<Store, 'dic' | 'eet'> | null | undefined
): ReceiptEetInfo {
  const fallbackNo = sale.documentId || sale.id || '';
  const eet = sale.eet;
  if (!eet && !sale.receiptNo) return { receiptNo: fallbackNo, rows: [], notes: [] };

  const info: ReceiptEetInfo = { receiptNo: sale.receiptNo || fallbackNo, rows: [], notes: [] };
  const dic = (store?.dic || eet?.data?.eic || store?.eet?.eic || '').trim().toUpperCase();
  if (dic) info.dic = dic;
  const unitId = eet?.data?.unitId ?? store?.eet?.unitId;
  if (unitId) info.rows.push({ label: 'Provozovna', value: String(unitId) });
  const registerId = eet?.data?.registerId ?? store?.eet?.registerId;
  if (registerId) info.rows.push({ label: 'Pokladna', value: registerId });
  if (sale.pendingNumber && !sale.receiptNo) info.notes.push(RECEIPT_PENDING_NUMBER_NOTE);

  if (isTestSale(sale) || eet?.status === 'test') return info;
  if (eet?.status === 'sent' && eet.pok) {
    info.pok = eet.pok;
    if (eet.env === 'playground') info.pokNote = 'TEST – POK neplatný';
  } else if (eet?.status === 'not_required') {
    info.notes.push('Tržba nepodléhá evidenci.');
  } else if (eet?.status) {
    info.notes.push(RECEIPT_QUEUED_NOTE);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Konec platnosti certifikátu (fáze E: záloha k automatické obnově)
// ---------------------------------------------------------------------------

/** Od kolika dní před koncem platnosti ukazovat upozornění (= začátek automatické obnovy). */
export const CERT_NOTICE_DAYS = 21;

export interface CertificateNotice {
  tone: 'info' | 'warning' | 'danger';
  daysLeft: number;
  text: string;
}

const pluralDen = (n: number) => (n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní');

/**
 * Banner „certifikát vyprší za N dní“ (jen při zapnutém EET). Produkční certifikát obnovuje
 * server sám (/api/eet/cert-renew); banner je pojistka, kdyby obnova neproběhla.
 */
export function certificateNotice(store: StoreLike, now: Date = new Date()): CertificateNotice | null {
  if (!isEetEnabled(store)) return null;
  const cert = store?.eet?.certificate;
  const validTo = toDateLoose(cert?.validTo);
  if (!cert || !validTo) return null;
  const daysLeft = Math.ceil((validTo.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft <= 0) {
    return { tone: 'danger', daysLeft, text: 'Certifikát EET vypršel, tržby nejde evidovat. Nahrajte nový v Nastavení → EET 2.0.' };
  }
  if (daysLeft > CERT_NOTICE_DAYS) return null;
  const renewal = store?.eet?.certificateRenewal;
  const base = `Certifikát EET vyprší za ${daysLeft} ${pluralDen(daysLeft)}.`;
  if (renewal?.state === 'rejected' || renewal?.state === 'failed') {
    return { tone: 'danger', daysLeft, text: `${base} Automatická obnova selhala${renewal.message ? `: ${renewal.message}` : '.'} Nahrajte nový certifikát v Nastavení.` };
  }
  if (cert.env !== 'production') {
    return { tone: daysLeft <= 7 ? 'danger' : 'warning', daysLeft, text: `${base} Nahrajte nový v Nastavení → EET 2.0.` };
  }
  const tone = daysLeft <= 3 ? 'danger' : daysLeft <= 14 ? 'warning' : 'info';
  const tail = renewal?.state === 'in_process' ? 'Žádost o nový certifikát je podaná, čeká se na vydání.' : 'Obnovuje se automaticky; kdyby se to nepovedlo, nahrajte nový v Nastavení.';
  return { tone, daysLeft, text: `${base} ${tail}` };
}
