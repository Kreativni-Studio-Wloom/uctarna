import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
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

function initDb(): Firestore {
  if (typeof window === 'undefined') {
    return getFirestore(app);
  }

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // HMR nebo druhý import — Firestore už může být inicializovaný.
    return getFirestore(app);
  }
}

export const db = initDb();

export default app;
