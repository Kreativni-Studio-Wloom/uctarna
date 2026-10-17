import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { checkCertificate } from '@/lib/eet/certificate';
import { encryptCredentials, invalidateStoreCredentials } from '@/lib/eet/credentials';
import { HttpError, ID_RE, paths, ts } from '@/lib/eet/db';
import { resolveEetSettings } from '@/lib/eet/flags';
import { errorReply, reply, requireUser, parseJson } from '@/lib/eet/http';
import { loadP12 } from '@/lib/eet/sign';
import type { Store } from '@/types';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_P12_BYTES = 64 * 1024;

/**
 * POST /api/eet/certificate (multipart/form-data): storeId, file (.p12), password,
 *   volitelně eic a environment ('playground'|'production'), pokud ještě nejsou v nastavení prodejny.
 * Kontroly: heslo, CN = EIČ, platnost, prostředí podle OID politiky. Tajná data šifrovaně
 * do `private/eet`, metadata do `store.eet.certificate`. EET se tím NEZAPÍNÁ.
 * 200: { certificate: { subjectEic, serial, validFrom, validTo, env } }
 */
export async function POST(request: Request) {
  try {
    const uid = await requireUser(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'invalid_form', 'Očekává se multipart/form-data');
    }
    const storeId = String(form.get('storeId') ?? '');
    const password = String(form.get('password') ?? '');
    const file = form.get('file');
    if (!ID_RE.test(storeId)) throw new HttpError(400, 'invalid_store', 'Chybí prodejna');
    if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, 'no_file', 'Chybí soubor .p12');
    if (file.size > MAX_P12_BYTES) throw new HttpError(400, 'file_too_large', 'Soubor je příliš velký');
    if (!password) throw new HttpError(400, 'no_password', 'Chybí heslo k certifikátu');

    const storeRef = adminDb.doc(paths.store(uid, storeId));
    const snap = await storeRef.get();
    if (!snap.exists) throw new HttpError(404, 'store_not_found', 'Prodejna nenalezena');
    const settings = resolveEetSettings((snap.data() as Pick<Store, 'eet'>).eet);
    const formEnv = form.get('environment');
    const environment = formEnv === 'production' || formEnv === 'playground' ? formEnv : settings.environment;
    const eic = settings.eic || String(form.get('eic') ?? '').trim().toUpperCase();

    const p12 = Buffer.from(await file.arrayBuffer());
    let creds;
    try {
      creds = loadP12(p12, password);
    } catch (e) {
      throw new HttpError(400, 'invalid_p12', (e as Error).message);
    }
    const now = new Date();
    const { problems, env } = checkCertificate({ creds, eic, environment, now });
    if (problems.length || !env) throw new HttpError(400, 'certificate_rejected', problems.join('; '));

    const certificate = {
      subjectEic: creds.subjectCN.toUpperCase(),
      serial: creds.serial,
      validFrom: ts(creds.notBefore),
      validTo: ts(creds.notAfter),
      uploadedAt: ts(now),
      env,
    };
    await adminDb.doc(paths.privateEet(uid, storeId)).set({ ...encryptCredentials(uid, storeId, p12, password), uploadedAt: ts(now) });
    await storeRef.update({ 'eet.certificate': certificate });
    invalidateStoreCredentials(uid, storeId);
    return reply({
      certificate: { ...certificate, validFrom: creds.notBefore.toISOString(), validTo: creds.notAfter.toISOString(), uploadedAt: now.toISOString() },
    });
  } catch (e) {
    return errorReply(e, 'eet/certificate POST');
  }
}

/** DELETE /api/eet/certificate – tělo { storeId }: smaže tajná data i metadata. */
export async function DELETE(request: Request) {
  try {
    const uid = await requireUser(request);
    const { storeId } = await parseJson(request, z.object({ storeId: z.string().regex(ID_RE) }));
    const storeRef = adminDb.doc(paths.store(uid, storeId));
    const snap = await storeRef.get();
    if (!snap.exists) throw new HttpError(404, 'store_not_found', 'Prodejna nenalezena');
    await adminDb.doc(paths.privateEet(uid, storeId)).delete();
    await storeRef.update({ 'eet.certificate': FieldValue.delete() });
    invalidateStoreCredentials(uid, storeId);
    return reply({ deleted: true });
  } catch (e) {
    return errorReply(e, 'eet/certificate DELETE');
  }
}
