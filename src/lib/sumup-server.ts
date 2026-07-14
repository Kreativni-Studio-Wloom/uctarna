const SUMUP_API_BASE = 'https://api.sumup.com';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 10000;

let cachedMerchantCode: string | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Vypadá jako SumUp API klíč (sup_sk_…), ne OAuth client secret. */
function looksLikeSumUpApiKey(value: string): boolean {
  return /^sup_(sk|pk)_/i.test(value);
}

export function getSumUpApiKey(): string | null {
  const candidates = [
    process.env.SUMUP_SECRET_API_KEY,
    process.env.SUMUP_API_KEY,
    process.env.SUMUP_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_SUMUP_ACCESS_TOKEN,
  ];
  for (const c of candidates) {
    const trimmed = c?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function getOAuthClientId(): string | null {
  return (
    process.env.SUMUP_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_SUMUP_APP_ID?.trim() ||
    null
  );
}

function getOAuthClientSecret(): string | null {
  return process.env.SUMUP_SECRET_API_KEY?.trim() || null;
}

/**
 * Vrátí Bearer token pro SumUp API: přímo API klíč, access token z env,
 * nebo token z OAuth client_credentials (client_id + client_secret).
 */
export async function getSumUpAccessToken(): Promise<{
  token: string | null;
  source: 'api_key' | 'access_token_env' | 'oauth' | 'none';
  error?: string;
}> {
  const apiKey = getSumUpApiKey();
  if (apiKey && looksLikeSumUpApiKey(apiKey)) {
    return { token: apiKey, source: 'api_key' };
  }

  if (apiKey && !looksLikeSumUpApiKey(apiKey)) {
    // Hodnota v env není sup_sk_ – zkusíme ji jako hotový access token
    return { token: apiKey, source: 'access_token_env' };
  }

  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  if (!clientId || !clientSecret) {
    return { token: null, source: 'none', error: 'Chybí SumUp API klíč nebo OAuth credentials' };
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedAccessToken.token, source: 'oauth' };
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'transactions.history transactions.read user.profile',
    });

    const response = await fetch(`${SUMUP_API_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        token: null,
        source: 'none',
        error: `OAuth token selhal (${response.status}): ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return { token: null, source: 'none', error: 'OAuth odpověď bez access_token' };
    }

    cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return { token: data.access_token, source: 'oauth' };
  } catch (error) {
    return {
      token: null,
      source: 'none',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseSumUpNumeric(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function extractTipFromTransaction(
  tx: Record<string, unknown>,
  sentAmount?: number
): number {
  const tipFromField = parseSumUpNumeric(tx.tip_amount);
  if (tipFromField !== null && tipFromField > 0) {
    return roundMoney(tipFromField);
  }

  const txAmount = parseSumUpNumeric(tx.amount);
  if (txAmount !== null && typeof sentAmount === 'number' && sentAmount > 0) {
    const diff = txAmount - sentAmount;
    if (diff > 0.001) return roundMoney(diff);
  }

  const amountWithTip = parseSumUpNumeric(tx.amount_with_tip);
  const baseAmount = parseSumUpNumeric(tx.amount);
  if (
    amountWithTip !== null &&
    baseAmount !== null &&
    amountWithTip > baseAmount + 0.001
  ) {
    return roundMoney(amountWithTip - baseAmount);
  }

  return 0;
}

async function sumUpFetch(path: string, token: string): Promise<Response> {
  return fetch(`${SUMUP_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function resolveMerchantCodeFromMemberships(token: string): Promise<string | null> {
  try {
    const response = await sumUpFetch('/v0.1/memberships?limit=5', token);
    if (!response.ok) return null;
    const data = (await response.json()) as { items?: Array<{ resource?: Record<string, unknown> }> };
    for (const item of data.items ?? []) {
      const resource = item.resource;
      if (!resource) continue;
      const code =
        (typeof resource.merchant_code === 'string' ? resource.merchant_code : null) ||
        (typeof resource.id === 'string' && /^M[A-Z0-9]+$/i.test(resource.id) ? resource.id : null);
      if (code) return code;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function resolveMerchantCode(token: string): Promise<string | null> {
  const fromEnv = process.env.SUMUP_MERCHANT_CODE?.trim();
  if (fromEnv) return fromEnv;
  if (cachedMerchantCode) return cachedMerchantCode;

  try {
    const response = await sumUpFetch('/v0.1/me', token);
    if (response.ok) {
      const me = (await response.json()) as Record<string, unknown>;
      const profile = me.merchant_profile as Record<string, unknown> | undefined;
      const account = me.account as Record<string, unknown> | undefined;
      const code =
        (typeof profile?.merchant_code === 'string' ? profile.merchant_code : null) ||
        (typeof account?.merchant_code === 'string' ? account.merchant_code : null) ||
        (typeof me.merchant_code === 'string' ? me.merchant_code : null);
      if (code) {
        cachedMerchantCode = code;
        return code;
      }
    } else {
      console.warn('⚠️ SumUp /v0.1/me:', response.status, await response.text().catch(() => ''));
    }
  } catch (error) {
    console.warn('⚠️ SumUp /v0.1/me selhalo:', error);
  }

  const fromMemberships = await resolveMerchantCodeFromMemberships(token);
  if (fromMemberships) {
    cachedMerchantCode = fromMemberships;
    return fromMemberships;
  }

  return null;
}

function normalizeTransactionPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items) && obj.items.length > 0) {
    const first = obj.items[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  }
  if (typeof obj.transaction_code === 'string' || typeof obj.id === 'string') {
    return obj;
  }
  return null;
}

async function fetchTransactionByQuery(
  token: string,
  merchantCode: string,
  query: Record<string, string>
): Promise<{ tx: Record<string, unknown> | null; lastError?: string }> {
  const params = new URLSearchParams(query);
  const paths = [
    `/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions?${params}`,
    `/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions/history?${params}&limit=1`,
  ];

  let lastError: string | undefined;

  for (const path of paths) {
    const response = await sumUpFetch(path, token);
    if (response.ok) {
      const data = await response.json();
      const tx = normalizeTransactionPayload(data);
      if (tx) return { tx };
      lastError = `Prázdná odpověď z ${path}`;
      continue;
    }
    const body = await response.text().catch(() => '');
    lastError = `${path} → ${response.status}: ${body.slice(0, 300)}`;
    console.warn('⚠️ SumUp fetch:', lastError);
  }

  return { tx: null, lastError };
}

export type SumUpTipLookup = {
  tipAmount: number;
  transactionAmount: number | null;
  merchantCode: string | null;
  source: 'tip_amount' | 'amount_diff' | 'none';
  authSource?: string;
  debugError?: string;
};

export async function fetchSumUpTerminalTip(
  txCode: string | null | undefined,
  foreignTxId: string | null | undefined,
  sentAmount?: number
): Promise<SumUpTipLookup> {
  const empty: SumUpTipLookup = {
    tipAmount: 0,
    transactionAmount: null,
    merchantCode: null,
    source: 'none',
  };

  if (!txCode && !foreignTxId) {
    return { ...empty, debugError: 'Chybí txCode i foreignTxId' };
  }

  const auth = await getSumUpAccessToken();
  if (!auth.token) {
    console.warn('⚠️ SumUp auth selhala:', auth.error);
    return { ...empty, debugError: auth.error ?? 'SumUp API klíč není nakonfigurován' };
  }

  const merchantCode = await resolveMerchantCode(auth.token);
  if (!merchantCode) {
    return {
      ...empty,
      authSource: auth.source,
      debugError: 'Nelze zjistit merchant_code – nastavte SUMUP_MERCHANT_CODE ve Vercelu',
    };
  }

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let tx: Record<string, unknown> | null = null;

      if (txCode) {
        const result = await fetchTransactionByQuery(auth.token, merchantCode, {
          transaction_code: txCode,
        });
        tx = result.tx;
        lastError = result.lastError;
      }
      if (!tx && foreignTxId) {
        const result = await fetchTransactionByQuery(auth.token, merchantCode, {
          foreign_transaction_id: foreignTxId,
        });
        tx = result.tx;
        lastError = result.lastError;
      }

      if (tx) {
        const tipFromField = parseSumUpNumeric(tx.tip_amount);
        const tipAmount = extractTipFromTransaction(tx, sentAmount);
        const transactionAmount = parseSumUpNumeric(tx.amount);

        let source: SumUpTipLookup['source'] = 'none';
        if (tipFromField !== null && tipFromField > 0) source = 'tip_amount';
        else if (tipAmount > 0) source = 'amount_diff';

        console.log('✅ SumUp transakce načtena:', {
          txCode,
          foreignTxId,
          sentAmount,
          transactionAmount,
          tipAmount,
          source,
          authSource: auth.source,
        });

        return {
          tipAmount,
          transactionAmount,
          merchantCode,
          source,
          authSource: auth.source,
        };
      }

      if (attempt < MAX_ATTEMPTS) {
        console.log(
          `⏳ SumUp transakce zatím nenalezena (pokus ${attempt}/${MAX_ATTEMPTS})`
        );
        await delay(RETRY_DELAY_MS);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`❌ SumUp API pokus ${attempt}/${MAX_ATTEMPTS}:`, error);
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }
  }

  console.warn('⚠️ SumUp transakci se nepodařilo načíst:', lastError);
  return {
    ...empty,
    merchantCode,
    authSource: auth.source,
    debugError: lastError ?? 'Transakce nenalezena v SumUp API',
  };
}

/** Diagnostika SumUp připojení – pro /api/sumup/debug */
export async function diagnoseSumUpConnection(): Promise<Record<string, unknown>> {
  const rawKey = getSumUpApiKey();
  const auth = await getSumUpAccessToken();

  const result: Record<string, unknown> = {
    hasCredentials: !!rawKey || !!(getOAuthClientId() && getOAuthClientSecret()),
    keyPreview: rawKey ? maskSecret(rawKey) : null,
    looksLikeApiKey: rawKey ? looksLikeSumUpApiKey(rawKey) : false,
    authSource: auth.source,
    authOk: !!auth.token,
    authError: auth.error ?? null,
    merchantCodeEnv: process.env.SUMUP_MERCHANT_CODE?.trim() || null,
  };

  if (!auth.token) return result;

  try {
    const meRes = await sumUpFetch('/v0.1/me', auth.token);
    result.meStatus = meRes.status;
    if (meRes.ok) {
      const me = await meRes.json();
      result.meEmail = (me as Record<string, unknown>).email ?? null;
    } else {
      result.meError = (await meRes.text()).slice(0, 200);
    }
  } catch (e) {
    result.meError = e instanceof Error ? e.message : String(e);
  }

  const merchantCode = await resolveMerchantCode(auth.token);
  result.merchantCode = merchantCode;

  return result;
}
