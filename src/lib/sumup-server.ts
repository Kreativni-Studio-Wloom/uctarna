const SUMUP_API_BASE = 'https://api.sumup.com';

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 10000;

let cachedMerchantCode: string | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getSumUpApiKey(): string | null {
  const key = (
    process.env.SUMUP_SECRET_API_KEY ||
    process.env.SUMUP_API_KEY ||
    process.env.SUMUP_ACCESS_TOKEN ||
    ''
  ).trim();
  return key || null;
}

export function parseSumUpNumeric(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Spropitné z terminálu: primárně tip_amount ze SumUp API,
 * fallback rozdíl mezi skutečně zaplacenou částkou a částkou poslanou z Účtárny.
 */
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

async function sumUpFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${SUMUP_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function resolveMerchantCode(apiKey: string): Promise<string | null> {
  const fromEnv = process.env.SUMUP_MERCHANT_CODE?.trim();
  if (fromEnv) return fromEnv;
  if (cachedMerchantCode) return cachedMerchantCode;

  try {
    const response = await sumUpFetch('/v0.1/me', apiKey);
    if (!response.ok) {
      console.warn('⚠️ SumUp /v0.1/me selhalo:', response.status);
      return null;
    }
    const me = (await response.json()) as Record<string, unknown>;
    const profile = me.merchant_profile as Record<string, unknown> | undefined;
    const code =
      (typeof profile?.merchant_code === 'string' ? profile.merchant_code : null) ||
      (typeof me.merchant_code === 'string' ? me.merchant_code : null);
    if (code) cachedMerchantCode = code;
    return code;
  } catch (error) {
    console.warn('⚠️ SumUp merchant_code nelze načíst:', error);
    return null;
  }
}

function normalizeTransactionPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items) && obj.items.length > 0) {
    const first = obj.items[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  }
  return obj;
}

async function fetchTransactionByQuery(
  apiKey: string,
  merchantCode: string,
  query: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams(query);
  const paths = [
    `/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions?${params}`,
    `/v2.1/merchants/${encodeURIComponent(merchantCode)}/transactions/history?${params}&limit=1`,
  ];

  for (const path of paths) {
    const response = await sumUpFetch(path, apiKey);
    if (!response.ok) continue;
    const data = await response.json();
    const tx = normalizeTransactionPayload(data);
    if (tx) return tx;
  }

  return null;
}

export type SumUpTipLookup = {
  tipAmount: number;
  transactionAmount: number | null;
  merchantCode: string | null;
  source: 'tip_amount' | 'amount_diff' | 'none';
};

/**
 * Načte spropitné zadané na SumUp terminálu pro danou transakci.
 * Vrací 0 při jakémkoli selhání – doklad se má uložit vždy.
 */
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

  const apiKey = getSumUpApiKey();
  if (!apiKey || (!txCode && !foreignTxId)) {
    if (!apiKey) console.warn('⚠️ SumUp API klíč není nakonfigurován');
    return empty;
  }

  const merchantCode = await resolveMerchantCode(apiKey);
  if (!merchantCode) return empty;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let tx: Record<string, unknown> | null = null;

      if (txCode) {
        tx = await fetchTransactionByQuery(apiKey, merchantCode, {
          transaction_code: txCode,
        });
      }
      if (!tx && foreignTxId) {
        tx = await fetchTransactionByQuery(apiKey, merchantCode, {
          foreign_transaction_id: foreignTxId,
        });
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
        });

        return {
          tipAmount,
          transactionAmount,
          merchantCode,
          source,
        };
      }

      if (attempt < MAX_ATTEMPTS) {
        console.log(
          `⏳ SumUp transakce zatím nenalezena (pokus ${attempt}/${MAX_ATTEMPTS}), čekám…`
        );
        await delay(RETRY_DELAY_MS);
      }
    } catch (error) {
      console.error(`❌ SumUp API pokus ${attempt}/${MAX_ATTEMPTS}:`, error);
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
    }
  }

  console.warn('⚠️ SumUp transakci se nepodařilo načíst – spropitné z terminálu bude 0');
  return { ...empty, merchantCode };
}
