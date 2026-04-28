'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, deleteDoc, updateDoc, getDocs, writeBatch, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Store as StoreIcon, User, Trash2 } from 'lucide-react';
import { StoreCard } from './StoreCard';
import { AddStoreModal } from './AddStoreModal';
import { UserMenu } from './UserMenu';
import { UserSettingsModal } from './UserSettingsModal';

export const Dashboard: React.FC = () => {
  const { user, signOutUser } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddStore, setShowAddStore] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [storeToDuplicate, setStoreToDuplicate] = useState<Store | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const userMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user || !user.uid) return;

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
    }, (error: any) => {
      console.error('Error loading stores:', error);
      // Pokud je chyba oprávnění, zobrazíme prázdný seznam
      if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
        console.log('Chyba oprávnění při načítání prodejen - uživatel pravděpodobně není správně přihlášen');
        setStores([]);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [user]);

  // Zavřít user menu po kliknutí mimo
  useEffect(() => {
    if (!showUserMenu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (userMenuContainerRef.current?.contains(target)) return;
      setShowUserMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [showUserMenu]);

  // Zavřít menu po kliknutí mimo
  useEffect(() => {
    if (!showMenu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuDropdownRef.current?.contains(target)) return;
      setShowMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [showMenu]);

  const handleAddStore = async (storeName: string, type: 'prodejna' | 'bistro') => {
    if (!user) return;

    try {
      const newStore: Omit<Store, 'id'> = {
        name: storeName,
        type,
        companyName: '',
        ico: '',
        companyAddress: '',
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

  const handleDuplicateStore = (store: Store) => {
    setStoreToDuplicate(store);
    setShowDuplicateModal(true);
  };

  const duplicateStore = async () => {
    if (!user || !storeToDuplicate) return;

    setDuplicating(true);
    try {
      const batch = writeBatch(db);
      
      // Vytvořit novou prodejnu s názvem "Název 2"
      const newStoreName = `${storeToDuplicate.name} 2`;
      const newStoreRef = doc(collection(db, 'users', user.uid, 'stores'));
      
      const newStore = {
        name: newStoreName,
        type: storeToDuplicate.type,
        companyName: storeToDuplicate.companyName || '',
        ico: storeToDuplicate.ico || '',
        companyAddress: storeToDuplicate.companyAddress || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isActive: true,
        eurRate: 25.0, // Výchozí kurz EUR
      };
      
      batch.set(newStoreRef, newStore);
      
      // Získat všechny produkty z původní prodejny
      const productsQuery = query(
        collection(db, 'users', user.uid, 'stores', storeToDuplicate.id, 'products')
      );
      const productsSnapshot = await getDocs(productsQuery);
      
      // Duplikovat produkty
      productsSnapshot.forEach((productDoc) => {
        const productData = productDoc.data();
        const newProductRef = doc(collection(db, 'users', user.uid, 'stores', newStoreRef.id, 'products'));
        
        const newProduct = {
          ...productData,
          soldCount: 0, // Resetovat počet prodaných kusů
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        
        batch.set(newProductRef, newProduct);
      });
      
      // Získat všechny prodeje z původní prodejny
      const salesQuery = query(
        collection(db, 'users', user.uid, 'stores', storeToDuplicate.id, 'sales')
      );
      const salesSnapshot = await getDocs(salesQuery);
      
      // Duplikovat prodeje
      salesSnapshot.forEach((saleDoc) => {
        const saleData = saleDoc.data();
        const newSaleRef = doc(collection(db, 'users', user.uid, 'stores', newStoreRef.id, 'sales'));
        
        const newSale = {
          ...saleData,
          createdAt: serverTimestamp(),
        };
        
        batch.set(newSaleRef, newSale);
      });
      
      // Získat nastavení prodejny (kurz EUR atd.)
      const storeDocRef = doc(db, 'users', user.uid, 'stores', storeToDuplicate.id);
      const storeDoc = await getDoc(storeDocRef);
      if (storeDoc.exists()) {
        const storeData = storeDoc.data();
        if (storeData.eurRate) {
          batch.update(newStoreRef, { eurRate: storeData.eurRate });
        }
      }
      
      // Provedení všech změn
      await batch.commit();
      
      setShowDuplicateModal(false);
      setStoreToDuplicate(null);
    } catch (error) {
      console.error('Error duplicating store:', error);
      alert('Chyba při duplikaci prodejny. Zkuste to znovu.');
    } finally {
      setDuplicating(false);
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
      <header className="sticky top-0 z-50 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            <div className="flex items-center">
              <StoreIcon className="h-6 w-6 sm:h-8 sm:w-8 text-purple-600 mr-2 sm:mr-3" />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                Účtárna
              </h1>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-4">
              <div ref={userMenuContainerRef} className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center"
                >
                  <User className="h-5 w-5 sm:h-6 sm:w-6 text-gray-600 dark:text-gray-300" />
                </button>
                {showUserMenu && (
                  <UserMenu
                    onClose={() => setShowUserMenu(false)}
                    onOpenSettings={() => setShowUserSettings(true)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-8">
          <div className="flex justify-between items-start mb-6 gap-3">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                Moje prodejny
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Spravujte své prodejny a prodeje
              </p>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                ref={menuButtonRef}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center text-gray-600 dark:text-gray-300"
              >
                <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              {showMenu && (
                <div
                  ref={menuDropdownRef}
                  className="absolute top-12 sm:top-14 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl z-50 min-w-56 max-w-xs p-2"
                >
                  <button
                    onClick={() => {
                      setShowAddStore(true);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors flex items-center text-sm font-medium"
                  >
                    <span className="w-8 flex items-center justify-center flex-shrink-0">
                      <Plus className="w-5 h-5" />
                    </span>
                    <span className="truncate">Nová provozovna</span>
                  </button>
                  {stores.length > 0 && (
                    <button
                      onClick={() => {
                        setShowDeleteModal(true);
                        setShowMenu(false);
                      }}
                      className="w-full mt-1 text-left px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors flex items-center text-sm font-medium"
                    >
                      <span className="w-8 flex items-center justify-center flex-shrink-0">
                        <Trash2 className="w-5 h-5" />
                      </span>
                      <span className="truncate">Smazat provozovny</span>
                    </button>
                  )}
                </div>
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
                className="bg-purple-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors text-sm sm:text-base"
              >
                <span className="hidden sm:inline">Vytvořit první prodejnu</span>
                <span className="sm:hidden">Vytvořit prodejnu</span>
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
                    <StoreCard store={store} onDuplicate={handleDuplicateStore} />
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

      <AnimatePresence>
        {showUserSettings && (
          <UserSettingsModal onClose={() => setShowUserSettings(false)} />
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

      {/* Duplicate Store Modal */}
      <AnimatePresence>
        {showDuplicateModal && storeToDuplicate && (
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
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
            >
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mr-4">
                  <StoreIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Duplikovat prodejnu
                </h3>
              </div>
              
              <div className="mb-6">
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Chcete duplikovat prodejnu <strong>"{storeToDuplicate.name}"</strong>?
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Bude vytvořena nová prodejna s názvem <strong>"{storeToDuplicate.name} 2"</strong> včetně všech produktů, prodejů a nastavení.
                </p>
              </div>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowDuplicateModal(false);
                    setStoreToDuplicate(null);
                  }}
                  disabled={duplicating}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  onClick={duplicateStore}
                  disabled={duplicating}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {duplicating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Duplikuji...
                    </>
                  ) : (
                    'Duplikovat'
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
