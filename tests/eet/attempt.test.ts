import { describe, expect, it } from 'vitest';
import {
  classifyResult,
  computeNextRetryAt,
  isOverdue,
  retryDelayMs,
  sendTrzbaAttempt,
} from '@/lib/eet/attempt';
import { loadP12 } from '@/lib/eet/sign';
import type { EetResult, EetTrzbaData } from '@/lib/eet/types';
import { parseXml, playgroundP12, playgroundPassword, select1 } from './helpers';

const base = { uuid: 'u', sentAt: 's', firstAttempt: true, ms: 1 };
const err = (code: number): EetResult => ({ ...base, kind: 'error', code, text: '', test: true, warnings: [] });
const MIN = 60_000;

describe('classifyResult', () => {
  it('ok, timeout, síť', () => {
    expect(classifyResult({ ...base, kind: 'ok', pok: 'x', test: true, warnings: [] })).toBe('ok');
    expect(classifyResult({ ...base, kind: 'timeout' })).toBe('retryable');
    expect(classifyResult({ ...base, kind: 'network', message: 'ECONNRESET' })).toBe('retryable');
  });

  it('kód 0 je úspěch jen v ověřovacím módu', () => {
    expect(classifyResult(err(0), { verify: true })).toBe('ok');
    expect(classifyResult(err(0))).toBe('permanent');
  });

  it('dočasné chyby (záporné kódy) se opakují', () => {
    expect(classifyResult(err(-1))).toBe('retryable');
    expect(classifyResult(err(-50))).toBe('retryable');
  });

  it.each([2, 3, 4, 6, 7, 99])('kód %i je trvalý', (code) => {
    expect(classifyResult(err(code))).toBe('permanent');
  });

  it('kód 8 se opakuje 3×, pak je trvalý', () => {
    expect(classifyResult(err(8))).toBe('retryable');
    expect(classifyResult(err(8), { previousCode8Count: 2 })).toBe('retryable');
    expect(classifyResult(err(8), { previousCode8Count: 3 })).toBe('permanent');
  });
});

describe('backoff', () => {
  it('1, 2, 5, 10, 20, 30 min, pak stále 30 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n) / MIN)).toEqual([1, 2, 5, 10, 20, 30, 30, 30]);
    expect(retryDelayMs(0)).toBe(MIN);
  });

  it('nextRetryAt', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    expect(computeNextRetryAt(3, now).toISOString()).toBe('2026-10-17T10:05:00.000Z');
  });

  it('lhůta 48 h', () => {
    const first = new Date('2026-10-15T10:00:00Z');
    expect(isOverdue(first, new Date('2026-10-17T10:00:00Z'))).toBe(false);
    expect(isOverdue(first, new Date('2026-10-17T10:00:01Z'))).toBe(true);
    expect(isOverdue(undefined, new Date())).toBe(false);
  });
});

