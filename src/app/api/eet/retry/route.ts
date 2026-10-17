import { adminDb } from '@/lib/firebase-admin';
import { errorReply, reply, verifyCronSecret } from '@/lib/eet/http';
import { retryDueAll } from '@/lib/eet/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/eet/retry – fronta EET pro všechny prodejny (Vercel Cron nebo jiný plánovač).
 * Chráněno `Authorization: Bearer ${CRON_SECRET}`. Dávka max. 50, souběžnost 5.
 * Cron v vercel.json zatím NENÍ (na tarifu Hobby by častý cron rozbil nasazení), rozhodne uživatel.
 */
export async function GET(request: Request) {
  try {
    verifyCronSecret(request);
    const r = await retryDueAll(adminDb);
    return reply(r);
  } catch (e) {
    return errorReply(e, 'eet/retry');
  }
}
