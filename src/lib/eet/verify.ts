import 'server-only';
import { sendTrzbaAttempt } from './attempt';
import { EetCredentialsError, getStoreCredentials } from './credentials';
import { HttpError, type Db } from './db';
import { resolveEetSettings } from './flags';
import { formatDateTimePrague, validateTrzbaData } from './format';
import type { EetTrzbaData } from './types';
import type { Store } from '@/types';

/** Ověřovací mód (overeni=true) s fiktivní tržbou 1.00 Kč. Nic se nezapisuje. */
export async function verifyConnection(
  db: Db,
  uid: string,
  storeId: string,
  store: Pick<Store, 'eet'>,
  opts: { fetchImpl?: typeof fetch; endpoint?: string; now?: () => Date } = {}
) {
  const settings = resolveEetSettings(store.eet);
  const now = opts.now ?? (() => new Date());
  const data: EetTrzbaData = {
    eic: settings.eic,
    unitId: settings.unitId,
    registerId: settings.registerId,
    porad_cis: 'OVERENI-1',
    dat_trzby: formatDateTimePrague(now()),
    celk_trzba: '1.00',
  };
  const problems = validateTrzbaData(data);
  if (problems.length) throw new HttpError(400, 'invalid_settings', `Neplatné nastavení EET: ${problems.join('; ')}`);
  let credentials;
  try {
    credentials = await getStoreCredentials(db, uid, storeId);
  } catch (e) {
    if (e instanceof EetCredentialsError) throw new HttpError(400, 'no_certificate', e.message);
    throw e;
  }
  const a = await sendTrzbaAttempt({
    env: settings.environment,
    credentials,
    data,
    firstAttempt: true,
    verify: true,
    timeoutMs: settings.sendTimeoutMs,
    now,
    fetchImpl: opts.fetchImpl,
    endpoint: opts.endpoint,
  });
  return {
    ok: a.classification === 'ok',
    classification: a.classification,
    message: a.message,
    code: a.result.kind === 'error' ? a.result.code : undefined,
    ms: a.result.ms,
    env: settings.environment,
  };
}
