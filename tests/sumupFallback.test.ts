import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  serverTimestamp: () => 'SERVER_TS',
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: async (ref: { path: string }) => ({ exists: () => store.has(ref.path) }),
      set: (ref: { path: string }, data: Record<string, unknown>) => store.set(ref.path, data),
    }),
}));

const { saveEetFallbackSale } = await import('@/lib/sumupFallback');

const paymentData = {
  storeId: 'S1',
  userId: 'U1',
  documentId: 'DOC123',
  cartItems: [{ productId: 'p1', quantity: 1 }],
  totalAmount: 100,
  eet: true,
};
const PATH = 'users/U1/stores/S1/sales/DOC123';

describe('SumUp: záložní uložení dokladu s EET', () => {
  beforeEach(() => store.clear());

  it('chybějící doklad založí jako offline zálohu (pendingNumber, eet queued)', async () => {
    expect(await saveEetFallbackSale(paymentData, 'DOC123', 'TX1')).toBe('created');
    expect(store.get(PATH)).toMatchObject({ pendingNumber: true, eet: { status: 'queued' }, paymentMethod: 'card', documentId: 'DOC123' });
  });

  it('doklad uložený serverem nepřepíše (žádné dvojí odeslání do EET)', async () => {
    const serverSale = { receiptNo: '2026-000007', eet: { status: 'sent', pok: 'x' } };
    store.set(PATH, serverSale);
    expect(await saveEetFallbackSale(paymentData, 'DOC123', 'TX1')).toBe('exists');
    expect(store.get(PATH)).toBe(serverSale);
  });

  it('bez dat platby nic neuloží', async () => {
    expect(await saveEetFallbackSale({ storeId: 'S1' }, 'DOC123', null)).toBe('skipped');
    expect(store.size).toBe(0);
  });
});
