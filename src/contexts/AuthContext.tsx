'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User, UserSettings, Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

const ACCOUNT_SESSIONS_STORAGE_KEY = 'uctarna_account_sessions_v1';

interface StoredAccountSession {
  email: string;
  password: string;
  displayName: string | null;
  lastUsedAt: number;
}

interface SwitchableAccount {
  email: string;
  displayName: string | null;
  lastUsedAt: number;
}

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signOutUser: () => Promise<void>;
  rememberAccountSession: (email: string, password: string) => void;
  switchAccount: (email: string) => Promise<void>;
  switchableAccounts: SwitchableAccount[];
  updateUserSettings: (settings: Partial<UserSettings>) => Promise<void>;
  refreshUserStores: () => Promise<void>;
}

// Rozšířený User interface s prodejnami
interface ExtendedUser extends User {
  stores?: Store[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchableAccounts, setSwitchableAccounts] = useState<SwitchableAccount[]>([]);

  const loadStoredSessions = (): StoredAccountSession[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(ACCOUNT_SESSIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as StoredAccountSession[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => entry?.email && entry?.password);
    } catch {
      return [];
    }
  };

  const saveStoredSessions = (sessions: StoredAccountSession[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACCOUNT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    setSwitchableAccounts(
      sessions
        .map(({ email, displayName, lastUsedAt }) => ({ email, displayName, lastUsedAt }))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    );
  };

  const rememberAccountSession = (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;
    const sessions = loadStoredSessions();
    const existing = sessions.find((entry) => entry.email === normalizedEmail);
    const updated: StoredAccountSession = {
      email: normalizedEmail,
      password,
      displayName: existing?.displayName || null,
      lastUsedAt: Date.now(),
    };
    const next = [updated, ...sessions.filter((entry) => entry.email !== normalizedEmail)].slice(0, 10);
    saveStoredSessions(next);
  };

  const switchAccount = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    if ((auth.currentUser?.email || '').toLowerCase() === normalizedEmail) return;
    const sessions = loadStoredSessions();
    const target = sessions.find((entry) => entry.email === normalizedEmail);
    if (!target) throw new Error('Účet není uložený pro rychlé přepnutí.');

    setLoading(true);
    await signInWithEmailAndPassword(auth, target.email, target.password);
  };

  // Funkce pro načtení prodejen uživatele
  const loadUserStores = async (userId: string): Promise<Store[]> => {
    if (!userId) return [];
    
    try {
      const storesQuery = query(
        collection(db, 'users', userId, 'stores'),
        where('isActive', '==', true)
      );
      const storesSnapshot = await getDocs(storesQuery);
      const stores: Store[] = [];
      
      storesSnapshot.forEach((doc) => {
        const data = doc.data();
        stores.push({ 
          id: doc.id, 
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
        } as Store);
      });
      
      return stores;
    } catch (error: any) {
      console.error('Error loading user stores:', error);
      // Pokud je chyba oprávnění, vrátíme prázdný seznam
      if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
        console.log('Chyba oprávnění při načítání prodejen - uživatel pravděpodobně není správně přihlášen');
        return [];
      }
      return [];
    }
  };

  // Funkce pro obnovení prodejen
  const refreshUserStores = async () => {
    if (!firebaseUser || !firebaseUser.uid) return;
    
    try {
      const stores = await loadUserStores(firebaseUser.uid);
      if (user) {
        setUser({ ...user, stores });
      }
    } catch (error) {
      console.error('Error refreshing user stores:', error);
    }
  };

  useEffect(() => {
    const sessions = loadStoredSessions();
    setSwitchableAccounts(
      sessions
        .map(({ email, displayName, lastUsedAt }) => ({ email, displayName, lastUsedAt }))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    );
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setFirebaseUser(firebaseUser);
      
      if (firebaseUser && firebaseUser.uid) {
        try {
          // Nevyžaduj nucené obnovení tokenu při každém startu (zbytečně zpomaluje první načtení).
          await firebaseUser.getIdToken();

          // Zkus načíst uživatele z Firestore
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          if (userDoc.exists()) {
            const userData = userDoc.data() as User;
            // Nečekej na pomalejší načtení prodejen, aby se appka otevřela hned.
            setUser({ ...userData, stores: [] });
            setLoading(false);
            // Prodejny dotáhni až na pozadí.
            loadUserStores(firebaseUser.uid)
              .then((stores) => {
                setUser((prev) => (prev ? { ...prev, stores } : prev));
              })
              .catch((storesError) => {
                console.error('Error loading user stores:', storesError);
              });
            const sessions = loadStoredSessions();
            const idx = sessions.findIndex((entry) => entry.email === (firebaseUser.email || '').toLowerCase());
            if (idx >= 0) {
              sessions[idx] = {
                ...sessions[idx],
                displayName: userData.displayName || null,
                lastUsedAt: Date.now(),
              };
              saveStoredSessions(sessions);
            }
          } else {
            // Vytvoř nového uživatele - opraveno pro undefined displayName
            const newUser: ExtendedUser = {
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              displayName: firebaseUser.displayName || null, // Změněno z undefined na null
              createdAt: new Date(),
              settings: {
                eurRate: 25.0, // Výchozí kurz
                theme: 'auto',
              },
              stores: [], // Prázdný seznam prodejen pro nového uživatele
            };
            
            await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
            setUser(newUser);
            setLoading(false);
            const sessions = loadStoredSessions();
            const idx = sessions.findIndex((entry) => entry.email === (firebaseUser.email || '').toLowerCase());
            if (idx >= 0) {
              sessions[idx] = {
                ...sessions[idx],
                displayName: newUser.displayName || null,
                lastUsedAt: Date.now(),
              };
              saveStoredSessions(sessions);
            }
          }
        } catch (error: any) {
          console.error('Error loading user:', error);
          // Pokud je chyba oprávnění nebo dočasné selhání načtení profilu, neshazuj session.
          // Fallback na Firebase user zajistí okamžitý přechod z loginu.
          if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
            console.log('Chyba oprávnění - uživatel pravděpodobně není správně přihlášen');
          }

          const fallbackUser: ExtendedUser = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || null,
            createdAt: new Date(),
            settings: {
              eurRate: 25.0,
              theme: 'auto',
            },
            stores: [],
          };
          setUser(fallbackUser);

          // Pokus o tiché dočtení prodejen na pozadí
          try {
            const stores = await loadUserStores(firebaseUser.uid);
            setUser((prev) => (prev ? { ...prev, stores } : prev));
          } catch (storesError) {
            console.error('Error loading stores after fallback:', storesError);
          }
        }
      } else {
        setUser(null);
        setLoading(false);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signOutUser = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const updateUserSettings = async (settings: Partial<UserSettings>) => {
    if (!user) return;
    
    try {
      const updatedUser = { ...user, settings: { ...user.settings, ...settings } };
      await setDoc(doc(db, 'users', user.uid), updatedUser);
      setUser(updatedUser);
    } catch (error) {
      console.error('Error updating user settings:', error);
    }
  };

  const value: AuthContextType = {
    user,
    firebaseUser,
    loading,
    signOutUser,
    rememberAccountSession,
    switchAccount,
    switchableAccounts,
    updateUserSettings,
    refreshUserStores,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
