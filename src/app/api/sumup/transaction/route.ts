import { NextRequest, NextResponse } from 'next/server';

const SUMUP_API_BASE = 'https://api.sumup.com';
// SumUp potřebuje chvíli, než je transakce po platbě dohledatelná přes REST API,
// proto při 404 zkoušíme vícekrát s krátkou pauzou.
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 8000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTransactionFromSumUp(txCode: string, apiKey: string): Promise<Response> {
  const url = new URL(`${SUMUP_API_BASE}/v0.1/me/transactions`);
  url.searchParams.set('transaction_code', txCode);

  return fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
}

/**
 * GET /api/sumup/transaction?txCode=XXXX
 *
 * Načte detail transakce ze SumUp REST API a vrátí spropitné (tip_amount)
 * zadané zákazníkem v SumUp aplikaci/terminálu. Klient výsledek přičte
 * k dokladu před uložením do Firestore.
 */
export async function GET(request: NextRequest) {
  const txCode = request.nextUrl.searchParams.get('txCode')?.trim();

  if (!txCode) {
    return NextResponse.json({ error: 'Chybí parametr txCode' }, { status: 400 });
  }

  const apiKey = (process.env.SUMUP_SECRET_API_KEY || process.env.SUMUP_API_KEY)?.trim();
  if (!apiKey) {
    console.warn('⚠️ SUMUP_SECRET_API_KEY není nakonfigurován – spropitné ze SumUp nelze načíst');
    return NextResponse.json(
      { error: 'SumUp API není nakonfigurováno (SUMUP_SECRET_API_KEY)' },
      { status: 503 }
    );
  }

  try {
    let lastStatus = 0;
    let lastBody = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetchTransactionFromSumUp(txCode, apiKey);
      } catch (e) {
        // Timeout / síťová chyba – zkusíme znovu, pokud zbývají pokusy
        console.error(`❌ SumUp API pokus ${attempt}/${MAX_ATTEMPTS} selhal:`, e);
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        return NextResponse.json(
          { error: 'SumUp API neodpovídá', details: e instanceof Error ? e.message : String(e) },
          { status: 504 }
        );
      }

      if (response.ok) {
        const tx = await response.json();

        // tip_amount vrací SumUp přímo; fallback dopočet z amount_with_tip pro jistotu
        let tipAmount = 0;
        if (typeof tx.tip_amount === 'number' && tx.tip_amount > 0) {
          tipAmount = tx.tip_amount;
        } else if (
          typeof tx.amount_with_tip === 'number' &&
          typeof tx.amount === 'number' &&
          tx.amount_with_tip > tx.amount
        ) {
          tipAmount = tx.amount_with_tip - tx.amount;
        }

        console.log('✅ SumUp transakce načtena:', {
          txCode,
          status: tx.status,
          amount: tx.amount,
          tipAmount,
        });

        return NextResponse.json({
          success: true,
          transactionCode: tx.transaction_code || txCode,
          status: tx.status,
          amount: typeof tx.amount === 'number' ? tx.amount : null,
          currency: tx.currency || null,
          tipAmount,
        });
      }

      lastStatus = response.status;
      lastBody = await response.text().catch(() => '');

      // 404: transakce ještě nemusí být v SumUp propsaná – krátce počkáme a zkusíme znovu
      if (response.status === 404 && attempt < MAX_ATTEMPTS) {
        console.log(`⏳ SumUp transakce ${txCode} zatím nenalezena (pokus ${attempt}/${MAX_ATTEMPTS})`);
        await delay(RETRY_DELAY_MS);
        continue;
      }

      break;
    }

    console.error('❌ SumUp API vrátilo chybu:', lastStatus, lastBody);
    return NextResponse.json(
      { error: 'Nepodařilo se načíst transakci ze SumUp', sumupStatus: lastStatus },
      { status: lastStatus === 401 || lastStatus === 403 ? 502 : lastStatus || 502 }
    );
  } catch (error) {
    console.error('❌ Neočekávaná chyba při načítání SumUp transakce:', error);
    return NextResponse.json(
      { error: 'Interní chyba serveru', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
