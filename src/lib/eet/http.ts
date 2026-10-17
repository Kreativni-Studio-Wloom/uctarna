import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { ZodError, type ZodType } from 'zod';
import { HttpError } from './db';

/* Společné pro API routy EET: ověření Firebase ID tokenu, CRON_SECRET, odpovědi a chyby. */

export const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** uid z `Authorization: Bearer <Firebase ID token>`, jinak null. */
export async function authenticate(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  try {
    return (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

export async function requireUser(request: Request): Promise<string> {
  const uid = await authenticate(request);
  if (!uid) throw new HttpError(401, 'unauthorized', 'Přihlaste se znovu');
  return uid;
}

/** Vercel Cron posílá `Authorization: Bearer ${CRON_SECRET}`. */
export function verifyCronSecret(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'cron_not_configured', 'Chybí CRON_SECRET');
  const got = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'unauthorized', 'Neplatný CRON_SECRET');
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Neplatné JSON tělo požadavku');
  }
  return schema.parse(body);
}

export function errorReply(e: unknown, context: string) {
  if (e instanceof HttpError) return reply({ error: e.message, code: e.code }, e.status);
  if (e instanceof ZodError) {
    return reply({ error: 'Neplatná data požadavku', code: 'invalid_input', issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
  }
  console.error(`EET ${context}:`, e);
  return reply({ error: 'Interní chyba serveru', code: 'internal' }, 500);
}
