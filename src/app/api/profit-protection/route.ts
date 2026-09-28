import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from '@/lib/firebase-admin';
import { hashProfitPin, matchesProfitPin, validProfitPin } from '@/lib/profit-pin';

export const runtime = 'nodejs';
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function authenticate(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  try { return await getAuth().verifyIdToken(token, true); } catch { return null; }
}

export async function GET(request: Request) {
  const user = await authenticate(request);
  if (!user) return reply({ error: 'Přihlaste se znovu.' }, 401);
  try {
    const doc = await adminDb.collection('profitProtection').doc(user.uid).get();
    return reply({ enabled: doc.data()?.enabled === true });
  } catch { return reply({ error: 'Ochranu zisku se nepodařilo načíst.' }, 503); }
}

export async function POST(request: Request) {
  const user = await authenticate(request);
  if (!user) return reply({ error: 'Přihlaste se znovu.' }, 401);
  try {
    const { action, pin } = await request.json();
    if (!['verify', 'enable', 'disable'].includes(action) || (action !== 'disable' && !validProfitPin(pin))) {
      return reply({ error: 'Zadejte čtyřmístný číselný PIN.' }, 400);
    }
    const ref = adminDb.collection('profitProtection').doc(user.uid);
    if (action !== 'verify') {
      // Správa vyžaduje čerstvé ověření účtu heslem, kontrolované na serveru.
      if (user.firebase.sign_in_provider !== 'password' || Date.now() / 1000 - user.auth_time > 60) {
        return reply({ error: 'Nejprve znovu potvrďte heslo účtu.' }, 403);
      }
      await ref.set(action === 'enable'
        ? { enabled: true, ...hashProfitPin(pin), attempts: 0, lockedUntil: 0 }
        : { enabled: false, attempts: 0, lockedUntil: 0 });
      return reply({ enabled: action === 'enable' });
    }
    // Počítadlo je sdílené mezi zařízeními; transakce brání souběžnému hádání PINu.
    const result = await adminDb.runTransaction(async transaction => {
      const data = (await transaction.get(ref)).data();
      if (!data?.enabled) return { ok: true };
      if (data.lockedUntil > Date.now()) return { error: 'Příliš mnoho pokusů. Zkuste to za 5 minut.', status: 429 };
      if (matchesProfitPin(pin, data.salt, data.hash)) {
        transaction.update(ref, { attempts: 0, lockedUntil: 0 });
        return { ok: true };
      }
      const attempts = (data.attempts || 0) + 1;
      transaction.update(ref, { attempts: attempts >= 5 ? 0 : attempts, lockedUntil: attempts >= 5 ? Date.now() + 300_000 : 0 });
      return { error: attempts >= 5 ? 'Příliš mnoho pokusů. Zkuste to za 5 minut.' : 'Nesprávný PIN.', status: attempts >= 5 ? 429 : 403 };
    });
    return reply(result, result.status ?? 200);
  } catch { return reply({ error: 'Ověření se nepodařilo. Zkuste to znovu.' }, 503); }
}
