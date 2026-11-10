import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLUEFY_VARIANT_KEY, detectBrowser, wrapReturnUrl } from '../src/lib/browserReturn';

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
