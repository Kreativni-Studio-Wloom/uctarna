import { NextRequest, NextResponse } from 'next/server';
import { fetchSumUpTerminalTip, getSumUpApiKey } from '@/lib/sumup-server';

/**
 * GET /api/sumup/transaction?txCode=XXXX&foreignTxId=...&sentAmount=30
 *
 * Debug / pomocná routa – načte detail transakce ze SumUp REST API
 * a vrátí spropitné z terminálu.
 */
export async function GET(request: NextRequest) {
  const txCode = request.nextUrl.searchParams.get('txCode')?.trim();
  const foreignTxId = request.nextUrl.searchParams.get('foreignTxId')?.trim();
  const sentAmountRaw = request.nextUrl.searchParams.get('sentAmount');
  const sentAmount = sentAmountRaw ? parseFloat(sentAmountRaw) : undefined;

  if (!txCode && !foreignTxId) {
    return NextResponse.json(
      { error: 'Chybí parametr txCode nebo foreignTxId' },
      { status: 400 }
    );
  }

  if (!getSumUpApiKey()) {
    return NextResponse.json(
      { error: 'SumUp API není nakonfigurováno (SUMUP_SECRET_API_KEY)' },
      { status: 503 }
    );
  }

  try {
    const result = await fetchSumUpTerminalTip(txCode, foreignTxId, sentAmount);

    return NextResponse.json({
      success: true,
      transactionCode: txCode || null,
      foreignTxId: foreignTxId || null,
      amount: result.transactionAmount,
      tipAmount: result.tipAmount,
      source: result.source,
      merchantCode: result.merchantCode,
    });
  } catch (error) {
    console.error('❌ Neočekávaná chyba při načítání SumUp transakce:', error);
    return NextResponse.json(
      {
        error: 'Interní chyba serveru',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
