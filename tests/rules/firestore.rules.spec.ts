// Testy firestore.rules (EET 2.0, fáze E). Potřebují Firestore emulator (Java):
//   npm run test:rules
// Běžné `npm test` je nespouští (soubor *.spec.ts, vlastní vitest.rules.config.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { withOfflineEet } from '@/lib/checkoutSale';
import { duplicateSaleData, duplicateStoreData } from '@/lib/storeDuplicate';

const UID = 'alice';
const STORE = 'store1';
const STORE_PATH = `users/${UID}/stores/${STORE}`;
const salePath = (id: string) => `${STORE_PATH}/sales/${id}`;

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-uctarna-rules',
    firestore: { rules: readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const alice = (): Firestore => env.authenticatedContext(UID).firestore() as unknown as Firestore;
const bob = (): Firestore => env.authenticatedContext('bob').firestore() as unknown as Firestore;
const anon = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

/** Zápis „jako server“ (Admin SDK obchází pravidla). */
async function seed(p: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, p), data);
  });
}

const legacySale = () => ({
  items: [{ productId: 'p1', productName: 'Káva', quantity: 1, price: 50 }],
  totalAmount: 50,
  paymentMethod: 'card',
  currency: 'CZK',
  documentId: 'ABCDEFGHIJ',
  storeId: STORE,
  userId: UID,
  isRefund: false,
  served: false,
  createdAt: Timestamp.now(),
});

const serverEetSale = () => ({
  ...legacySale(),
  paymentMethod: 'cash',
  receiptNo: '2026-000001',
  eet: { status: 'sent', env: 'playground', saleAt: '2026-10-17T10:00:00.000Z', pok: 'POK', attempts: [] },
});

const offlineSale = (exemptReason?: string) => withOfflineEet(legacySale(), new Date(), exemptReason);

describe('counters a private: klient nečte ani nezapisuje', () => {
  for (const sub of ['counters/receipts', 'private/eet']) {
    it(sub, async () => {
      await seed(`${STORE_PATH}/${sub}`, { last: 1 });
      await assertFails(getDoc(doc(alice(), `${STORE_PATH}/${sub}`)));
      await assertFails(setDoc(doc(alice(), `${STORE_PATH}/${sub}`), { last: 2 }));
      await assertFails(deleteDoc(doc(alice(), `${STORE_PATH}/${sub}`)));
      await assertFails(getDoc(doc(anon(), `${STORE_PATH}/${sub}`)));
    });
  }
});

describe('sales: založení', () => {
  it('dnešní doklad bez EET polí (prodejna bez EET) projde', async () => {
    await assertSucceeds(setDoc(doc(alice(), salePath('s1')), legacySale()));
    await assertSucceeds(setDoc(doc(alice(), salePath('s2')), { ...legacySale(), isTest: true, createdAt: serverTimestamp() }));
  });

  it('klient nesmí založit doklad s receiptNo nebo eet ze serveru', async () => {
    await assertFails(setDoc(doc(alice(), salePath('s1')), { ...legacySale(), receiptNo: '2026-000001' }));
    await assertFails(setDoc(doc(alice(), salePath('s1')), serverEetSale()));
    await assertFails(setDoc(doc(alice(), salePath('s1')), { ...legacySale(), eet: { status: 'test' } }));
    await assertFails(setDoc(doc(alice(), salePath('s1')), { ...legacySale(), pendingNumber: true }));
  });

  it('offline záloha (withOfflineEet) projde, i s exemptReason a přes setDoc merge', async () => {
    await assertSucceeds(setDoc(doc(alice(), salePath('o1')), offlineSale()));
    await assertSucceeds(setDoc(doc(alice(), salePath('o2')), offlineSale('Platba převodem'), { merge: true }));
    await assertSucceeds(setDoc(doc(alice(), salePath('o3')), { ...offlineSale(), isTest: true }));
  });

  it('offline záloha jiného tvaru neprojde', async () => {
    const o = offlineSale();
    await assertFails(setDoc(doc(alice(), salePath('x1')), offlineSale('x'.repeat(201))));
    await assertFails(setDoc(doc(alice(), salePath('x2')), { ...o, eet: { ...o.eet, status: 'sent' } }));
    await assertFails(setDoc(doc(alice(), salePath('x3')), { ...o, eet: { ...o.eet, pok: 'P' } }));
    await assertFails(setDoc(doc(alice(), salePath('x4')), { ...o, receiptNo: '2026-000009' }));
    await assertFails(setDoc(doc(alice(), salePath('x5')), { ...o, pendingNumber: false }));
    await assertFails(setDoc(doc(alice(), salePath('x6')), { ...o, eet: { ...o.eet, nextRetryAt: 'zítra' } }));
    await assertFails(setDoc(doc(alice(), salePath('x7')), { ...o, eet: { status: 'queued', saleAt: 'x' } }));
  });

  it('nepřihlášený ani cizí uživatel doklad nezaloží (stará výjimka pro kartu odstraněna)', async () => {
    await assertFails(setDoc(doc(anon(), salePath('s1')), legacySale()));
    await assertFails(setDoc(doc(anon(), salePath('s2')), offlineSale()));
    await assertFails(setDoc(doc(bob(), salePath('s3')), legacySale()));
  });
});

