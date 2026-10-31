import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { HttpError, ID_RE, serializeEet } from '@/lib/eet/db';
import { errorReply, parseJson, reply, requireUser } from '@/lib/eet/http';
import { registerSale } from '@/lib/eet/register';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

const schema = z.object({ storeId: z.string().regex(ID_RE) });

/**
 * POST /api/eet/send/{saleId} – ruční „Odeslat znovu“ (i po trvalé chybě, např. po výměně certifikátu).
 * Tělo: { storeId }. 200: { outcome: 'sent'|'queued'|'failed_permanent'|'skipped', reason?, message?, receiptNo, eet }
 */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const uid = await requireUser(request);
    const { saleId } = await params;
    if (!ID_RE.test(saleId)) throw new HttpError(400, 'invalid_sale_id', 'Neplatné ID dokladu');
    const { storeId } = await parseJson(request, schema);
    const r = await registerSale(adminDb, uid, storeId, saleId, { mode: 'manual' });
    if (r.outcome === 'skipped' && r.reason === 'not_found') throw new HttpError(404, 'sale_not_found', 'Doklad nenalezen');
    return reply({
      outcome: r.outcome,
      reason: r.outcome === 'skipped' ? r.reason : undefined,
      message: r.outcome === 'skipped' ? undefined : r.message,
      receiptNo: r.receiptNo,
      eet: serializeEet(r.eet),
    });
  } catch (e) {
    return errorReply(e, 'eet/send');
  }
}
