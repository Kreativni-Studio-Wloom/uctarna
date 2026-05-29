import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAgpiNUApg_z3T98WnQem5Y6T9EOx6U_r4',
  authDomain: 'prodejni-system-uctarna.firebaseapp.com',
  projectId: 'prodejni-system-uctarna',
  storageBucket: 'prodejni-system-uctarna.firebasestorage.app',
  messagingSenderId: '789375134911',
  appId: '1:789375134911:web:8f0fcfbbc57f852f6e2a0a',
  measurementId: 'G-7Y0V0WVWJP',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);

const SAFARI_CACHE_RESET_KEY = 'uctarna_firestore_safari_reset';
const SAFARI_CACHE_RESET_MS = 5 * 60 * 1000;

/** iOS Safari / WebKit blokuje WebChannel fetch — nutný long-polling transport. */
function isSafariOrIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(ua);
  const isIpadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isWebKit = /WebKit/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS|Chromium/.test(ua);
  return isAppleMobile || isIpadOs || isWebKit;
}

function shouldUseMemoryCacheFallback(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const resetAt = Number(localStorage.getItem(SAFARI_CACHE_RESET_KEY));
    return Number.isFinite(resetAt) && Date.now() - resetAt < SAFARI_CACHE_RESET_MS;
  } catch {
    return false;
  }
}

/** Volitelný fallback po zamrznutí IndexedDB cache na Safari (viz firebase-js-sdk #8081). */
export function markFirestoreSafariCacheReset(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SAFARI_CACHE_RESET_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function buildLocalCache() {
  if (shouldUseMemoryCacheFallback()) {
    return memoryLocalCache();
  }
  return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
}

function buildTransportSettings() {
  // experimentalForceLongPolling a experimentalAutoDetectLongPolling jsou vzájemně exkluzivní.
  if (isSafariOrIos()) {
    return { experimentalForceLongPolling: true };
  }
  return { experimentalAutoDetectLongPolling: true };
}

function initDb(): Firestore {
  if (typeof window === 'undefined') {
    return getFirestore(app);
  }

  try {
    return initializeFirestore(app, {
      localCache: buildLocalCache(),
      ...buildTransportSettings(),
    });
  } catch {
    // HMR nebo druhý import — Firestore už může být inicializovaný.
    return getFirestore(app);
  }
}

export const db = initDb();

export default app;