describe('sales: úpravy', () => {
  beforeEach(async () => {
    await seed(salePath('legacy'), legacySale());
    await seed(salePath('eet'), serverEetSale());
    await seed(salePath('offline'), offlineSale());
  });

  it('běžné úpravy (served, prepared, items) projdou i u EET dokladu', async () => {
    await assertSucceeds(updateDoc(doc(alice(), salePath('legacy')), { served: true, servedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(alice(), salePath('eet')), { prepared: true, preparedAt: new Date() }));
    await assertSucceeds(updateDoc(doc(alice(), salePath('eet')), { items: [{ productId: 'p1', quantity: 1, price: 50, cost: 10 }] }));
    await assertSucceeds(updateDoc(doc(alice(), salePath('offline')), { served: true }));
  });

  it('receiptNo, eet, pendingNumber, storno a stornoOf klient nemění', async () => {
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { receiptNo: '2026-000002' }));
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { receiptNo: deleteField() }));
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { 'eet.status': 'queued' }));
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { eet: deleteField() }));
    await assertFails(updateDoc(doc(alice(), salePath('legacy')), { eet: { status: 'sent' } }));
    await assertFails(updateDoc(doc(alice(), salePath('legacy')), { receiptNo: '2026-000003' }));
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { storno: { saleId: 'x' } }));
    await assertFails(updateDoc(doc(alice(), salePath('legacy')), { stornoOf: 'x' }));
    await assertFails(updateDoc(doc(alice(), salePath('offline')), { pendingNumber: deleteField() }));
  });

  it('doklad s EET identitou nejde přeznačit na testovací; dnešní doklad ano', async () => {
    await assertFails(updateDoc(doc(alice(), salePath('eet')), { isTest: true }));
    await assertFails(updateDoc(doc(alice(), salePath('offline')), { isTest: true }));
    await assertSucceeds(updateDoc(doc(alice(), salePath('legacy')), { isTest: true }));
  });

  it('offline záloha přes doklad, který už uložil server (ztracená odpověď), neprojde', async () => {
    await assertFails(setDoc(doc(alice(), salePath('eet')), offlineSale(), { merge: true }));
    await assertFails(setDoc(doc(alice(), salePath('legacy')), offlineSale(), { merge: true }));
  });

  it('opakovaná offline záloha přes offline zálohu projde', async () => {
    await assertSucceeds(setDoc(doc(alice(), salePath('offline')), offlineSale(), { merge: true }));
    await assertSucceeds(setDoc(doc(alice(), salePath('offline')), offlineSale('Platba převodem'), { merge: true }));
  });

  it('nepřihlášený nic neupraví', async () => {
    await assertFails(updateDoc(doc(anon(), salePath('legacy')), { served: true }));
  });
});

