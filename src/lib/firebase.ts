import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAgpiNUApg_z3T98WnQem5Y6T9EOx6U_r4",
  authDomain: "prodejni-system-uctarna.firebaseapp.com",
  projectId: "prodejni-system-uctarna",
  storageBucket: "prodejni-system-uctarna.firebasestorage.app",
  messagingSenderId: "789375134911",
  appId: "1:789375134911:web:8f0fcfbbc57f852f6e2a0a",
  measurementId: "G-7Y0V0WVWJP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
