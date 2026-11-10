import { z } from 'zod';
import { errorReply, parseJson, reply, requireUser, verifyCronSecret } from '@/lib/eet/http';
import { ID_RE } from '@/lib/eet/db';
import { reconcileAllPending, reconcilePendingPayment } from '@/lib/sumupRecord';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  storeId: z.string().regex(ID_RE),
  documentId: z.string().regex(ID_RE),
});

/**
 * POST /api/sumup/reconcile { storeId, documentId } – pokladna (přihlášený vlastník):
 * ověří rozpracovanou platbu u SumUp a uloží doklad, nebo ji zahodí.
 * → { state: saved | failed | pending | expired | unknown, result? }
 */
export async function POST(request: Request) {
  try {
    const uid = await requireUser(request);
    const { storeId, documentId } = await parseJson(request, Body);
    const r = await reconcilePendingPayment(uid, storeId, documentId, uid);
    return reply(r);
  } catch (e) {
    return errorReply(e, 'sumup/reconcile');
  }
}

/** GET – Vercel Cron (Authorization: Bearer CRON_SECRET): dořeší všechny rozpracované platby. */
export async function GET(request: Request) {
  try {
    verifyCronSecret(request);
    return reply(await reconcileAllPending());
  } catch (e) {
    return errorReply(e, 'sumup/reconcile-cron');
  }
}
