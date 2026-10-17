import { adminDb } from '@/lib/firebase-admin';
import { renewDueCertificates } from '@/lib/eet/certRenew';
import { errorReply, reply, verifyCronSecret } from '@/lib/eet/http';

export const runtime = 'nodejs';
// EET (SPCSS, CZ): z výchozího regionu Vercelu (iad1, USA) spojení nenavázalo (UND_ERR_CONNECT_TIMEOUT), běžet v EU.
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/eet/cert-renew – denní kontrola certifikátů EET (Vercel Cron nebo jiný plánovač).
 * Chráněno `Authorization: Bearer ${CRON_SECRET}`. Jen prodejny se zapnutým EET a produkčním
 * certifikátem; obnova ≤ 21 dní před koncem platnosti (src/lib/eet/certRenew.ts).
 * Odpověď obsahuje jen výsledky (stav, počet dní), nikdy data z CA EET.
 */
export async function GET(request: Request) {
  try {
    verifyCronSecret(request);
    const r = await renewDueCertificates(adminDb);
    return reply({
      checked: r.checked,
      results: r.results.map(({ storeId, outcome, daysLeft, ...rest }) => ({
        storeId,
        outcome,
        daysLeft,
        ...('reason' in rest ? { reason: rest.reason } : {}),
        ...('message' in rest ? { message: rest.message } : {}),
      })),
    });
  } catch (e) {
    return errorReply(e, 'eet/cert-renew');
  }
}
