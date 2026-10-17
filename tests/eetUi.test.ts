import { describe, expect, it } from 'vitest';
import {
  composeReceiptPrefix,
  maxReceiptLabelLength,
  parseReceiptPrefix,
  previewReceiptNumbers,
  sanitizeReceiptLabel,
  RECEIPT_QUEUED_NOTE,
  canDeleteSale,
  canResendToEet,
  checkEetSettings,
  eetBadge,
  eetFormToUpdate,
  eetQueueBannerText,
  eetResultView,
  eetSettingsToForm,
  isEetUnsent,
  pluralDoklad,
  receiptEetInfo,
  resolveCheckoutEvidence,
  saleRemovalPolicy,
  shortPok,
  shouldShowEetResult,
  summarizeEetQueue,
  summarizeEetReport,
  type EetSettingsForm,
} from '@/lib/eetUi';

const ON = { eet: { enabled: true } };
const OFF = { eet: { enabled: false } };
const NOW = new Date('2026-10-17T12:00:00Z');
const POK = '987a6be5-6af5-44f3-b4fc-987654321000-ff';
const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe('saleRemovalPolicy: kdo smí mazat / stornovat', () => {
  it('bez EET se maže jako dřív (i bez pole eet, i staré prodejny bez nastavení)', () => {
    expect(saleRemovalPolicy(OFF, {})).toEqual({ action: 'delete' });
    expect(saleRemovalPolicy(undefined, {})).toEqual({ action: 'delete' });
    expect(saleRemovalPolicy({ eet: { enabled: 'true' as unknown as boolean } }, {}).action).toBe('delete');
  });
  it('doklad s EET identitou jen stornovat, i když je EET vypnuté (nouzová brzda)', () => {
    for (const store of [OFF, undefined, {}]) {
      expect(saleRemovalPolicy(store, { eet: { status: 'sent' } }).action).toBe('storno');
      expect(saleRemovalPolicy(store, { receiptNo: '2026-000001' }).action).toBe('storno');
      expect(saleRemovalPolicy(store, { pendingNumber: true, eet: { status: 'queued' } }).action).toBe('storno');
      expect(saleRemovalPolicy(store, { receiptNo: '2026-000002', eet: { status: 'not_required' } }).action).toBe('storno');
      expect(canDeleteSale(store, { eet: { status: 'failed_permanent' } })).toBe(false);
      expect(saleRemovalPolicy(store, { receiptNo: '2026-000003', stornoOf: 'x' }).action).toBe('none');
      expect(saleRemovalPolicy(store, { receiptNo: '2026-000001', storno: { saleId: 'y' } }).action).toBe('none');
    }
  });
  it('testovací doklad (i s číslem a eet.status test) jde smazat vždy', () => {
    expect(saleRemovalPolicy(OFF, { isTest: true, receiptNo: '2026-000004', eet: { status: 'test' } }).action).toBe('delete');
    expect(saleRemovalPolicy(ON, { isTest: true, receiptNo: '2026-000004', eet: { status: 'test' } }).action).toBe('delete');
    // eet.status 'test' bez čísla není EET identita
    expect(saleRemovalPolicy(OFF, { eet: { status: 'test' } }).action).toBe('delete');
    expect(saleRemovalPolicy(OFF, { receiptNo: '' }).action).toBe('delete');
  });
  it('s EET: testovací doklad jde smazat, reálný jen stornovat', () => {
    expect(saleRemovalPolicy(ON, { isTest: true }).action).toBe('delete');
    expect(saleRemovalPolicy(ON, {}).action).toBe('storno');
    expect(saleRemovalPolicy(ON, { eet: { status: 'sent' } }).action).toBe('storno');
    expect(canDeleteSale(ON, { eet: { status: 'failed_permanent' } })).toBe(false);
  });
  it('storno a stornovaný doklad nejde ani smazat, ani znovu stornovat', () => {
    expect(saleRemovalPolicy(ON, { stornoOf: 'x' }).action).toBe('none');
    expect(saleRemovalPolicy(ON, { storno: { saleId: 'y' } }).action).toBe('none');
  });
});