describe('sendTrzbaAttempt (mock fetch)', () => {
  const credentials = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
  const data: EetTrzbaData = {
    eic: 'CZ00000019',
    unitId: 303,
    registerId: 'WEB1',
    porad_cis: '2026-000007',
    dat_trzby: '2026-10-17T12:00:00+02:00',
    celk_trzba: '81.60',
  };
  const now = () => new Date('2026-10-17T10:00:03Z');

  function mockFetch(respond: (uuid: string) => { status?: number; body: string }) {
    const calls: { url: string; init: RequestInit; uuid: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const uuid = /uuid_zpravy="([^"]+)"/.exec(String(init.body))![1];
      calls.push({ url, init, uuid });
      const r = respond(uuid);
      return new Response(r.body, { status: r.status ?? 200, headers: { 'X-Global-Transaction-Id': 'gtid-1' } });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const ok = (uuid: string) => ({
    body: `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="${uuid}" dat_prij="2026-10-17T12:00:03+02:00"/><eet:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff" test="true"/></eet:Odpoved></S:Body></S:Envelope>`,
  });
  const chyba = (code: number) => () => ({
    body: `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka dat_odmit="2026-10-17T12:00:03+02:00"/><eet:Chyba kod="${code}" test="true">text</eet:Chyba></eet:Odpoved></S:Body></S:Envelope>`,
  });

  it('úspěšný 1. pokus: hlavičky požadavku, POK, X-Global-Transaction-Id', async () => {
    const { calls, fetchImpl } = mockFetch(ok);
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
    expect(a.classification).toBe('ok');
    expect(a.nextRetryAt).toBeUndefined();
    expect(a.result).toMatchObject({ kind: 'ok', pok: expect.stringMatching(/-ff$/), xGlobalTransactionId: 'gtid-1', httpStatus: 200 });
    expect(a.header).toMatchObject({ firstAttempt: true, sentAt: '2026-10-17T12:00:03+02:00' });
    expect(a.message).toMatch(/POK/);
    expect(calls[0].url).toBe('https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4');
    expect(calls[0].init.headers).toMatchObject({
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://fs.gov.cz/eet/OdeslaniTrzby',
    });
    expect(calls[0].init.cache).toBe('no-store');
    expect(String(calls[0].init.body)).not.toContain('overeni=');
  });

  it('opakování: nové UUID a dat_odesl, prvni_zaslani=false, stejná Data', async () => {
    const { calls, fetchImpl } = mockFetch(ok);
    await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
    await sendTrzbaAttempt({
      env: 'playground', credentials, data, firstAttempt: false, fetchImpl,
      now: () => new Date('2026-10-17T10:05:00Z'),
    });
    const [a, b] = calls.map((c) => parseXml(String(c.init.body)));
    const attrs = (d: Document, el: string) => {
      const e = select1(d, `//*[local-name(.)='${el}']`);
      return Object.fromEntries(Array.from(e.attributes as unknown as Attr[]).map((x) => [x.name, x.value]));
    };
    expect(attrs(a, 'Data')).toEqual(attrs(b, 'Data'));
    expect(calls[0].uuid).not.toBe(calls[1].uuid);
    expect(attrs(a, 'Hlavicka').prvni_zaslani).toBe('true');
    expect(attrs(b, 'Hlavicka')).toMatchObject({ prvni_zaslani: 'false', dat_odesl: '2026-10-17T12:05:00+02:00' });
  });

  it('ověřovací mód: overeni=true a kód 0 = ok', async () => {
    const { calls, fetchImpl } = mockFetch(chyba(0));
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, verify: true, fetchImpl, now });
    expect(String(calls[0].init.body)).toContain('overeni="true"');
    expect(a.classification).toBe('ok');
    expect(a.message).toMatch(/Ověření/);
  });

  it('kód -1 → retryable s nextRetryAt podle pořadí pokusu', async () => {
    const { fetchImpl } = mockFetch(chyba(-1));
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: false, attemptNo: 4, fetchImpl, now });
    expect(a.classification).toBe('retryable');
    expect(a.nextRetryAt!.getTime() - now().getTime()).toBe(10 * MIN);
  });

  it('kód 4 → permanent, bez nextRetryAt', async () => {
    const { fetchImpl } = mockFetch(chyba(4));
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
    expect(a.classification).toBe('permanent');
    expect(a.nextRetryAt).toBeUndefined();
    expect(a.message).toMatch(/kód 4/);
  });

  it('HTTP 500 se SOAP Fault → network, retryable', async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 500,
      body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>boom</faultstring></s:Fault></s:Body></s:Envelope>`,
    }));
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
    expect(a.result).toMatchObject({ kind: 'network', httpStatus: 500, message: expect.stringMatching(/SOAP Fault.*boom/) });
    expect(a.classification).toBe('retryable');
  });

  it('prázdná odpověď / jiné UUID → network, retryable', async () => {
    for (const body of ['', ok('00000000-0000-4000-8000-000000000000').body]) {
      const { fetchImpl } = mockFetch(() => ({ body }));
      const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
      expect(a.result.kind).toBe('network');
      expect(a.classification).toBe('retryable');
    }
  });

  it('síťová chyba → network', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    const a = await sendTrzbaAttempt({ env: 'playground', credentials, data, firstAttempt: true, fetchImpl, now });
    expect(a.result).toMatchObject({ kind: 'network', message: 'fetch failed (ENOTFOUND)' });
    expect(a.classification).toBe('retryable');
  });

  it('timeout: server neodpoví → timeout (min. 2 s i při nižším nastavení)', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const a = await sendTrzbaAttempt({
      env: 'playground', credentials, data, firstAttempt: true, fetchImpl, timeoutMs: 10,
      firstAttemptAt: new Date('2026-10-15T09:00:00Z'), now,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(a.result.kind).toBe('timeout');
    expect(a.classification).toBe('retryable');
    expect(a.overdue).toBe(true);
  }, 10_000);

  it('neplatná data se ani neodešlou', async () => {
    const { calls, fetchImpl } = mockFetch(ok);
    await expect(
      sendTrzbaAttempt({ env: 'playground', credentials, data: { ...data, celk_trzba: '-0.00' }, firstAttempt: true, fetchImpl }),
    ).rejects.toThrow(/neplatná data/);
    expect(calls).toHaveLength(0);
  });
});
