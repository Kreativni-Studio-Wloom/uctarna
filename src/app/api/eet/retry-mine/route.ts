import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { ID_RE } from '@/lib/eet/db';
import { errorReply, parseJson, reply, requireUser } from '@/lib/eet/http';
import { retryDueForStore } from '@/lib/eet/queue';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

const schema = z.object({ storeId: z.string().regex(ID_RE) });

/**
 * POST /api/eet/retry-mine – opakování fronty jedné prodejny přihlášeného uživatele (spouští POS).
 * Tělo: { storeId }. Max. 10 dokladů na volání. 200: { checked, results: [{saleId, outcome, reason?}] }
 */
export async function POST(request: Request) {
  try {
    const uid = await requireUser(request);
    const { storeId } = await parseJson(request, schema);
    return reply(await retryDueForStore(adminDb, uid, storeId));
  } catch (e) {
    return errorReply(e, 'eet/retry-mine');
  }
}