describe('stav EET dokladu', () => {
  it('štítky podle stavu', () => {
    expect(eetBadge({})).toBeNull();
    expect(eetBadge({ isTest: true })).toMatchObject({ label: 'TEST' });
    expect(eetBadge({ eet: { status: 'sent', pok: POK } })).toMatchObject({ tone: 'success', label: '✓ EET' });
    expect(eetBadge({ eet: { status: 'sent', warnings: [{ code: 1, text: 'DIČ' }] } })).toMatchObject({ tone: 'warning' });
    expect(eetBadge({ eet: { status: 'queued' } })).toMatchObject({ tone: 'pending', label: '⏳ Ve frontě' });
    expect(eetBadge({ eet: { status: 'queued', overdue: true } })).toMatchObject({ tone: 'danger' });
    expect(eetBadge({ eet: { status: 'failed_permanent', message: 'kód 4' } })).toMatchObject({ tone: 'danger', title: 'kód 4' });
    expect(eetBadge({ eet: { status: 'not_required', reason: 'převod' } })).toMatchObject({ label: 'Neeviduje se', title: 'převod' });
  });
  it('neodeslané: fronta, trvalá chyba a zaseknuté pending; test a výjimka ne', () => {
    expect(isEetUnsent({ eet: { status: 'queued' } }, NOW)).toBe(true);
    expect(isEetUnsent({ eet: { status: 'failed_permanent' } }, NOW)).toBe(true);
    expect(isEetUnsent({ eet: { status: 'pending', saleAt: new Date(NOW.getTime() - 10_000).toISOString() } }, NOW)).toBe(false);
    expect(isEetUnsent({ eet: { status: 'pending', saleAt: h(1).toISOString() } }, NOW)).toBe(true);
    expect(isEetUnsent({ isTest: true, eet: { status: 'queued' } }, NOW)).toBe(false);
    expect(isEetUnsent({ eet: { status: 'not_required' } }, NOW)).toBe(false);
    expect(isEetUnsent({ eet: { status: 'sent' } }, NOW)).toBe(false);
  });
  it('Odeslat znovu jen u neodeslaného reálného dokladu se zapnutým EET', () => {
    expect(canResendToEet(ON, { eet: { status: 'queued' } })).toBe(true);
    expect(canResendToEet(ON, { eet: { status: 'failed_permanent' } })).toBe(true);
    expect(canResendToEet(OFF, { eet: { status: 'queued' } })).toBe(false);
    expect(canResendToEet(ON, { eet: { status: 'sent' } })).toBe(false);
    expect(canResendToEet(ON, { isTest: true, eet: { status: 'queued' } })).toBe(false);
  });
});

describe('banner fronty', () => {
  it('počet, nejstarší, barva podle stáří a trvalé chyby', () => {
    expect(summarizeEetQueue([], NOW)).toMatchObject({ count: 0, tone: 'info', oldestAt: null });
    const a = summarizeEetQueue([{ eet: { status: 'queued', firstAttemptAt: h(3) } }, { eet: { status: 'sent' } }], NOW);
    expect(a).toMatchObject({ count: 1, oldestHours: 3, tone: 'info' });
    expect(summarizeEetQueue([{ eet: { status: 'queued', saleAt: h(25).toISOString() } }], NOW).tone).toBe('warning');
    expect(summarizeEetQueue([{ eet: { status: 'queued', firstAttemptAt: { toDate: () => h(49), toMillis: () => 0 } } }], NOW).tone).toBe('danger');
    expect(summarizeEetQueue([{ eet: { status: 'failed_permanent', saleAt: h(0).toISOString() } }], NOW)).toMatchObject({ tone: 'danger', failedCount: 1 });
  });
  it('texty a skloňování', () => {
    expect([1, 2, 4, 5, 11].map(pluralDoklad)).toEqual(['1 doklad', '2 doklady', '4 doklady', '5 dokladů', '11 dokladů']);
    expect(eetQueueBannerText({ count: 3, failedCount: 0, oldestAt: h(5), oldestHours: 5, tone: 'info' })).toBe(
      '3 doklady čekají na odeslání do EET (nejstarší před 5 h).'
    );
    expect(eetQueueBannerText({ count: 1, failedCount: 1, oldestAt: NOW, oldestHours: 0, tone: 'danger' })).toContain('z toho 1 s chybou');
  });
});

