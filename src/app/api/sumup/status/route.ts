import { NextRequest, NextResponse } from 'next/server';
import { fetchSumUpPaymentState } from '@/lib/sumup-server';

/** GET /api/sumup/status?foreignTxId=… → { state: success|failed|pending|not_found|error, txCode } */
export async function GET(request: NextRequest) {
  const foreignTxId = request.nextUrl.searchParams.get('foreignTxId')?.trim();
  if (!foreignTxId || foreignTxId.length > 128) {
    return NextResponse.json({ error: 'Chybí parametr foreignTxId' }, { status: 400 });
  }
  try {
    const { state, txCode, error } = await fetchSumUpPaymentState(foreignTxId);
    if (error) console.warn('SumUp stav platby:', foreignTxId, state, error);
    // Detail chyby (obsahuje merchant code) jen do logu, ne do veřejné odpovědi.
    return NextResponse.json({ state, txCode }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('SumUp stav platby selhal:', error);
    return NextResponse.json(
      { state: 'error', txCode: null },
      { status: 500 }
    );
  }
}
