import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Šifrování tajných dat EET (obsah .p12 a heslo) AES-256-GCM.
 * Formát: `v1.<iv>.<tag>.<ciphertext>` (base64url). Každá hodnota má vlastní náhodné IV,
 * takže .p12 a heslo se šifrují zvlášť a IV se nikdy neopakuje.
 * `aad` (např. `${uid}/${storeId}`) svazuje šifrovaný text s prodejnou: jinde se nedešifruje.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type MasterKey = Buffer | Uint8Array | string;

/** Klíč jako 32 B, nebo base64 řetězec 32 B; bez parametru z `EET_MASTER_KEY`. */
export function resolveMasterKey(key?: MasterKey): Buffer {
  const raw = key ?? process.env.EET_MASTER_KEY;
  if (raw === undefined || raw === '') throw new Error('EET: chybí EET_MASTER_KEY');
  const buf = typeof raw === 'string' ? Buffer.from(raw.trim(), 'base64') : Buffer.from(raw);
  if (buf.length !== 32) throw new Error('EET: EET_MASTER_KEY musí mít 32 bajtů (base64)');
  return buf;
}

export function encrypt(plaintext: Buffer | Uint8Array | string, opts: { key?: MasterKey; aad?: string } = {}): string {
  const key = resolveMasterKey(opts.key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  if (opts.aad) cipher.setAAD(Buffer.from(opts.aad, 'utf8'));
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/** Vrátí otevřená data; při změně dat, špatném klíči nebo jiném `aad` vyhodí chybu. */
export function decrypt(payload: string, opts: { key?: MasterKey; aad?: string } = {}): Buffer {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('EET: neznámý formát šifrovaných dat');
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('EET: poškozená šifrovaná data');
  const decipher = createDecipheriv('aes-256-gcm', resolveMasterKey(opts.key), iv, { authTagLength: TAG_BYTES });
  if (opts.aad) decipher.setAAD(Buffer.from(opts.aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]);
  } catch {
    throw new Error('EET: šifrovaná data nejdou dešifrovat (jiný klíč, prodejna nebo poškozená data)');
  }
}

export const decryptString = (payload: string, opts: { key?: MasterKey; aad?: string } = {}) =>
  decrypt(payload, opts).toString('utf8');