describe('report', () => {
  it('z toho zaevidováno: jen sent, bez testů; EUR kurzem; neodeslané zvlášť', () => {
    const r = summarizeEetReport(
      [
        { totalAmount: 100, eet: { status: 'sent' } },
        { totalAmount: 4, currency: 'EUR', eurRate: 25, eet: { status: 'sent' } },
        { totalAmount: -30, eet: { status: 'sent' } },
        { totalAmount: 50, isTest: true, eet: { status: 'test' } },
        { totalAmount: 70, eet: { status: 'queued' } },
        { totalAmount: 20, eet: { status: 'not_required' } },
        { totalAmount: 10 },
      ],
      NOW
    );
    expect(r).toEqual({ sentCount: 3, sentAmount: 170, unsentCount: 1 });
  });
});

describe('okno výsledku', () => {
  it('úspěch s POK, playground a varováními', () => {
    const v = eetResultView({ receiptNo: '2026-000001', eet: { status: 'sent', pok: POK, env: 'playground', warnings: [{ code: 4, text: 'Datum v budoucnosti' }] } });
    expect(v).toMatchObject({ tone: 'success', title: 'Tržba zaevidována v EET', pok: POK, playground: true, warnings: ['Datum v budoucnosti'], canRetry: false });
    expect(shortPok(POK)).toBe('987a6be5…000-ff');
  });
  it('fronta po timeoutu = oranžová s časem; jiná chyba = červená s důvodem; trvalá = kontrola nastavení', () => {
    expect(eetResultView({ eet: { status: 'queued', attempts: [{ uuid: 'u', sentAt: '', first: true, result: 'timeout', ms: 4000 }] }, timeoutMs: 4000 })).toMatchObject({
      tone: 'timeout',
      message: 'EET neodpovědělo do 4 s, doklad čeká ve frontě.',
      canRetry: true,
    });
    expect(eetResultView({ eet: { status: 'queued', message: 'EET je nedostupná' } })).toMatchObject({ tone: 'error', message: 'EET je nedostupná', canRetry: true });
    expect(eetResultView({ eet: { status: 'failed_permanent', message: 'kód 4' } }).hint).toMatch(/nastavení EET/);
  });
  it('offline, test, výjimka a čekání', () => {
    expect(eetResultView({ offline: true })).toMatchObject({ tone: 'timeout', canRetry: false });
    expect(eetResultView({ isTest: true })).toMatchObject({ tone: 'info' });
    expect(eetResultView({ eet: { status: 'not_required', reason: 'převod' } })).toMatchObject({ tone: 'info', message: 'převod' });
    expect(eetResultView({ eet: { status: 'pending' } }).tone).toBe('pending');
  });
  it('režim „jen při chybě“', () => {
    const ok = eetResultView({ eet: { status: 'sent', pok: POK } });
    const err = eetResultView({ eet: { status: 'failed_permanent' } });
    expect(shouldShowEetResult(ok, 'errorsOnly')).toBe(false);
    expect(shouldShowEetResult(err, 'errorsOnly')).toBe(true);
    expect(shouldShowEetResult(ok, 'always')).toBe(true);
    expect(shouldShowEetResult(ok, undefined)).toBe(true);
  });
});

