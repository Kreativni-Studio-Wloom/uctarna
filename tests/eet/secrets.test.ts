import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, decryptString, encrypt, resolveMasterKey } from '@/lib/eet/secrets';
import { playgroundP12 } from './helpers';

const key = randomBytes(32);

describe('secrets (AES-256-GCM)', () => {
  const saved = process.env.EET_MASTER_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.EET_MASTER_KEY;
    else process.env.EET_MASTER_KEY = saved;
  });

  it('zašifruje a dešifruje .p12 i heslo', () => {
    const p12 = playgroundP12('CZ00000019');
    const enc = encrypt(p12, { key });
    expect(enc).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(Buffer.compare(decrypt(enc, { key }), p12)).toBe(0);
    expect(decryptString(encrypt('aaaa1111', { key }), { key })).toBe('aaaa1111');
  });

  it('každé šifrování má nové IV', () => {
    const a = encrypt('stejné', { key });
    const b = encrypt('stejné', { key });
    expect(a).not.toBe(b);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });

  it('klíč z EET_MASTER_KEY (base64)', () => {
    process.env.EET_MASTER_KEY = key.toString('base64');
    expect(decryptString(encrypt('tajné'), { key })).toBe('tajné');
    expect(decryptString(encrypt('tajné', { key }))).toBe('tajné');
  });

  it('klíč jako base64 řetězec v parametru', () => {
    expect(decryptString(encrypt('x', { key: key.toString('base64') }), { key })).toBe('x');
  });

  it('jiný klíč, jiné aad nebo změněná data → chyba', () => {
    const enc = encrypt('tajné', { key, aad: 'uid1/store1' });
    expect(decryptString(enc, { key, aad: 'uid1/store1' })).toBe('tajné');
    expect(() => decrypt(enc, { key: randomBytes(32), aad: 'uid1/store1' })).toThrow(/nejdou dešifrovat/);
    expect(() => decrypt(enc, { key, aad: 'uid1/store2' })).toThrow(/nejdou dešifrovat/);
    expect(() => decrypt(enc, { key })).toThrow(/nejdou dešifrovat/);
    const [v, iv, tag, ct] = enc.split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), { key, aad: 'uid1/store1' })).toThrow();
  });

  it('neplatný formát a klíč', () => {
    expect(() => decrypt('abc', { key })).toThrow(/formát/);
    expect(() => decrypt('v2.a.b.c', { key })).toThrow(/formát/);
    expect(() => decrypt('v1.AAAA.AAAA.AAAA', { key })).toThrow(/poškozená/);
    delete process.env.EET_MASTER_KEY;
    expect(() => resolveMasterKey()).toThrow(/chybí EET_MASTER_KEY/);
    expect(() => resolveMasterKey(randomBytes(16))).toThrow(/32 bajtů/);
    expect(() => resolveMasterKey(randomBytes(16).toString('base64'))).toThrow(/32 bajtů/);
  });
});
