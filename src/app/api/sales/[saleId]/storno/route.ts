import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { HttpError, ID_RE, serializeEet } from '@/lib/eet/db';
import { errorReply, parseJson, reply, requireUser } from '@/lib/eet/http';
import { stornoSale } from '@/lib/eet/storno';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

const schema = z.object({ storeId: z.string().regex(ID_RE) });

/**
 * POST /api/sales/{saleId}/storno – záporný doklad k {saleId} (nové číslo, aktuální čas).
 * Tělo: { storeId }. Jen při zapnutém EET; testovací doklad se nestornuje (maže se).
 * 200: { saleId (storna), receiptNo, duplicate, eet }
 */
export async function POST(request: Request, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const uid = await requireUser(request);
    const { saleId } = await params;
    if (!ID_RE.test(saleId)) throw new HttpError(400, 'invalid_sale_id', 'Neplatné ID dokladu');
    const { storeId } = await parseJson(request, schema);
    const r = await stornoSale(adminDb, uid, storeId, saleId);
    return reply({ saleId: r.saleId, receiptNo: r.receiptNo, duplicate: r.duplicate, eet: serializeEet(r.eet) });
  } catch (e) {
    return errorReply(e, 'sales/storno');
  }
}
