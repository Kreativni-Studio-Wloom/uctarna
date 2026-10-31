import { adminDb } from '@/lib/firebase-admin';
import { serializeEet } from '@/lib/eet/db';
import { finalizeInputSchema, finalizeSale } from '@/lib/eet/finalize';
import { errorReply, parseJson, reply, requireUser } from '@/lib/eet/http';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

/**
 * POST /api/sales/finalize – uložení prodeje u prodejny se zapnutým EET.
 * Tělo: { storeId, documentId, sale: <draft jako dnešní addDoc>, isTest?, eetSend?, nonEvidenceReason? }
 * 200: { saleId, receiptNo, duplicate, eet }   409 eet_disabled: klient uloží postaru (addDoc).
 * Idempotentní podle documentId (doc id dokladu): opakované volání vrátí uložený doklad.
 */
export async function POST(request: Request) {
  try {
    const uid = await requireUser(request);
    const input = await parseJson(request, finalizeInputSchema);
    const r = await finalizeSale(adminDb, uid, input);
    return reply({ saleId: r.saleId, receiptNo: r.receiptNo, duplicate: r.duplicate, eet: serializeEet(r.eet) });
  } catch (e) {
    return errorReply(e, 'sales/finalize');
  }
}
