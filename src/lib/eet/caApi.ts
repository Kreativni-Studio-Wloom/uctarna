import 'server-only';
import { createHash, sign as rsaSign } from 'node:crypto';
import type { EetCredentials } from './types';

/*
 * Klient API CA EET pro obnovu pokladního certifikátu (caeetapi_jwt.yml, OpenAPI 3.1, v1.0.0).
 * Běží od 1. 11. 2026. Autentizace: `Authorization: Bearer <JWT>`, JWS Compact RS256 podepsaný
 * OBNOVOVANÝM certifikátem (musí být v okamžiku volání platný), hlavička `x5t#S256` =
 * base64url(SHA-256(DER certifikátu)); `x5c` se neposílá. Payload {iat, exp} (min. je {}),
 * exp = iat + 240 s (plán: max. 5 min). Token se vyrábí pro každé volání znovu.
 *
 * Odpovědi `claim-download` obsahují PKCS#12 a heslo: NIKDY je nelogovat ani necachovat.
 * Chyby nesou jen stav HTTP a `code`/`message` z ErrorDTO.
 */

export const CA_API_URLS = {
  production: 'https://ca.caeet.gov.cz/api',
  /** Testovací a zkušební prostředí CA (ze specifikace), jen pro ruční zkoušky přes EET_CA_API_URL. */
  test: 'https://ca.test.caeet.gov.cz/api',
  zkus: 'https://ca.zkus.caeet.gov.cz/api',
} as const;

export const CA_JWT_TTL_SEC = 240;
export const CA_REQUEST_TIMEOUT_MS = 15_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CaRequestState = 'INPROCESS' | 'ISSUED' | 'DELIVERING' | 'FINISHED' | 'REJECTED';

export type CaRequestStatus =
  | { reqId: string; state: 'INPROCESS'; pollAfterSeconds: number }
  | { reqId: string; state: 'ISSUED' | 'DELIVERING' | 'FINISHED' }
  | { reqId: string; state: 'REJECTED'; rejectedReason: string };

export interface CaCertificateInfo {
  sn: string;
  validFrom: string;
  validTo: string;
  state: 'VALID' | 'EXPIRED' | 'REVOKED' | 'ON_CRL' | string;
}

/** Odpověď claim-download. Citlivé: pkcs12 (base64) + heslo. */
export interface CaPkcs12 {
  pkcs12: string;
  password: string;
  certificate: CaCertificateInfo;
}

export class CaApiError extends Error {
  constructor(
    readonly status: number,
    readonly caCode: number | undefined,
    message: string
  ) {
    super(message);
    this.name = 'CaApiError';
  }
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** `x5t#S256` = base64url(SHA-256(DER(X.509))). */
export function x5tS256(certDerB64: string): string {
  return b64url(createHash('sha256').update(Buffer.from(certDerB64, 'base64')).digest());
}

/** JWT pro CA API (RS256, RSASSA-PKCS1-v1_5 + SHA-256). */
export function buildCaJwt(creds: Pick<EetCredentials, 'privateKeyPem' | 'certDerB64'>, now: Date = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', 'x5t#S256': x5tS256(creds.certDerB64) };
  const payload = { iat, exp: iat + CA_JWT_TTL_SEC };
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const sig = rsaSign('sha256', Buffer.from(input), creds.privateKeyPem);
  return `${input}.${b64url(sig)}`;
}

export interface CaClientOptions {
  creds: Pick<EetCredentials, 'privateKeyPem' | 'certDerB64'>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface CaClient {
  renew(): Promise<{ reqId: string }>;
  status(reqId: string): Promise<CaRequestStatus>;
  claimDownload(reqId: string): Promise<CaPkcs12>;
  ackDownload(reqId: string): Promise<void>;
  notFinished(): Promise<string[]>;
}

/** Základní URL: EET_CA_API_URL (ruční zkouška proti test/zkus), jinak produkce. */
export function caApiBaseUrl(): string {
  return (process.env.EET_CA_API_URL || CA_API_URLS.production).replace(/\/+$/, '');
}

export function createCaClient(opts: CaClientOptions): CaClient {
  const base = (opts.baseUrl ?? caApiBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());

  const checkId = (reqId: string) => {
    if (!UUID_RE.test(reqId)) throw new CaApiError(0, undefined, 'CA EET: neplatné reqId');
    return encodeURIComponent(reqId);
  };

  async function call(method: 'GET' | 'POST', path: string, expect: number[]): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CA_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${buildCaJwt(opts.creds, now())}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      throw new CaApiError(0, undefined, aborted ? 'CA EET: vypršel časový limit' : 'CA EET: síťová chyba');
    } finally {
      clearTimeout(timer);
    }
    if (!expect.includes(res.status)) {
      // ErrorDTO {code, message, additionalInfo}; nic dalšího z odpovědi nepoužíváme.
      let caCode: number | undefined;
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { code?: unknown; message?: unknown };
        if (typeof body.code === 'number') caCode = body.code;
        if (typeof body.message === 'string') message = body.message.slice(0, 200);
      } catch {
        /* tělo není ErrorDTO */
      }
      throw new CaApiError(res.status, caCode, `CA EET: ${message}`);
    }
    return res;
  }

  async function json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new CaApiError(res.status, undefined, 'CA EET: neplatná odpověď');
    }
  }

  return {
    async renew() {
      const body = await json<{ reqId?: unknown }>(await call('POST', '/request/renew', [201]));
      if (typeof body.reqId !== 'string' || !UUID_RE.test(body.reqId)) throw new CaApiError(201, undefined, 'CA EET: odpověď bez reqId');
      return { reqId: body.reqId };
    },

    async status(reqId) {
      const res = await call('GET', `/request/${checkId(reqId)}/status`, [200]);
      const body = await json<Record<string, unknown>>(res);
      const state = body.state as CaRequestState;
      if (state === 'INPROCESS') {
        const header = Number(res.headers.get('Retry-After'));
        const poll = typeof body.pollAfterSeconds === 'number' ? body.pollAfterSeconds : header;
        return { reqId, state, pollAfterSeconds: Number.isFinite(poll) && poll >= 1 ? poll : 2 };
      }
      if (state === 'REJECTED') return { reqId, state, rejectedReason: String(body.rejectedReason ?? '').slice(0, 300) };
      if (state === 'ISSUED' || state === 'DELIVERING' || state === 'FINISHED') return { reqId, state };
      throw new CaApiError(200, undefined, 'CA EET: neznámý stav žádosti');
    },

    async claimDownload(reqId) {
      const body = await json<Partial<CaPkcs12>>(await call('POST', `/request/${checkId(reqId)}/claim-download`, [200]));
      if (typeof body.pkcs12 !== 'string' || typeof body.password !== 'string' || !body.certificate) {
        throw new CaApiError(200, undefined, 'CA EET: odpověď bez PKCS#12');
      }
      return { pkcs12: body.pkcs12, password: body.password, certificate: body.certificate as CaCertificateInfo };
    },

    async ackDownload(reqId) {
      await call('POST', `/request/${checkId(reqId)}/ack-download`, [204]);
    },

    async notFinished() {
      const body = await json<{ data?: unknown }>(await call('GET', '/request/not-finished', [200]));
      return Array.isArray(body.data) ? body.data.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)) : [];
    },
  };
}
