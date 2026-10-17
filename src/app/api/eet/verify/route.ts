import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { HttpError, ID_RE, paths } from '@/lib/eet/db';
import { errorReply, parseJson, reply, requireUser } from '@/lib/eet/http';
import { verifyConnection } from '@/lib/eet/verify';
import type { Store } from '@/types';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

const schema = z.object({ storeId: z.string().regex(ID_RE) });

/**
 * POST /api/eet/verify – ověření spojení (overeni=true, fiktivní tržba 1.00 Kč, nic se neeviduje
 * ani neukládá). Funguje i s vypnutým EET, aby šlo nastavení vyzkoušet před zapnutím.
 * Tělo: { storeId }. 200: { ok, classification, message, code?, ms, env }
 */
export async function POST(request: Request) {
  try {
    const uid = await requireUser(request);
    const { storeId } = await parseJson(request, schema);
    const snap = await adminDb.doc(paths.store(uid, storeId)).get();
    if (!snap.exists) throw new HttpError(404, 'store_not_found', 'Prodejna nenalezena');
    return reply(await verifyConnection(adminDb, uid, storeId, snap.data() as Pick<Store, 'eet'>));
  } catch (e) {
    return errorReply(e, 'eet/verify');
  }
}
