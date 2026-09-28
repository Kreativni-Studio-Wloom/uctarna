// Run with: node --test scripts/test-profit-protection.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, mocks = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name] ?? require(name), Buffer, Date, console, ...globals });
  return module.exports;
}
const pin = load('src/lib/profit-pin.ts');
function fixture() {
  let data;
  const identity = { uid: 'owner', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } };
  const ref = { get: async () => ({ data: () => data }), set: async value => { data = value; } };
  const adminDb = { collection: name => {
    assert.equal(name, 'profitProtection');
    return { doc: uid => { assert.equal(uid, 'owner'); return ref; } };
  }, runTransaction: async fn => fn({ get: ref.get, update: (_, value) => { data = { ...data, ...value }; } }) };
  const route = load('src/app/api/profit-protection/route.ts', {
    '@/lib/firebase-admin': { adminDb }, '@/lib/profit-pin': pin,
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async token => {
      if (token !== 'valid') throw Error('Invalid token');
      return identity;
    } }) },
  });
  const request = (body, token = 'valid') => new Request('http://localhost/api/profit-protection', {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { route, identity, request, getData: () => data, setData: value => { data = value; } };
}
test('PIN validation, salts and leading zeroes', () => {
  assert.equal(pin.validProfitPin('0123'), true);
  for (const value of ['123', '12345', 'abcd', 1234]) assert.equal(pin.validProfitPin(value), false);
  const first = pin.hashProfitPin('0123');
  assert.notEqual(first.hash, pin.hashProfitPin('0123').hash);
  assert.equal(pin.matchesProfitPin('0123', first.salt, first.hash), true);
  assert.equal(pin.matchesProfitPin('0124', first.salt, first.hash), false);
});
test('unauthenticated and stale-password management requests are rejected', async () => {
  const f = fixture();
  assert.equal((await f.route.GET(f.request(undefined, 'bad'))).status, 401);
  assert.equal((await f.route.POST(f.request({ action: 'enable', pin: '1234' }, 'bad'))).status, 401);
  f.identity.auth_time -= 120;
  for (const action of ['enable', 'disable']) assert.equal((await f.route.POST(f.request({ action, pin: '1234' }))).status, 403);
  assert.equal(f.getData(), undefined);
});
test('enable, verify, reset without old PIN, disable; status never exposes hash', async () => {
  const f = fixture();
  assert.equal((await f.route.POST(f.request({ action: 'enable', pin: '0123' }))).status, 200);
  assert.equal(f.getData().pin, undefined);
  const status = await f.route.GET(f.request());
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await status.json(), { enabled: true });
  assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '0123' }))).status, 200);
  await f.route.POST(f.request({ action: 'enable', pin: '9876' }));
  assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '0123' }))).status, 403);
  assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '9876' }))).status, 200);
  await f.route.POST(f.request({ action: 'disable' }));
  assert.equal(f.getData().enabled, false);
  assert.equal(f.getData().hash, undefined);
});
test('five bad attempts lock even a correct PIN, then allow retry after expiry', async () => {
  const f = fixture();
  await f.route.POST(f.request({ action: 'enable', pin: '1234' }));
  for (let n = 1; n <= 5; n++) {
    assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '0000' }))).status, n === 5 ? 429 : 403);
  }
  assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '1234' }))).status, 429);
  f.setData({ ...f.getData(), lockedUntil: Date.now() - 1 });
  assert.equal((await f.route.POST(f.request({ action: 'verify', pin: '1234' }))).status, 200);
  assert.equal(f.getData().attempts, 0);
});
test('hidden profit is absent from HTML and accessible labels', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const components = load('src/components/pos/ProfitPrivacy.tsx', {
    '@/lib/profit-protection-client': { profitProtectionRequest: () => { throw Error('Unexpected request'); } },
  });
  const html = renderToStaticMarkup(React.createElement(components.PrivateProfit, { value: 123456789 }));
  assert.ok(!html.includes('123') && !html.includes('456') && !html.includes('789'));
  assert.ok(html.includes('Zobrazit zisk'));
  assert.ok(html.includes('select-none'));
});

// Import the actual production dependency; mocking getAuth alone misses runtime/ESM failures.
test('Firebase Admin Auth can load in the selected Node runtime', () => {
  assert.equal(typeof require('firebase-admin/auth').getAuth, 'function');
});
function client(fetch) {
  return load('src/lib/profit-protection-client.ts', {
    '@/lib/firebase': { auth: { currentUser: { uid: 'owner', getIdToken: async () => 'test-token' } } },
  }, { fetch }).profitProtectionRequest;
}
test('HTML server failures produce a Czech error instead of a JSON parsing error', async () => {
  const request = client(async () => new Response('<html>500</html>', { status: 500 }));
  await assert.rejects(request(), /Ochrana zisku je dočasně nedostupná/);
});
test('malformed success never disables protection or unlocks profit', async () => {
  const request = client(async () => Response.json({}));
  await assert.rejects(request(), /Ochrana zisku je dočasně nedostupná/);
  await assert.rejects(request({ action: 'verify', pin: '1234' }), /Ochrana zisku je dočasně nedostupná/);
});
test('network failures are readable and valid responses still work', async () => {
  await assert.rejects(client(async () => { throw new TypeError('Failed to fetch'); })(), /Zkontrolujte připojení/);
  assert.equal((await client(async () => Response.json({ enabled: false }))()).enabled, false);
  assert.equal((await client(async () => Response.json({ ok: true }))({ action: 'verify', pin: '0123' })).ok, true);
});
