// ----------------------------------------------------------------------------
// Návrat ze SumUp do stejného prohlížeče, ze kterého byla platba spuštěna.
//
// SumUp po platbě otevře callback URL. Obyčejnou https adresu iOS vždy otevře
// ve VÝCHOZÍM prohlížeči (typicky Safari) – i když platba začala v Bluefy nebo
// Chrome. Safari ale nemá localStorage z Bluefy (uctarna_payment_data), takže
// se prodej nedokončí ve správném prohlížeči a tiskárna (Web Bluetooth) nejede.
//
// Řešení: na iOS callback zabalíme do URL schématu aktuálního prohlížeče.
// SumUp k callbacku přidává ?smp-status=…, proto používáme jen schémata, kde
// cesta i query zůstanou zachované (host/cesta, ne ?url=…).
//
// Chrome/Edge mají schéma zdokumentované. Bluefy schéma podporuje, ale přesnou
// syntaxi nezveřejňuje – variantu proto jednou ověříme přímo na zařízení
// (stránka /sumup-navrat) a uložíme do localStorage Bluefy.
// ----------------------------------------------------------------------------

export type BrowserKind = 'bluefy' | 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

export const BLUEFY_VARIANT_KEY = 'uctarna_bluefy_return_variant';

export type BluefyVariant = {
  id: string;
  label: string;
  build: (target: URL) => string;
};

const hostPath = (u: URL) => `${u.host}${u.pathname}${u.search}`;

/** Kandidáti na Bluefy schéma. Ověřují se na zařízení přes /sumup-navrat. */
export const BLUEFY_VARIANTS: BluefyVariant[] = [
  { id: 'bluefys-host', label: 'bluefys://adresa', build: (u) => `bluefys://${hostPath(u)}` },
  { id: 'bluefy-host', label: 'bluefy://adresa', build: (u) => `bluefy://${hostPath(u)}` },
  { id: 'bluefy-https', label: 'bluefy://https://adresa', build: (u) => `bluefy://${u.toString()}` },
  { id: 'bluefy-https-host', label: 'bluefy-https://adresa', build: (u) => `bluefy-https://${hostPath(u)}` },
  { id: 'bluefy-open-url', label: 'bluefy://open?url=…', build: (u) => `bluefy://open?url=${encodeURIComponent(u.toString())}` },
];

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS se hlásí jako Mac – rozlišíme dotykem.
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function detectBrowser(): BrowserKind {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/EdgiOS/i.test(ua)) return 'edge';
  if (/FxiOS/i.test(ua)) return 'firefox';
  // Bluefy: WebKit na iOS, který (na rozdíl od Safari) má Web Bluetooth.
  if (/Bluefy/i.test(ua) || (isIOS() && 'bluetooth' in navigator)) return 'bluefy';
  if (isIOS() && /Safari/i.test(ua)) return 'safari';
  return 'other';
}

export function getBluefyVariant(): BluefyVariant | null {
  try {
    const id = localStorage.getItem(BLUEFY_VARIANT_KEY);
    return BLUEFY_VARIANTS.find((v) => v.id === id) ?? null;
  } catch {
    return null;
  }
}

export function setBluefyVariant(id: string): void {
  try {
    localStorage.setItem(BLUEFY_VARIANT_KEY, id);
  } catch {
    // localStorage nedostupný – návrat zůstane přes výchozí prohlížeč
  }
}

/**
 * Vrátí URL, která na iOS otevře `target` ve stejném prohlížeči, ve kterém
 * právě běžíme. Mimo iOS (Android otevírá callback správně) a u Safari vrací
 * `target` beze změny.
 */
export function wrapReturnUrl(target: string): string {
  if (!isIOS()) return target;
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return target;
  }
  if (u.protocol !== 'https:') return target;

  switch (detectBrowser()) {
    case 'chrome':
      return `googlechromes://${hostPath(u)}`;
    case 'edge':
      return `microsoft-edge-https://${hostPath(u)}`;
    case 'bluefy': {
      const variant = getBluefyVariant();
      return variant ? variant.build(u) : target;
    }
    // Firefox umí jen firefox://open-url?url=…, kam by SumUp parametry nepřidal.
    default:
      return target;
  }
}
