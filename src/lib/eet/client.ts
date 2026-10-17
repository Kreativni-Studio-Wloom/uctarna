import 'server-only';
import { DEFAULT_TIMEOUT_MS, EET_ENDPOINTS, MIN_TIMEOUT_MS, SOAP_ACTION, SOAP_CONTENT_TYPE } from './constants';
import type { EetEnvironment } from './types';

export type TransportResult =
  | { kind: 'response'; status: number; body: string; xGlobalTransactionId?: string; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'network'; message: string; ms: number };

export interface SendTrzbaOptions {
  env: EetEnvironment;
  xml: string;
  /** Mezní doba odezvy; méně než 2 s zákon nedovoluje, proto se zvedne na 2 s. */
  timeoutMs?: number;
  /** Jen pro testy / vlastní endpoint. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/** Jedno HTTP volání `OdeslaniTrzby`. Nevyhazuje: timeout i síťová chyba jsou výsledky. */
export async function sendTrzba(opts: SendTrzbaOptions): Promise<TransportResult> {
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await doFetch(opts.endpoint ?? EET_ENDPOINTS[opts.env], {
      method: 'POST',
      headers: { 'Content-Type': SOAP_CONTENT_TYPE, SOAPAction: SOAP_ACTION },
      body: opts.xml,
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      kind: 'response',
      status: res.status,
      body,
      xGlobalTransactionId: res.headers.get('x-global-transaction-id')?.slice(0, 64) || undefined,
      ms: Date.now() - started,
    };
  } catch (e) {
    const ms = Date.now() - started;
    if (controller.signal.aborted) return { kind: 'timeout', ms };
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const cause = err.cause?.code ?? err.cause?.message;
    return { kind: 'network', message: cause ? `${err.message} (${cause})` : err.message, ms };
  } finally {
    clearTimeout(timer);
  }
}