describe('sales: mazání', () => {
  it('doklad bez receiptNo a eet se maže jako dřív', async () => {
    await seed(salePath('legacy'), legacySale());
    await assertSucceeds(deleteDoc(doc(alice(), salePath('legacy'))));
  });

  it('doklad s receiptNo nebo eet nejde smazat (i offline záloha, i stornovaný)', async () => {
    await seed(salePath('eet'), serverEetSale());
    await seed(salePath('noOnly'), { ...legacySale(), receiptNo: '2026-000005' });
    await seed(salePath('offline'), offlineSale());
    await seed(salePath('storno'), { ...serverEetSale(), stornoOf: 'eet' });
    for (const id of ['eet', 'noOnly', 'offline', 'storno']) await assertFails(deleteDoc(doc(alice(), salePath(id))));
  });

  it('testovací doklad s číslem a eet.status test jde smazat', async () => {
    await seed(salePath('test'), { ...legacySale(), isTest: true, receiptNo: '2026-000006', eet: { status: 'test' } });
    await assertSucceeds(deleteDoc(doc(alice(), salePath('test'))));
  });

  it('nepřihlášený ani cizí nemaže', async () => {
    await seed(salePath('legacy'), legacySale());
    await assertFails(deleteDoc(doc(anon(), salePath('legacy'))));
    await assertFails(deleteDoc(doc(bob(), salePath('legacy'))));
  });
});

describe('prodejna: eet.certificate jen server', () => {
  const cert = { subjectEic: 'CZ00000019', serial: '1', validFrom: Timestamp.now(), validTo: Timestamp.now(), env: 'playground' };

  it('nastavení EET (tečkové cesty) a vypínač projdou, certifikát zůstane', async () => {
    await seed(STORE_PATH, { name: 'A', eet: { enabled: false, certificate: cert } });
    await assertSucceeds(updateDoc(doc(alice(), STORE_PATH), { 'eet.enabled': true, 'eet.eic': 'CZ00000019', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(alice(), STORE_PATH), { name: 'B', isActive: false }));
  });

  it('prodejna bez EET: běžné úpravy a zapnutí jako dřív', async () => {
    await seed(STORE_PATH, { name: 'A' });
    await assertSucceeds(updateDoc(doc(alice(), STORE_PATH), { testMode: true }));
    await assertSucceeds(updateDoc(doc(alice(), STORE_PATH), { 'eet.enabled': true }));
  });

  it('klient certifikát nezapíše, nezmění ani nesmaže', async () => {
    await seed(STORE_PATH, { name: 'A', eet: { enabled: true, certificate: cert } });
    await assertFails(updateDoc(doc(alice(), STORE_PATH), { 'eet.certificate.serial': '2' }));
    await assertFails(updateDoc(doc(alice(), STORE_PATH), { 'eet.certificate': deleteField() }));
    await assertFails(updateDoc(doc(alice(), STORE_PATH), { eet: { enabled: false } }));
    await assertFails(setDoc(doc(alice(), `users/${UID}/stores/new`), { name: 'N', eet: { certificate: cert } }));
    await assertSucceeds(setDoc(doc(alice(), `users/${UID}/stores/new2`), { name: 'N', eet: { enabled: false } }));
  });
});

describe('produkty', () => {
  it('soldCount mění jen vlastník (výjimka pro nepřihlášené odstraněna)', async () => {
    await seed(`${STORE_PATH}/products/p1`, { name: 'Káva', soldCount: 1 });
    await assertFails(updateDoc(doc(anon(), `${STORE_PATH}/products/p1`), { soldCount: 2, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(alice(), `${STORE_PATH}/products/p1`), { soldCount: 2, updatedAt: serverTimestamp() }));
  });
});

describe('Duplikovat prodejnu', () => {
  it('kopie přes duplicateStoreData / duplicateSaleData projde; syrová kopie EET dokladu ne', async () => {
    const storeData = { name: 'A', eet: { enabled: true, unitId: 1, certificate: { serial: '1' } } };
    const ctx = { sourceStoreId: STORE, newStoreId: 'copy', userId: UID, productIdMap: new Map(), saleIdMap: new Map([['eet', 'n1']]) };
    const db = alice();
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${UID}/stores/copy`), { ...duplicateStoreData(storeData), name: 'A 2' });
    batch.set(doc(db, `users/${UID}/stores/copy/sales/n1`), duplicateSaleData(serverEetSale(), { ...ctx, sourceSaleId: 'eet' }));
    batch.set(doc(db, `users/${UID}/stores/copy/sales/n2`), duplicateSaleData(offlineSale(), { ...ctx, sourceSaleId: 'o' }));
    batch.set(doc(db, `users/${UID}/stores/copy/sales/n3`), duplicateSaleData(legacySale(), { ...ctx, sourceSaleId: 'l' }));
    await assertSucceeds(batch.commit());
    await assertFails(setDoc(doc(db, `users/${UID}/stores/copy/sales/n4`), { ...serverEetSale(), storeId: 'copy' }));
  });
});
