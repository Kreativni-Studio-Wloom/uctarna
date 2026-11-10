import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BLUEFY_SAME_WINDOW_KEY,
  BLUEFY_VARIANT_KEY,
  detectBrowser,
  handOffToPos,
  readPendingSumUpPayment,
  wrapReturnUrl,
} from '../src/lib/browserReturn';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const TARGET = 'https://uctarna.cz/payment/success';

function setup(ua: string, opts: { bluetooth?: boolean; variant?: string } = {}) {
  const store = new Map<string, string>();
  if (opts.variant) store.set(BLUEFY_VARIANT_KEY, opts.variant);
  const nav: Record<string, unknown> = { userAgent: ua, maxTouchPoints: 5 };
  if (opts.bluetooth) nav.bluetooth = {};
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('wrapReturnUrl', () => {
  it('Safari a Android nechá beze změny', () => {
    setup(SAFARI);
    expect(wrapReturnUrl(TARGET)).toBe(TARGET);
    setup(ANDROID, { bluetooth: true });
    expect(wrapReturnUrl(TARGET)).toBe(TARGET);
  });

  it('Chrome na iOS vrací přes googlechromes://', () => {
    setup(CHROME);
    expect(wrapReturnUrl(TARGET)).toBe('googlechromes://uctarna.cz/payment/success');
  });

  it('Bluefy pozná podle Web Bluetooth a bez nastavení nechá https', () => {
    setup(SAFARI, { bluetooth: true });
    expect(detectBrowser()).toBe('bluefy');
    expect(wrapReturnUrl(TARGET)).toBe(TARGET);
  });

  it('Bluefy s ověřenou variantou zachová cestu, aby SumUp mohl přidat parametry', () => {
    setup(SAFARI, { bluetooth: true, variant: 'bluefys-host' });
    expect(wrapReturnUrl(TARGET)).toBe('bluefys://uctarna.cz/payment/success');
  });
});

describe('handOffToPos', () => {
  it('úspěch v Bluefy přejde do pokladny s údaji o platbě', () => {
    setup(SAFARI, { bluetooth: true });
    localStorage.setItem('uctarna_payment_data', JSON.stringify({ storeId: 'abc' }));
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    expect(handOffToPos({ status: 'success', txCode: 'TX1', foreignTxId: 'doc1' })).toBe(true);
    expect(replace).toHaveBeenCalledWith('/store/abc?view=pos&sumup=success&smp-tx-code=TX1&foreign-tx-id=doc1');
  });

  it('neúspěch se vrátí do pokladny bez dalších parametrů; bez dat platby nic nedělá', () => {
    setup(SAFARI, { bluetooth: true });
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    expect(handOffToPos({ status: 'fail' })).toBe(false);
    localStorage.setItem('uctarna_payment_data', JSON.stringify({ storeId: 'abc' }));
    expect(handOffToPos({ status: 'fail' })).toBe(true);
    expect(replace).toHaveBeenCalledWith('/store/abc?view=pos');
  });
});

describe('Bluefy – stejné okno', () => {
  it('s ověřenou variantou vrací jen přepnutí do aplikace (přednost před novou záložkou)', () => {
    setup(SAFARI, { bluetooth: true, variant: 'bluefys-host' });
    localStorage.setItem(BLUEFY_SAME_WINDOW_KEY, 'bluefys');
    expect(wrapReturnUrl(TARGET)).toBe('bluefys://');
  });

  it('rozpracovanou platbu vrací jen pro stejnou prodejnu a nejvýš 30 min starou', () => {
    setup(SAFARI, { bluetooth: true });
    localStorage.setItem('uctarna_payment_data', JSON.stringify({ storeId: 'abc', documentId: 'doc1', timestamp: Date.now() }));
    expect(readPendingSumUpPayment('abc')).toEqual({ documentId: 'doc1' });
    expect(readPendingSumUpPayment('jina')).toBeNull();
    localStorage.setItem('uctarna_payment_data', JSON.stringify({ storeId: 'abc', documentId: 'doc1', timestamp: Date.now() - 31 * 60 * 1000 }));
    expect(readPendingSumUpPayment('abc')).toBeNull();
  });
});
