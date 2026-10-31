/*
 * Ručně spouštěný smoke test jádra EET proti Playgroundu (pg.trzbyeet.gov.cz).
 *   npm run eet:smoke
 * Používá jen veřejné playground certifikáty z tests/fixtures/eet. Do produkce nic neposílá.
 * Skončí s kódem 1, pokud některý scénář nedopadne podle očekávání.
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeEetAmountCZK } from '../src/lib/eet/amount';
import { sendTrzbaAttempt, type EetAttempt } from '../src/lib/eet/attempt';
import { formatAmount, formatDateTimePrague } from '../src/lib/eet/format';
import { loadP12 } from '../src/lib/eet/sign';
import type { EetCredentials, EetTrzbaData } from '../src/lib/eet/types';
import { MAX_MESSAGE_BYTES } from '../src/lib/eet/constants';

const FIXTURES = path.resolve(__dirname, '../tests/fixtures/eet');
const EICS = ['CZ00000019', 'CZ683555118', 'CZ8551015704'] as const;
const password = fs.readFileSync(path.join(FIXTURES, 'password_pokladni_cert_playground.txt'), 'utf8').trim();
const creds = (eic: string): EetCredentials =>
  loadP12(fs.readFileSync(path.join(FIXTURES, `CA_EET-Playground-${eic}.p12`)), password);

const run = Date.now().toString(36).toUpperCase();
let seq = 0;
// Čísla evidenčních jednotek z ukázkových zpráv FS (jinak Playground hlásí varování 6).
const UNIT_IDS: Record<string, number> = { CZ00000019: 303, CZ683555118: 101, CZ8551015704: 202 };
const data = (eic: string, celk_trzba: string): EetTrzbaData => ({
  eic,
  unitId: UNIT_IDS[eic],
  registerId: 'WEB1',
  porad_cis: `SMOKE-${run}-${++seq}`,
  dat_trzby: formatDateTimePrague(new Date()),
  celk_trzba,
});

type Expect = { kind: 'pok' } | { kind: 'code'; code: number };
const failures: string[] = [];

function describe(a: EetAttempt): string {
  const r = a.result;
  const meta = `${r.ms} ms, ${a.requestBytes} B, X-Global-Transaction-Id=${r.xGlobalTransactionId ?? '-'}`;
  switch (r.kind) {
    case 'ok':
      return `POK ${r.pok} test=${r.test} dat_prij=${r.receivedAt ?? '-'}` +
        (r.warnings.length ? ` varování=${JSON.stringify(r.warnings)}` : '') + ` [${meta}]`;
    case 'error':
      return `Chyba kód ${r.code} "${r.text}" test=${r.test}` +
        (r.warnings.length ? ` varování=${JSON.stringify(r.warnings)}` : '') + ` [${meta}]`;
    case 'timeout':
      return `TIMEOUT [${meta}]`;
    case 'network':
      return `SÍŤ: ${r.message} [${meta}]`;
  }
}

async function scenario(
  name: string,
  expect: Expect,
  input: Omit<Parameters<typeof sendTrzbaAttempt>[0], 'env' | 'timeoutMs'>,
) {
  const a = await sendTrzbaAttempt({ env: 'playground', timeoutMs: 15_000, ...input });
  const r = a.result;
  const ok =
    expect.kind === 'pok'
      ? r.kind === 'ok' && r.pok.toLowerCase().endsWith('-ff') && r.test
      : r.kind === 'error' && r.code === expect.code;
  const exp = expect.kind === 'pok' ? 'POK …-ff' : `kód ${expect.code}`;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (čekám ${exp}, klasifikace ${a.classification}): ${describe(a)}`);
  if (!ok) failures.push(name);
  return a;
}

async function main() {
  console.log(`EET Playground smoke test, běh ${run}, ${new Date().toISOString()}`);

  for (const eic of EICS) {
    const c = creds(eic);
    await scenario(`${eic} ostrý mód 81.60`, { kind: 'pok' }, { credentials: c, data: data(eic, '81.60'), firstAttempt: true });
    await scenario(`${eic} ověřovací mód`, { kind: 'code', code: 0 }, {
      credentials: c, data: data(eic, '1.00'), firstAttempt: true, verify: true,
    });
  }

  const c = creds('CZ00000019');

  await scenario('vratka −120.50', { kind: 'pok' }, { credentials: c, data: data('CZ00000019', '-120.50'), firstAttempt: true });

  // Platba 4.50 € při kurzu 24.30 Kč/€, tak jak ji ukládá CheckoutModal.
  const eurCzk = computeEetAmountCZK(
    { totalAmount: 4.5, currency: 'EUR', eurRate: 24.3, finalAmount: 109.35, paymentMethod: 'cash' },
    { tipsAreBusinessIncome: true },
  );
  await scenario(`EUR 4.50 € × 24.30 = ${formatAmount(eurCzk)} Kč`, { kind: 'pok' }, {
    credentials: c, data: data('CZ00000019', formatAmount(eurCzk)), firstAttempt: true,
  });

  // Opakování: stejná Data, nové UUID a dat_odesl, prvni_zaslani=false.
  const frozen = data('CZ00000019', '42.00');
  const first = await scenario('opakování: 1. pokus', { kind: 'pok' }, { credentials: c, data: frozen, firstAttempt: true });
  const retry = await scenario('opakování: 2. pokus se stejnými Data', { kind: 'pok' }, {
    credentials: c, data: frozen, firstAttempt: false, attemptNo: 2,
  });
  if (first.header.uuid === retry.header.uuid) failures.push('opakování má stejné UUID');

  // Vynucená chyba podpisu: změna částky v podepsaném Body po podpisu.
  await scenario('vynucená chyba podpisu', { kind: 'code', code: 4 }, {
    credentials: c,
    data: data('CZ00000019', '10.00'),
    firstAttempt: true,
    tamperEnvelope: (xml) => xml.replace('celk_trzba="10.00"', 'celk_trzba="10.01"'),
  });

  // Příliš velká zpráva: obálka nafouknutá bílými znaky v Header nad 12 kB.
  await scenario(`zpráva > ${MAX_MESSAGE_BYTES} B`, { kind: 'code', code: 7 }, {
    credentials: c,
    data: data('CZ00000019', '10.00'),
    firstAttempt: true,
    tamperEnvelope: (xml) => xml.replace('</soapenv:Header>', `${' '.repeat(MAX_MESSAGE_BYTES)}</soapenv:Header>`),
  });

  console.log(failures.length ? `\nNEPROŠLO: ${failures.join(', ')}` : '\nVšechny scénáře prošly.');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
