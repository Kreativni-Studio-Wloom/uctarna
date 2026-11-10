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

// Návrat do STEJNÉHO okna: callback jen přepne do aplikace Bluefy bez otevření
// stránky. SumUp k němu přidá ?smp-status=…, proto se varianta ověřuje i s tím.
export const BLUEFY_SAME_WINDOW_KEY = 'uctarna_bluefy_same_window';

export const BLUEFY_SAME_WINDOW_VARIANTS: { id: string; url: string }[] = [
  { id: 'bluefys', url: 'bluefys://' },
  { id: 'bluefy', url: 'bluefy://' },
  { id: 'bluefy-https', url: 'bluefy-https://' },
];

export function getBluefySameWindow(): { id: string; url: string } | null {
  try {
    const id = localStorage.getItem(BLUEFY_SAME_WINDOW_KEY);
    return BLUEFY_SAME_WINDOW_VARIANTS.find((v) => v.id === id) ?? null;
  } catch {
    return null;
  }
}

export function setBluefySameWindow(id: string | null): void {
  try {
    if (id) localStorage.setItem(BLUEFY_SAME_WINDOW_KEY, id);
    else localStorage.removeItem(BLUEFY_SAME_WINDOW_KEY);
  } catch {
    // ignorujeme
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
      // Nejlépe: jen přepnout zpět do Bluefy (stejné okno), výsledek ověří pokladna u SumUp.
      const sameWindow = getBluefySameWindow();
      if (sameWindow) return sameWindow.url;
      const variant = getBluefyVariant();
      return variant ? variant.build(u) : target;
    }
    // Firefox umí jen firefox://open-url?url=…, kam by SumUp parametry nepřidal.
    default:
      return target;
  }
}

// ----------------------------------------------------------------------------
// Bluefy otevře návrat ze SumUp v NOVÉ záložce a tu z JavaScriptu nejde zavřít
// (Safari ji zavřít dovolí a dokončení převezme původní okno). V Bluefy proto
// návratová záložka sama přejde do pokladny a platbu dokončí tam.
// ----------------------------------------------------------------------------

/** Návratová stránka má platbu dokončit přímo v pokladně (záložku nejde zavřít). */
export function shouldHandOffToPos(): boolean {
  return detectBrowser() === 'bluefy';
}

function readPaymentStoreId(): string | null {
  try {
    const raw = localStorage.getItem('uctarna_payment_data');
    const storeId = raw ? JSON.parse(raw)?.storeId : null;
    return typeof storeId === 'string' && storeId ? storeId : null;
  } catch {
    return null;
  }
}

/**
 * Přejde z návratové stránky do pokladny prodejny. U úspěchu předá txCode a
 * foreignTxId, pokladna pak prodej uloží a vytiskne. Vrací false, když nejsou
 * data platby (pak návratová stránka pokračuje po svém).
 */
export function handOffToPos(
  result: { status: 'success'; txCode: string | null; foreignTxId: string | null } | { status: 'fail' }
): boolean {
  const storeId = readPaymentStoreId();
  if (!storeId) return false;
  const params = new URLSearchParams({ view: 'pos' });
  if (result.status === 'success') {
    params.set('sumup', 'success');
    if (result.txCode) params.set('smp-tx-code', result.txCode);
    if (result.foreignTxId) params.set('foreign-tx-id', result.foreignTxId);
  }
  window.location.replace(`/store/${encodeURIComponent(storeId)}?${params.toString()}`);
  return true;
}

/** Odstraní z adresy pokladny parametry z návratové stránky; vrátí úspěch z callbacku, pokud byl. */
export function stripSumUpHandoffParams(): { txCode: string | null } | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const keys = ['sumup', 'smp-tx-code', 'foreign-tx-id'];
  if (!keys.some((k) => url.searchParams.has(k))) return null;
  const hint = url.searchParams.get('sumup') === 'success' ? { txCode: url.searchParams.get('smp-tx-code') } : null;
  keys.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(window.history.state, '', url.toString());
  return hint;
}

/** Pokladna si výsledek platby ověřuje sama u SumUp (jen Bluefy – v Safari to řeší návratová záložka). */
export function shouldVerifySumUpOnReturn(): boolean {
  return detectBrowser() === 'bluefy';
}

const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

/** Rozpracovaná SumUp platba této prodejny (uctarna_payment_data), nejvýš 30 min stará. */
export function readPendingSumUpPayment(storeId: string): { documentId: string } | null {
  try {
    const raw = localStorage.getItem('uctarna_payment_data');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const documentId = data?.documentId || data?.foreignTxId;
    if (data?.storeId !== storeId || typeof documentId !== 'string' || !documentId) return null;
    if (typeof data.timestamp === 'number' && Date.now() - data.timestamp > PENDING_MAX_AGE_MS) return null;
    return { documentId };
  } catch {
    return null;
  }
}

export function clearPendingSumUpPayment(): void {
  try {
    localStorage.removeItem('uctarna_payment_data');
  } catch {
    // ignorujeme
  }
}
