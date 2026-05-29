'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, query, where, onSnapshot, getDocs, getDocsFromCache } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User, UserSettings, Store } from '@/types';

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

function buildFallbackUser(firebaseUser: FirebaseUser): ExtendedUser {
  return {
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
}

function mapStoreDocs(snapshot: { forEach: (fn: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void }): Store[] {
  const stores: Store[] = [];
  snapshot.forEach((storeDoc) => {
    const data = storeDoc.data();
    stores.push({
      id: storeDoc.id,
      ...data,
      createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.() || new Date(),
      updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.() || new Date(),
    } as Store);
  });
  return stores;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchableAccounts, setSwitchableAccounts] = useState<SwitchableAccount[]>([]);
  const creatingUserRef = useRef(false);

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

  const touchStoredSession = (email: string, displayName: string | null) => {
    const sessions = loadStoredSessions();
    const idx = sessions.findIndex((entry) => entry.email === email.toLowerCase());
    if (idx < 0) return;
    sessions[idx] = {
      ...sessions[idx],
      displayName,
      lastUsedAt: Date.now(),
    };
    saveStoredSessions(sessions);
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

  const loadUserStores = async (userId: string): Promise<Store[]> => {
    if (!userId) return [];

    const storesQuery = query(
      collection(db, 'users', userId, 'stores'),
      where('isActive', '==', true)
    );

    try {
      const cachedSnapshot = await getDocsFromCache(storesQuery);
      if (!cachedSnapshot.empty) {
        return mapStoreDocs(cachedSnapshot);
      }
    } catch {
      // Cache miss — pokračuj na síť na pozadí.
    }

    try {
      const snapshot = await getDocs(storesQuery);
      return mapStoreDocs(snapshot);
    } catch (error: unknown) {
      console.error('Error loading user stores:', error);
      return [];
    }
  };

  const refreshUserStores = useCallback(async () => {
    if (!firebaseUser?.uid) return;

    try {
      const stores = await loadUserStores(firebaseUser.uid);
      setUser((prev) => (prev ? { ...prev, stores } : prev));
    } catch (error) {
      console.error('Error refreshing user stores:', error);
    }
  }, [firebaseUser]);

  const signOutUser = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }, []);

  const updateUserSettings = useCallback(async (settings: Partial<UserSettings>) => {
    if (!user) return;

    try {
      const updatedUser = { ...user, settings: { ...user.settings, ...settings } };
      await setDoc(doc(db, 'users', user.uid), updatedUser);
      setUser(updatedUser);
    } catch (error) {
      console.error('Error updating user settings:', error);
    }
  }, [user]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    firebaseUser,
    loading,
    signOutUser,
    rememberAccountSession,
    switchAccount,
    switchableAccounts,
    updateUserSettings,
    refreshUserStores,
  }), [
    user,
    firebaseUser,
    loading,
    signOutUser,
    switchableAccounts,
    updateUserSettings,
    refreshUserStores,
  ]);

  useEffect(() => {
    const sessions = loadStoredSessions();
    setSwitchableAccounts(
      sessions
        .map(({ email, displayName, lastUsedAt }) => ({ email, displayName, lastUsedAt }))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    );
  }, []);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | undefined;

    const ensureUserDocument = async (firebaseUser: FirebaseUser) => {
      if (creatingUserRef.current) return;
      creatingUserRef.current = true;
      try {
        const newUser = buildFallbackUser(firebaseUser);
        await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
        setUser(newUser);
        touchStoredSession((firebaseUser.email || '').toLowerCase(), newUser.displayName || null);
      } catch (error) {
        console.error('Error creating user document:', error);
      } finally {
        creatingUserRef.current = false;
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (nextFirebaseUser) => {
      setFirebaseUser(nextFirebaseUser);
      unsubscribeUserDoc?.();
      unsubscribeUserDoc = undefined;

      if (!nextFirebaseUser?.uid) {
        setUser(null);
        setLoading(false);
        return;
      }

      const fallbackUser = buildFallbackUser(nextFirebaseUser);
      setUser(fallbackUser);
      setLoading(false);

      void nextFirebaseUser.getIdToken().catch(() => {});

      const userRef = doc(db, 'users', nextFirebaseUser.uid);
      unsubscribeUserDoc = onSnapshot(
        userRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const userData = snapshot.data() as User;
            setUser({ ...userData, stores: [] });
            touchStoredSession((nextFirebaseUser.email || '').toLowerCase(), userData.displayName || null);
            return;
          }

          if (snapshot.metadata.fromCache) {
            return;
          }

          void ensureUserDocument(nextFirebaseUser);
        },
        (error) => {
          console.error('Error loading user profile:', error);
          setUser(fallbackUser);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeUserDoc?.();
    };
  }, []);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
