// Společné pro testy fáze C (register, finalize, storno, fronta).
import { loadP12 } from '@/lib/eet/sign';
import { MockFirestore, asDb } from './firestoreMock';
import { parseXml, playgroundP12, playgroundPassword, select1 } from './helpers';

export const UID = 'user1';
export const STORE = 'store1';
export const STORE_PATH = `users/${UID}/stores/${STORE}`;
export const salePath = (id: string) => `${STORE_PATH}/sales/${id}`;

export const creds = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
export const loadCredentials = async () => creds;

export const eetSettings = {
  enabled: true,
  environment: 'playground',
  eic: 'CZ00000019',
  unitId: 303,
  registerId: 'WEB1',
};

export function setup(opts: { eet?: object | null; now?: () => Date } = {}) {
  const clock = { t: new Date('2026-10-17T10:00:00Z') };
  const now = opts.now ?? (() => new Date(clock.t));
  const mock = new MockFirestore(now);
  mock.seed(STORE_PATH, { name: 'Test', ...(opts.eet === null ? {} : { eet: opts.eet ?? eetSettings }) });
  return { mock, db: asDb(mock), clock, now };
}

export const POK = '987a6be5-6af5-44f3-b4fc-987654321000-ff';

export const okBody = (uuid: string) =>
  `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="${uuid}" dat_prij="2026-10-17T12:00:03+02:00"/><eet:Potvrzeni pok="${POK}" test="true"/></eet:Odpoved></S:Body></S:Envelope>`;
export const errBody = (code: number) => () =>
  `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka dat_odmit="2026-10-17T12:00:03+02:00"/><eet:Chyba kod="${code}" test="true">text</eet:Chyba></eet:Odpoved></S:Body></S:Envelope>`;

export type Responder = (uuid: string) => string | 'timeout' | 'network';

/** Mock fetch EET: odpověď podle pořadí volání (poslední se opakuje). */
export function eetFetch(...responders: Responder[]) {
  const calls: { body: string; uuid: string }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const uuid = /uuid_zpravy="([^"]+)"/.exec(body)![1];
    calls.push({ body, uuid });
    const r = (responders[Math.min(calls.length - 1, responders.length - 1)] ?? okBody)(uuid);
    if (r === 'network') throw new TypeError('fetch failed');
    if (r === 'timeout') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(r, { status: 200, headers: { 'X-Global-Transaction-Id': `gtid-${calls.length}` } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

export function attrs(xml: string, el: string): Record<string, string> {
  const e = select1(parseXml(xml), `//*[local-name(.)='${el}']`);
  return Object.fromEntries(Array.from(e.attributes as unknown as Attr[]).map((x) => [x.name, x.value]));
}

export const cartItem = (productId = 'p1', quantity = 1, price = 81.6) => ({ productId, productName: `Produkt ${productId}`, price, quantity });

/** Draft jako z CheckoutModal (hotovost, Kč). */
export function cashDraft(over: Record<string, unknown> = {}) {
  return {
    items: [cartItem()],
    totalAmount: 81.6,
    paymentMethod: 'cash' as const,
    currency: 'CZK' as const,
    eurRate: null,
    originalAmountCZK: 81.6,
    customerName: null,
    isRefund: false,
    refundAmount: null,
    paidAmount: 100,
    paidCurrency: 'CZK' as const,
    changeAmount: 18.4,
    changeAmountEUR: null,
    discount: null,
    discountAmount: 0,
    finalAmount: 81.6,
    tipAmount: null,
    sumUpData: null,
    served: false,
    ...over,
  };
}
