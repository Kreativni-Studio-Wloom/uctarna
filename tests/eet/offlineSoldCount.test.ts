// soldCount u offline zálohy (eetCheckout) se nesmí přičíst dvakrát: ani po ztracené odpovědi
// finalize (server už uložil a přičetl), ani při opakované záloze. Přičítá ho server jednou při očíslování.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeInputSchema, finalizeSale } from '@/lib/eet/finalize';
import { registerSale } from '@/lib/eet/register';
import type { MockFirestore } from './firestoreMock';
import { STORE, STORE_PATH, UID, cartItem, cashDraft, eetFetch, loadCredentials, okBody, salePath, setup } from './fixturesC';

const h = vi.hoisted(() => ({
  mock: null as MockFirestore | null,
  /** true = nová firestore.rules: offline záloha přes doklad s receiptNo se odmítne */
  rules: false,
  updateDoc: vi.fn(async () => undefined),
  finalize: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  serverTimestamp: () => new Date('2026-10-17T10:00:00Z'),
  increment: (n: number) => ({ increment: n }),
  updateDoc: h.updateDoc,
  setDoc: async (path: string, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    const ref = h.mock!.doc(path);
    const existing = (await ref.get()).data();
    if (h.rules && existing && ('receiptNo' in existing || ('eet' in existing && !existing.pendingNumber))) {
      throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    }
    await ref.set(data, opts ?? {});
  },
}));
vi.mock('@/lib/eetClient', () => {
  class EetApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { EetApiError, finalizeSaleRequest: h.finalize };
});

const { saveSaleWithEet } = await import('@/lib/eetCheckout');
const { EetApiError } = await import('@/lib/eetClient');

const DOC_ID = 'ABCDEFGHIJ';
const draft = () => ({ ...cashDraft({ items: [cartItem('p1', 2)] }), documentId: DOC_ID, storeId: STORE, userId: UID }) as never;
const soldCount = (m: MockFirestore) => m.read(`${STORE_PATH}/products/p1`)!.soldCount;

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup();
  s.mock.seed(`${STORE_PATH}/products/p1`, { name: 'Káva', soldCount: 10 });
  h.mock = s.mock;
  h.rules = false;
  h.updateDoc.mockClear();
  h.finalize.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const save = (legacySave = vi.fn(async () => undefined)) =>
  saveSaleWithEet({ uid: UID, storeId: STORE, draft: draft(), isTest: false, legacySave });

async function register() {
  const { fetchImpl } = eetFetch(okBody);
  return registerSale(s.db, UID, STORE, DOC_ID, { mode: 'auto', fetchImpl, loadCredentials, now: s.now });
}

describe('offline záloha: soldCount právě jednou', () => {
  it('čistě offline: klient nepřičte, server přičte jednou při očíslování (i po dalším běhu fronty)', async () => {
    h.finalize.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await save()).toMatchObject({ kind: 'offline' });
    expect(h.updateDoc).not.toHaveBeenCalled();
    expect(soldCount(s.mock)).toBe(10);
    await register();
    expect(s.mock.read(salePath(DOC_ID))).toMatchObject({ receiptNo: '2026-000001', pendingNumber: false });
    expect(soldCount(s.mock)).toBe(12);
    await register();
    expect(soldCount(s.mock)).toBe(12);
  });

  it('opakovaná záloha téhož dokladu nic nezdvojí', async () => {
    h.finalize.mockRejectedValue(new TypeError('Failed to fetch'));
    await save();
    await save();
    await register();
    expect(soldCount(s.mock)).toBe(12);
  });

  for (const rules of [false, true]) {
    it(`ztracená odpověď po commitu finalize (${rules ? 'nová' : 'stará'} pravidla): soldCount jen z finalize`, async () => {
      h.rules = rules;
      h.finalize.mockImplementation(async (body: unknown) => {
        await finalizeSale(s.db, UID, finalizeInputSchema.parse(body), { now: s.now, registerNow: false });
        throw new TypeError('network error after commit');
      });
      expect(await save()).toMatchObject({ kind: 'offline' });
      expect(soldCount(s.mock)).toBe(12); // přičetl server ve finalize
      expect(h.updateDoc).not.toHaveBeenCalled();
      await register();
      await register();
      expect(soldCount(s.mock)).toBe(12);
      expect(s.mock.read(salePath(DOC_ID))).toMatchObject({ receiptNo: '2026-000001' });
    });
  }

  it('409 eet_disabled → legacySave jako dřív (offline záloha se nepoužije)', async () => {
    h.finalize.mockRejectedValue(new EetApiError(409, 'eet_disabled', 'EET není zapnuté'));
    const legacySave = vi.fn(async () => undefined);
    expect(await save(legacySave)).toEqual({ kind: 'legacy' });
    expect(legacySave).toHaveBeenCalledTimes(1);
    expect(s.mock.read(salePath(DOC_ID))).toBeUndefined();
  });

  it('smazaný produkt nezastaví očíslování offline dokladu', async () => {
    h.finalize.mockRejectedValue(new TypeError('Failed to fetch'));
    await saveSaleWithEet({ uid: UID, storeId: STORE, draft: { ...(draft() as object), items: [cartItem('gone', 1), cartItem('p1', 1)] } as never, isTest: false, legacySave: vi.fn() });
    expect(await register()).toMatchObject({ outcome: 'sent' });
    expect(soldCount(s.mock)).toBe(11);
    expect(s.mock.read(`${STORE_PATH}/products/gone`)).toBeUndefined();
  });
});
