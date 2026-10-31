/*
 * Ručně spouštěný end-to-end test fáze C proti Playgroundu (pg.trzbyeet.gov.cz):
 *   npm run eet:e2e
 * finalizeSale → číslo dokladu → registerSale → POK, pak storno (záporná tržba) a ověření spojení.
 * Bez skutečné Firestore (in-memory mock z testů) a bez přihlášení; certifikát z tests/fixtures/eet
 * se šifruje dočasným EET_MASTER_KEY a čte stejnou cestou jako v produkci (getStoreCredentials).
 * Do produkce nic neposílá. Skončí s kódem 1, pokud něco nedopadne podle očekávání.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MockFirestore, asDb } from '../tests/eet/firestoreMock';
import { encryptCredentials } from '../src/lib/eet/credentials';
import { finalizeInputSchema, finalizeSale } from '../src/lib/eet/finalize';
import { registerSale } from '../src/lib/eet/register';
import { stornoSale } from '../src/lib/eet/storno';
import { verifyConnection } from '../src/lib/eet/verify';

process.env.EET_MASTER_KEY = randomBytes(32).toString('base64');

const FIXTURES = path.resolve(__dirname, '../tests/fixtures/eet');
const password = fs.readFileSync(path.join(FIXTURES, 'password_pokladni_cert_playground.txt'), 'utf8').trim();
const p12 = fs.readFileSync(path.join(FIXTURES, 'CA_EET-Playground-CZ00000019.p12'));
const UID = 'e2e-user';
const STORE = 'e2e-store';
const run = Date.now().toString(36).toUpperCase();

let failed = 0;
const check = (name: string, ok: boolean, detail: unknown) => {
  console.log(`${ok ? '✅' : '❌'} ${name}`, typeof detail === 'string' ? detail : JSON.stringify(detail));
  if (!ok) failed++;
};

async function main() {
  const mock = new MockFirestore();
  const db = asDb(mock);
  const store = {
    eet: {
      enabled: true,
      environment: 'playground',
      eic: 'CZ00000019',
      unitId: 303,
      registerId: 'WEB1',
      receiptSeries: { prefix: `E2E${run}-`, resetYearly: false },
    },
  };
  mock.seed(`users/${UID}/stores/${STORE}`, store);
  mock.seed(`users/${UID}/stores/${STORE}/private/eet`, { ...encryptCredentials(UID, STORE, p12, password) });

  const v = await verifyConnection(db, UID, STORE, store as never);
  check('ověření spojení (overeni=true → kód 0)', v.ok && v.code === 0, v);

  const sale = {
    items: [{ productId: 'p1', productName: 'Káva', price: 81.6, quantity: 1 }],
    totalAmount: 81.6, paymentMethod: 'cash', currency: 'CZK', eurRate: null, originalAmountCZK: 81.6, customerName: null,
    isRefund: false, refundAmount: null, paidAmount: 100, paidCurrency: 'CZK', changeAmount: 18.4, changeAmountEUR: null,
    discount: null, discountAmount: 0, finalAmount: 81.6, tipAmount: null, sumUpData: null, served: false,
  };
  const docId = `e2e${run}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  const r = await finalizeSale(db, UID, finalizeInputSchema.parse({ storeId: STORE, documentId: docId, sale }));
  check('finalize → sent + POK (-ff)', r.eet?.status === 'sent' && /-ff$/.test(r.eet?.pok ?? ''), { receiptNo: r.receiptNo, status: r.eet?.status, pok: r.eet?.pok, message: r.eet?.message });

  const again = await registerSale(db, UID, STORE, docId, { mode: 'manual' });
  check('opakované odeslání se přeskočí (idempotence)', again.outcome === 'skipped', again.outcome === 'skipped' ? again.reason : again.outcome);

  const dup = await finalizeSale(db, UID, finalizeInputSchema.parse({ storeId: STORE, documentId: docId, sale }));
  check('finalize podruhé = duplicate, stejné číslo', dup.duplicate && dup.receiptNo === r.receiptNo, { receiptNo: dup.receiptNo });

  const s = await stornoSale(db, UID, STORE, docId);
  const stornoDoc = mock.read(`users/${UID}/stores/${STORE}/sales/${s.saleId}`) as { eet?: { data?: { celk_trzba?: string } } };
  check('storno → záporná tržba, POK', s.eet?.status === 'sent' && stornoDoc.eet?.data?.celk_trzba === '-81.60', { receiptNo: s.receiptNo, status: s.eet?.status, celk: stornoDoc.eet?.data?.celk_trzba, pok: s.eet?.pok });

  const t = await finalizeSale(db, UID, finalizeInputSchema.parse({ storeId: STORE, documentId: `${docId}t`, sale, isTest: true }));
  check('testovací doklad: číslo ano, EET ne', t.eet?.status === 'test' && !!t.receiptNo, { receiptNo: t.receiptNo, status: t.eet?.status });

  console.log(failed ? `\n${failed} scénář(ů) selhalo` : '\nVšechny scénáře prošly');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
