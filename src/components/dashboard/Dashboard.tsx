'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Store as StoreIcon, LogOut, Settings, User } from 'lucide-react';
import { StoreCard } from './StoreCard';
import { AddStoreModal } from './AddStoreModal';
import { UserMenu } from './UserMenu';

export const Dashboard: React.FC = () => {
  const { user, signOutUser } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (!user) return;

    const storesQuery = query(
      collection(db, 'users', user.uid, 'stores'),
      where('isActive', '==', true)
    );

    const unsubscribe = onSnapshot(storesQuery, (snapshot) => {
      const storesData: Store[] = [];
      snapshot.forEach((doc) => {
        storesData.push({ id: doc.id, ...doc.data() } as Store);
      });
      setStores(storesData);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  const handleAddStore = async (storeName: string) => {
    if (!user) return;

    try {
      const newStore: Omit<Store, 'id'> = {
        name: storeName,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };

      await addDoc(collection(db, 'users', user.uid, 'stores'), {
        ...newStore,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setShowAddStore(false);
    } catch (error) {
      console.error('Error adding store:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <StoreIcon className="h-8 w-8 text-purple-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Účtárna
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <User className="h-6 w-6 text-gray-600 dark:text-gray-300" />
                </button>
                {showUserMenu && <UserMenu onClose={() => setShowUserMenu(false)} />}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                Moje prodejny
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Spravujte své prodejny a prodeje
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddStore(true)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 shadow-lg flex items-center"
            >
              <Plus className="h-5 w-5 mr-2" />
              Nová prodejna
            </motion.button>
          </div>

          {stores.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12"
            >
              <StoreIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Zatím nemáte žádné prodejny
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Vytvořte svou první prodejnu a začněte prodávat
              </p>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowAddStore(true)}
                className="bg-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors"
              >
                Vytvořit první prodejnu
              </motion.button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence>
                {stores.map((store, index) => (
                  <motion.div
                    key={store.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <StoreCard store={store} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>

      {/* Add Store Modal */}
      <AnimatePresence>
        {showAddStore && (
          <AddStoreModal
            onClose={() => setShowAddStore(false)}
            onAdd={handleAddStore}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
