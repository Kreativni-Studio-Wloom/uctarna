import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { sendTrzba, type TransportResult } from './client';
import {
  EET_ERROR_TEXTS,
  MAX_CODE_8_RETRIES,
  RETRY_BACKOFF_MINUTES,
  RETRY_DEADLINE_MS,
} from './constants';
import { formatDateTimePrague } from './format';
import { parseResponse } from './parse';
import { signBody } from './sign';
import { buildBody, buildEnvelope, byteLength } from './xml';
import type {
  EetClassification,
  EetCredentials,
  EetEnvironment,
  EetHeader,
  EetResult,
  EetTrzbaData,
} from './types';

/*
 * Jeden pokus o evidenci tržby: postaví a podepíše zprávu, odešle ji a výsledek zařadí.
 * Bez Firestore: perzistenci pokusů, zmrazení `Data` a frontu řeší volající (fáze C).
 */

export interface SendTrzbaAttemptInput {
  env: EetEnvironment;
  credentials: Pick<EetCredentials, 'privateKeyPem' | 'certDerB64'>;
  /** Při opakování musí být stejná jako při 1. pokusu. */
  data: EetTrzbaData;
  /** prvni_zaslani: true jen u úplně prvního pokusu (i když selže). */
  firstAttempt: boolean;
  /** Ověřovací mód (overeni=true): nic se neeviduje, úspěch = chyba 0. */
  verify?: boolean;
  timeoutMs?: number;
  /** Pořadí tohoto pokusu (1 = první), určuje prodlevu do dalšího. */
  attemptNo?: number;
  /** Kolikrát už u této tržby přišla chyba 8. */
  previousCode8Count?: number;
  /** Čas 1. pokusu, kvůli lhůtě 48 h. */
  firstAttemptAt?: Date;
  now?: () => Date;
  /** Jen pro testy a smoke test. */
  newUuid?: () => string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** Jen pro smoke test (vynucené chyby): úprava hotové obálky před odesláním. */
  tamperEnvelope?: (xml: string) => string;
}

export interface EetAttempt {
  result: EetResult;
  classification: EetClassification;
  /** Kdy pokus zopakovat (jen u `retryable`). */
  nextRetryAt?: Date;
  /** Uplynulo 48 h od 1. pokusu; posílat se musí dál, ale obsluha má být upozorněna. */
  overdue: boolean;
  /** Text pro obsluhu. */
  message: string;
  requestBytes: number;
  header: EetHeader;
}

export class EetValidationError extends Error {}

export interface ClassifyOptions {
  verify?: boolean;
  previousCode8Count?: number;
}

export function classifyResult(result: EetResult, opts: ClassifyOptions = {}): EetClassification {
  switch (result.kind) {
    case 'ok':
      return 'ok';
    case 'timeout':
    case 'network':
      return 'retryable';
    case 'error':
      if (result.code === 0) return opts.verify ? 'ok' : 'permanent';
      if (result.code < 0) return 'retryable';
      if (result.code === 8) return (opts.previousCode8Count ?? 0) < MAX_CODE_8_RETRIES ? 'retryable' : 'permanent';
      return 'permanent';
  }
}

/** Prodleva po neúspěšném pokusu č. `attemptNo`: 1, 2, 5, 10, 20, 30 min, pak každých 30 min. */
export function retryDelayMs(attemptNo: number): number {
  const i = Math.min(Math.max(1, Math.floor(attemptNo)), RETRY_BACKOFF_MINUTES.length) - 1;
  return RETRY_BACKOFF_MINUTES[i] * 60_000;
}

export function computeNextRetryAt(attemptNo: number, now: Date): Date {
  return new Date(now.getTime() + retryDelayMs(attemptNo));
}

export function isOverdue(firstAttemptAt: Date | undefined, now: Date): boolean {
  return !!firstAttemptAt && now.getTime() - firstAttemptAt.getTime() > RETRY_DEADLINE_MS;
}

export function resultMessage(result: EetResult, verify = false): string {
  switch (result.kind) {
    case 'ok':
      return `Evidováno v EET, POK ${result.pok}`;
    case 'timeout':
      return `EET neodpověděla do ${(result.ms / 1000).toFixed(1)} s, odešle se znovu`;
    case 'network':
      return `EET je nedostupná (${result.message}), odešle se znovu`;
    case 'error':
      if (result.code === 0 && verify) return 'Ověření spojení s EET proběhlo v pořádku';
      return `EET odmítla zprávu (kód ${result.code}): ${EET_ERROR_TEXTS[result.code] ?? result.text}`;
  }
}

/** Unikátní XML Id pro tělo zprávy a prvky podpisu. */
export function newBodyIdSuffix(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

export async function sendTrzbaAttempt(input: SendTrzbaAttemptInput): Promise<EetAttempt> {
  const now = input.now ?? (() => new Date());
  const header: EetHeader = {
    uuid: (input.newUuid ?? randomUUID)(),
    sentAt: formatDateTimePrague(now()),
    firstAttempt: input.firstAttempt,
    verify: input.verify ? true : undefined,
  };
  const suffix = newBodyIdSuffix();
  const bodyId = `id-${suffix}`;

  let body: string;
  try {
    body = buildBody(header, input.data, bodyId);
  } catch (e) {
    throw new EetValidationError((e as Error).message);
  }
  const signed = signBody(body, bodyId, input.credentials.privateKeyPem, input.credentials.certDerB64, suffix);
  let xml = buildEnvelope(signed.securityHeader, body);
  if (input.tamperEnvelope) xml = input.tamperEnvelope(xml);

  const transport = await sendTrzba({
    env: input.env,
    xml,
    timeoutMs: input.timeoutMs,
    endpoint: input.endpoint,
    fetchImpl: input.fetchImpl,
  });
  const result = toEetResult(transport, header, input.env);
  const classification = classifyResult(result, input);
  const finishedAt = now();

  return {
    result,
    classification,
    nextRetryAt: classification === 'retryable' ? computeNextRetryAt(input.attemptNo ?? 1, finishedAt) : undefined,
    overdue: classification === 'retryable' && isOverdue(input.firstAttemptAt, finishedAt),
    message: resultMessage(result, !!input.verify),
    requestBytes: byteLength(xml),
    header,
  };
}

export function toEetResult(t: TransportResult, header: EetHeader, env: EetEnvironment): EetResult {
  const base = { uuid: header.uuid, sentAt: header.sentAt, firstAttempt: header.firstAttempt, ms: t.ms };
  if (t.kind === 'timeout') return { ...base, kind: 'timeout' };
  if (t.kind === 'network') return { ...base, kind: 'network', message: t.message };

  const extra = { ...base, httpStatus: t.status, xGlobalTransactionId: t.xGlobalTransactionId };
  const parsed = parseResponse(t.body, { expectedUuid: header.uuid, env });
  switch (parsed.type) {
    case 'potvrzeni':
      return {
        ...extra,
        kind: 'ok',
        pok: parsed.pok,
        test: parsed.test,
        receivedAt: parsed.receivedAt,
        warnings: parsed.warnings,
      };
    case 'chyba':
      return {
        ...extra,
        kind: 'error',
        code: parsed.code,
        text: parsed.text,
        test: parsed.test,
        rejectedAt: parsed.rejectedAt,
        warnings: parsed.warnings,
      };
    case 'fault':
      return { ...extra, kind: 'network', message: `HTTP ${t.status}, SOAP Fault ${parsed.faultcode}: ${parsed.faultstring}` };
    case 'invalid':
      return { ...extra, kind: 'network', message: `HTTP ${t.status}, ${parsed.reason}` };
  }
}
