import 'server-only';
import { paths, type Db } from './db';
import { decrypt, decryptString, encrypt } from './secrets';
import { loadP12 } from './sign';
import type { EetCredentials } from './types';

/*
 * Pokladní certifikát prodejny: `users/{uid}/stores/{storeId}/private/eet`
 *   { p12Enc, passEnc, keyVersion, uploadedAt }
 * Každá hodnota má vlastní IV (secrets.ts), aad = `${uid}/${storeId}`.
 * Dešifrovaný klíč drží krátká in-memory cache (jen v rámci jedné instance serveru).
 */

export const CREDENTIALS_CACHE_MS = 5 * 60_000;
export const KEY_VERSION = 1;

export class EetCredentialsError extends Error {}

interface CacheEntry {
  creds: EetCredentials;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const cacheKey = (uid: string, storeId: string) => `${uid}/${storeId}`;
export const credentialsAad = cacheKey;

export function invalidateStoreCredentials(uid: string, storeId: string): void {
  cache.delete(cacheKey(uid, storeId));
}

/** Jen pro testy. */
export function clearCredentialsCache(): void {
  cache.clear();
}

export interface PrivateEetDoc {
  p12Enc: string;
  passEnc: string;
  keyVersion: number;
}

export function encryptCredentials(uid: string, storeId: string, p12: Buffer, password: string): PrivateEetDoc {
  const aad = credentialsAad(uid, storeId);
  return { p12Enc: encrypt(p12, { aad }), passEnc: encrypt(password, { aad }), keyVersion: KEY_VERSION };
}

export async function getStoreCredentials(
  db: Db,
  uid: string,
  storeId: string,
  now: () => number = Date.now
): Promise<EetCredentials> {
  const key = cacheKey(uid, storeId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now()) return hit.creds;

  const snap = await db.doc(paths.privateEet(uid, storeId)).get();
  if (!snap.exists) throw new EetCredentialsError('Prodejna nemá nahraný certifikát EET');
  const d = snap.data() as Partial<PrivateEetDoc>;
  if (typeof d.p12Enc !== 'string' || typeof d.passEnc !== 'string') {
    throw new EetCredentialsError('Uložený certifikát EET je poškozený, nahrajte ho znovu');
  }
  let creds: EetCredentials;
  try {
    const aad = credentialsAad(uid, storeId);
    creds = loadP12(decrypt(d.p12Enc, { aad }), decryptString(d.passEnc, { aad }));
  } catch (e) {
    throw new EetCredentialsError(`Certifikát EET nejde načíst: ${(e as Error).message}`);
  }
  cache.set(key, { creds, expiresAt: now() + CREDENTIALS_CACHE_MS });
  return creds;
}
