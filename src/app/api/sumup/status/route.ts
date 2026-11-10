import { NextRequest, NextResponse } from 'next/server';
import { fetchSumUpPaymentState } from '@/lib/sumup-server';

/** GET /api/sumup/status?foreignTxId=… → { state: success|failed|pending|not_found|error, txCode } */
export async function GET(request: NextRequest) {
  const foreignTxId = request.nextUrl.searchParams.get('foreignTxId')?.trim();
  if (!foreignTxId || foreignTxId.length > 128) {
    return NextResponse.json({ error: 'Chybí parametr foreignTxId' }, { status: 400 });
  }
  try {
    const result = await fetchSumUpPaymentState(foreignTxId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { state: 'error', txCode: null, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