describe('checkout: Evidovat v EET', () => {
  const store = { testMode: false };
  it('výchozí: evidovat', () => {
    expect(resolveCheckoutEvidence({ store, choice: { mode: 'send' }, viaSumUpRedirect: false })).toMatchObject({ isTest: false, effective: 'send', locked: false });
  });
  it('testovací doklad a režim školení (zamčeno)', () => {
    expect(resolveCheckoutEvidence({ store, choice: { mode: 'test' }, viaSumUpRedirect: false })).toMatchObject({ isTest: true, effective: 'test' });
    expect(resolveCheckoutEvidence({ store: { testMode: true }, choice: { mode: 'send' }, viaSumUpRedirect: true })).toMatchObject({ isTest: true, locked: true });
  });
  it('výjimka s důvodem; přes SumUp terminál nebo bez důvodu se ignoruje', () => {
    expect(resolveCheckoutEvidence({ store, choice: { mode: 'exempt', reason: ' Převod ' }, viaSumUpRedirect: false })).toMatchObject({
      isTest: false,
      nonEvidenceReason: 'Převod',
      effective: 'exempt',
    });
    expect(resolveCheckoutEvidence({ store, choice: { mode: 'exempt', reason: 'Převod' }, viaSumUpRedirect: true })).toMatchObject({ effective: 'send', exemptIgnored: true });
    expect(resolveCheckoutEvidence({ store, choice: { mode: 'exempt', reason: ' ' }, viaSumUpRedirect: false }).nonEvidenceReason).toBeUndefined();
  });
});

describe('nastavení', () => {
  const cert = { subjectEic: 'CZ00000019', serial: '1', validFrom: '2026-01-01T00:00:00Z', validTo: '2027-06-01T00:00:00Z', env: 'playground' };
  const form = (over: Partial<EetSettingsForm> = {}): EetSettingsForm => ({ ...eetSettingsToForm({ eic: 'CZ00000019', unitId: 303, environment: 'playground' }), ...over });

  it('výchozí hodnoty formuláře a DIČ z prodejny', () => {
    expect(eetSettingsToForm(undefined, 'cz12345678')).toMatchObject({
      environment: 'playground',
      eic: 'CZ12345678',
      unitId: '',
      registerId: 'WEB1',
      tipsAreBusinessIncome: true,
      sendTimeoutMs: 4000,
      showResultModal: 'always',
      autoCloseSuccessSec: 3,
      receiptPrefix: '{YYYY}-',
      resetYearly: true,
    });
  });
  it('uložení tečkovými cestami (enabled a certificate zůstanou)', () => {
    const u = eetFormToUpdate(form({ eic: ' cz00000019 ', sendTimeoutMs: 1000 }));
    expect(u).toMatchObject({ 'eet.eic': 'CZ00000019', 'eet.unitId': 303, 'eet.sendTimeoutMs': 2000 });
    expect(Object.keys(u).some((k) => k === 'eet.enabled' || k === 'eet.certificate' || k === 'eet')).toBe(false);
  });
  it('vše v pořádku → lze zapnout; náhled čísla', () => {
    const c = checkEetSettings(form(), cert, NOW);
    expect(c.blockers).toEqual([]);
    expect(c.receiptPreview).toBe('2026-000001');
    expect(c.warnings).toEqual([]);
  });
  it('chybí certifikát, jiné prostředí, jiné DIČ, vypršelý certifikát', () => {
    expect(checkEetSettings(form(), null, NOW).blockers).toContain('Nahrajte certifikát pro EET.');
    expect(checkEetSettings(form({ environment: 'production' }), cert, NOW).blockers.join()).toMatch(/Certifikát je pro Playground/);
    expect(checkEetSettings(form({ eic: 'CZ12345678' }), cert, NOW).blockers.join()).toMatch(/neodpovídá certifikátu/);
    expect(checkEetSettings(form(), { ...cert, validTo: '2026-10-01T00:00:00Z' }, NOW).blockers.join()).toMatch(/vypršela/);
  });
  it('validace polí podle XSD a varování', () => {
    const c = checkEetSettings(form({ eic: 'CZ1', unitId: '0', registerId: 'Pokladna č.1', receiptPrefix: 'Á-' }), cert, NOW);
    expect(Object.keys(c.fieldErrors).sort()).toEqual(['eic', 'receiptPrefix', 'registerId', 'unitId']);
    expect(checkEetSettings(form({ unitId: '305' }), cert, NOW).warnings.join()).toMatch(/1–4/);
    expect(checkEetSettings(form(), { ...cert, validTo: new Date(NOW.getTime() + 10 * 86_400_000) }, NOW).warnings.join()).toMatch(/vyprší za 10 dní/);
  });
});

