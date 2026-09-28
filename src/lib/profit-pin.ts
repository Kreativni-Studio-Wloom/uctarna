import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const validProfitPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4}$/.test(pin);
export function hashProfitPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(pin, salt, 32).toString('hex') };
}
export function matchesProfitPin(pin: string, salt: string, hash: string) {
  const expected = Buffer.from(hash, 'hex');
  return expected.length === 32 && timingSafeEqual(scryptSync(pin, salt, 32), expected);
}
