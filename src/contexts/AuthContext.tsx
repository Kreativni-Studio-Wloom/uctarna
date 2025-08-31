'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User, UserSettings, Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signOutUser: () => Promise<void>;
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

  // Funkce pro načtení prodejen uživatele
  const loadUserStores = async (userId: string): Promise<Store[]> => {
    try {
      const storesQuery = query(
        collection(db, 'users', userId, 'stores'),
        where('isActive', '==', true)
      );
      const storesSnapshot = await getDocs(storesQuery);
      const stores: Store[] = [];
      
      storesSnapshot.forEach((doc) => {
        stores.push({ id: doc.id, ...doc.data() } as Store);
      });
      
      return stores;
    } catch (error) {
      console.error('Error loading user stores:', error);
      return [];
    }
  };

  // Funkce pro obnovení prodejen
  const refreshUserStores = async () => {
    if (!firebaseUser) return;
    
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setFirebaseUser(firebaseUser);
      
      if (firebaseUser) {
        try {
          // Zkus načíst uživatele z Firestore
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          if (userDoc.exists()) {
            const userData = userDoc.data() as User;
            // Načti prodejny uživatele
            const stores = await loadUserStores(firebaseUser.uid);
            setUser({ ...userData, stores });
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
          }
        } catch (error) {
          console.error('Error loading user:', error);
        }
      } else {
        setUser(null);
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
    updateUserSettings,
    refreshUserStores,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