describe('PDF účtenka', () => {
  const store = { dic: 'CZ00000019', eet: { unitId: 303, registerId: 'WEB1' } };
  it('bez EET se nic nemění (číslo = documentId)', () => {
    expect(receiptEetInfo({ documentId: 'ABC123' }, store)).toEqual({ receiptNo: 'ABC123', rows: [], notes: [] });
  });
  it('zaevidovaný doklad: číslo, DIČ, provozovna, POK a playground poznámka', () => {
    const i = receiptEetInfo({ documentId: 'ABC', receiptNo: '2026-000007', eet: { status: 'sent', pok: POK, env: 'playground', data: { eic: 'CZ00000019', unitId: 303, registerId: 'WEB1', porad_cis: '', dat_trzby: '', celk_trzba: '' } } }, store);
    expect(i).toMatchObject({ receiptNo: '2026-000007', dic: 'CZ00000019', pok: POK, pokNote: 'TEST – POK neplatný' });
    expect(i.rows).toEqual([{ label: 'Provozovna', value: '303' }, { label: 'Pokladna', value: 'WEB1' }]);
  });
  it('doklad ve frontě a offline bez čísla', () => {
    const i = receiptEetInfo({ documentId: 'ABC', pendingNumber: true, eet: { status: 'queued' } }, store);
    expect(i.receiptNo).toBe('ABC');
    expect(i.notes).toContain(RECEIPT_QUEUED_NOTE);
    expect(i.notes.length).toBe(2);
    expect(i.pok).toBeUndefined();
  });
  it('testovací doklad bez POK a bez poznámky o frontě', () => {
    const i = receiptEetInfo({ receiptNo: '2026-000002', isTest: true, eet: { status: 'test' } }, store);
    expect(i.notes).toEqual([]);
    expect(i.pok).toBeUndefined();
  });
});

describe('číselná řada: skládání prefixu', () => {
  const now = new Date('2026-10-18T10:00:00Z');

  it.each([
    [{ label: '', year: true, separator: '-' as const }, '{YYYY}-'],
    [{ label: 'P1', year: true, separator: '-' as const }, 'P1-{YYYY}-'],
    [{ label: 'PRAHA', year: false, separator: '/' as const }, 'PRAHA/'],
    [{ label: 'P1', year: true, separator: '' as const }, 'P1{YYYY}'],
    [{ label: '', year: false, separator: '-' as const }, ''],
  ])('compose %o → %s a zpět', (parts, prefix) => {
    expect(composeReceiptPrefix(parts)).toBe(prefix);
    expect(composeReceiptPrefix(parseReceiptPrefix(prefix)!)).toBe(prefix);
  });

  it('výchozí prefix {YYYY}- se rozloží na rok s pomlčkou', () => {
    expect(parseReceiptPrefix('{YYYY}-')).toEqual({ label: '', year: true, separator: '-' });
  });

  it('neznámý tvar → null (ruční úprava)', () => {
    expect(parseReceiptPrefix('A{YYYY}B-')).toBeNull();
    expect(parseReceiptPrefix('{YYYY}-{YYYY}-')).toBeNull();
  });

  it('vlastní označení: bez diakritiky a nepovolených znaků', () => {
    expect(sanitizeReceiptLabel('Plzeň 1/č!')).toBe('Plzen 1c');
  });

  it('délka označení hlídá limit 25 znaků čísla dokladu', () => {
    const max = maxReceiptLabelLength({ year: true, separator: '-' });
    const prefix = composeReceiptPrefix({ label: 'X'.repeat(max), year: true, separator: '-' });
    expect(previewReceiptNumbers(prefix, true, now)?.[0]).toHaveLength(25);
    expect(previewReceiptNumbers(composeReceiptPrefix({ label: 'X'.repeat(max + 1), year: true, separator: '-' }), true, now)).toBeNull();
  });

  it('ukázka čísel', () => {
    expect(previewReceiptNumbers('P1-{YYYY}-', true, now)).toEqual(['P1-2026-000001', 'P1-2026-000002']);
    expect(previewReceiptNumbers('', false, now)).toEqual(['000001', '000002']);
  });
});
