import { NextRequest, NextResponse } from 'next/server';
import { diagnoseSumUpConnection, fetchSumUpTerminalTip } from '@/lib/sumup-server';

/**
 * GET /api/sumup/debug
 * GET /api/sumup/debug?txCode=XXX&sentAmount=30
 *
 * Diagnostika SumUp API – ověří klíč, merchant_code a volitelně načte tip z transakce.
 */
export async function GET(request: NextRequest) {
  const txCode = request.nextUrl.searchParams.get('txCode')?.trim();
  const foreignTxId = request.nextUrl.searchParams.get('foreignTxId')?.trim();
  const sentAmountRaw = request.nextUrl.searchParams.get('sentAmount');
  const sentAmount = sentAmountRaw ? parseFloat(sentAmountRaw) : undefined;

  const connection = await diagnoseSumUpConnection();

  if (!txCode && !foreignTxId) {
    return NextResponse.json({
      ...connection,
      hint: 'Přidej ?txCode=KÓD_Z_PLATBY&sentAmount=30 pro test načtení spropitného z konkrétní transakce.',
    });
  }

  const tipLookup = await fetchSumUpTerminalTip(
    txCode,
    foreignTxId,
    Number.isFinite(sentAmount) ? sentAmount : undefined
  );

  return NextResponse.json({
    ...connection,
    txCode: txCode ?? null,
    foreignTxId: foreignTxId ?? null,
    sentAmount: sentAmount ?? null,
    tipLookup,
  });
}
