'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Store as StoreIcon, LogOut, Settings, User, Trash2 } from 'lucide-react';
import { StoreCard } from './StoreCard';
import { AddStoreModal } from './AddStoreModal';
import { UserMenu } from './UserMenu';

export const Dashboard: React.FC = () => {
  const { user, signOutUser } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;

    const storesQuery = query(
      collection(db, 'users', user.uid, 'stores'),
      where('isActive', '==', true)
    );

    const unsubscribe = onSnapshot(storesQuery, async (snapshot) => {
      const storesData: Store[] = [];
      const updates: Promise<any>[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const storeWithDefaults = {
          id: doc.id, 
          ...data,
          type: data.type || 'prodejna',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
        } as Store;
        storesData.push(storeWithDefaults);
        // Backfill typu prodejny pro existující záznamy
        if (!data.type) {
          updates.push(updateDoc(doc.ref, { type: 'prodejna' }));
        }
      });
      setStores(storesData);
      setLoading(false);
      if (updates.length > 0) {
        try { await Promise.allSettled(updates); } catch {}
      }
    });

    return unsubscribe;
  }, [user]);

  const handleAddStore = async (storeName: string, type: 'prodejna' | 'bistro') => {
    if (!user) return;

    try {
      const newStore: Omit<Store, 'id'> = {
        name: storeName,
        type,
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

  const handleDeleteSelectedStores = async () => {
    if (!user || selectedStores.length === 0) return;

    setDeleting(true);
    try {
      // Označit vybrané prodejny jako neaktivní místo fyzického smazání
      const deletePromises = selectedStores.map(storeId => 
        updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
          isActive: false,
          updatedAt: serverTimestamp()
        })
      );

      await Promise.all(deletePromises);
      setShowDeleteModal(false);
      setSelectedStores([]);
    } catch (error) {
      console.error('Error deleting stores:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleStoreSelect = (storeId: string) => {
    setSelectedStores(prev => 
      prev.includes(storeId) 
        ? prev.filter(id => id !== storeId)
        : [...prev, storeId]
    );
  };

  const handleSelectAll = () => {
    if (selectedStores.length === stores.length) {
      setSelectedStores([]);
    } else {
      setSelectedStores(stores.map(store => store.id));
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
            <div className="flex space-x-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowAddStore(true)}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 shadow-lg flex items-center"
              >
                <Plus className="h-5 w-5 mr-2" />
                Nová prodejna
              </motion.button>
              
              {stores.length > 0 && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDeleteModal(true)}
                  className="bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 shadow-lg flex items-center"
                >
                  <Trash2 className="h-5 w-5 mr-2" />
                  Odstranit prodejny
                </motion.button>
              )}
            </div>
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

      {/* Delete Stores Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mr-4">
                  <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Vyberte prodejny k odstranění
                </h3>
              </div>
              
              <div className="flex items-center justify-between mb-4">
                <p className="text-gray-600 dark:text-gray-400">
                  Označte prodejny, které chcete odstranit
                </p>
                <button
                  onClick={handleSelectAll}
                  className="text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium"
                >
                  {selectedStores.length === stores.length ? 'Odznačit vše' : 'Označit vše'}
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto mb-6">
                <div className="space-y-3">
                  {stores.map((store) => (
                    <div
                      key={store.id}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedStores.includes(store.id)
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                      onClick={() => handleStoreSelect(store.id)}
                    >
                      <div className="flex items-center">
                        <div className={`w-5 h-5 rounded border-2 mr-3 flex items-center justify-center ${
                          selectedStores.includes(store.id)
                            ? 'border-red-500 bg-red-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {selectedStores.includes(store.id) && (
                            <div className="w-2 h-2 bg-white rounded-full"></div>
                          )}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900 dark:text-white">
                            {store.name}
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Vytvořeno {new Intl.DateTimeFormat('cs-CZ', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            }).format(store.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedStores([]);
                  }}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  onClick={handleDeleteSelectedStores}
                  disabled={deleting || selectedStores.length === 0}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {deleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Odstraňuji...
                    </>
                  ) : (
                    `Odstranit (${selectedStores.length})`
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
