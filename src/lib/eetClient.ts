// Klientská volání EET rout (prohlížeč). Používá se JEN u prodejny se zapnutým EET.
// Fáze D sem napojí UI (okno výsledku, Odeslat znovu, Stornovat, nastavení certifikátu).

import { auth } from '@/lib/firebase';
import type { SaleEet } from '@/types';

/** ID token přihlášeného uživatele; v čerstvě otevřeném tabu počká na obnovení přihlášení. */
export async function getIdTokenOrNull(timeoutMs = 5000, forceRefresh = false): Promise<string | null> {
  try {
    if (!auth.currentUser) {
      await Promise.race([auth.authStateReady(), new Promise((r) => setTimeout(r, timeoutMs))]);
    }
    return (await auth.currentUser?.getIdToken(forceRefresh)) ?? null;
  } catch {
    return null;
  }
}

export async function eetAuthHeaders(): Promise<Record<string, string>> {
  const token = await getIdTokenOrNull();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class EetApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const doFetch = async (forceRefresh: boolean) => {
    const token = await getIdTokenOrNull(5000, forceRefresh);
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      cache: 'no-store',
    });
  };
  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true);
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new EetApiError(res.status, body.code ?? 'http_error', body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** `sale.eet` z odpovědi API (časy jako ISO řetězce). */
export type SaleEetJson = Omit<SaleEet, 'nextRetryAt' | 'firstAttemptAt' | 'lockUntil'> & {
  nextRetryAt?: string | null;
  firstAttemptAt?: string;
  lockUntil?: string | null;
};

export interface FinalizeResponse {
  saleId: string;
  receiptNo?: string;
  duplicate: boolean;
  eet?: SaleEetJson;
}

export interface FinalizeRequest {
  storeId: string;
  documentId: string;
  sale: object;
  isTest?: boolean;
  eetSend?: boolean;
  nonEvidenceReason?: string;
}

export const finalizeSaleRequest = (body: FinalizeRequest) =>
  call<FinalizeResponse>('/api/sales/finalize', { method: 'POST', json: body });

export interface SendResponse {
  outcome: 'sent' | 'queued' | 'failed_permanent' | 'skipped';
  reason?: string;
  message?: string;
  receiptNo?: string;
  eet?: SaleEetJson;
}

export const sendSaleToEet = (storeId: string, saleId: string) =>
  call<SendResponse>(`/api/eet/send/${encodeURIComponent(saleId)}`, { method: 'POST', json: { storeId } });

export const stornoSaleRequest = (storeId: string, saleId: string) =>
  call<FinalizeResponse>(`/api/sales/${encodeURIComponent(saleId)}/storno`, { method: 'POST', json: { storeId } });

export const retryMyEetQueue = (storeId: string) =>
  call<{ checked: number; results: { saleId: string; outcome: string; reason?: string }[] }>('/api/eet/retry-mine', {
    method: 'POST',
    json: { storeId },
  });

export const verifyEetConnection = (storeId: string) =>
  call<{ ok: boolean; classification: string; message: string; code?: number; ms: number; env: string; region?: string | null }>('/api/eet/verify', {
    method: 'POST',
    json: { storeId },
  });

export function uploadEetCertificate(p: { storeId: string; file: Blob; password: string; eic?: string; environment?: 'playground' | 'production' }) {
  const form = new FormData();
  form.set('storeId', p.storeId);
  form.set('file', p.file);
  form.set('password', p.password);
  if (p.eic) form.set('eic', p.eic);
  if (p.environment) form.set('environment', p.environment);
  return call<{ certificate: { subjectEic: string; serial: string; validFrom: string; validTo: string; uploadedAt: string; env: string } }>(
    '/api/eet/certificate',
    { method: 'POST', body: form }
  );
}

export const deleteEetCertificate = (storeId: string) =>
  call<{ deleted: true }>('/api/eet/certificate', { method: 'DELETE', json: { storeId } });
