'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Package, Plus, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Product } from '@/types';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ExtrasManagerModalProps {
  storeId: string;
  onClose: () => void;
}

export const ExtrasManagerModal: React.FC<ExtrasManagerModalProps> = ({ storeId, onClose }) => {
  const { user } = useAuth();
  const [extras, setExtras] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [cost, setCost] = useState<number | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingPrice, setEditingPrice] = useState<number>(0);
  const [editingCost, setEditingCost] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!user || !storeId) return;
    const productsRef = collection(db, 'users', user.uid, 'stores', storeId, 'products');
    const q = query(productsRef, where('isExtra', '==', true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Product[] = snapshot.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          name: v.name || 'Extra',
          price: v.price || 0,
          cost: v.cost,
          category: v.category,
          isPopular: v.isPopular || false,
          soldCount: v.soldCount || 0,
          createdAt: v.createdAt?.toDate?.() || new Date(),
          updatedAt: v.updatedAt?.toDate?.() || new Date(),
          isExtra: true,
        } as Product;
      }).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      setExtras(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [user, storeId]);

  const handleAdd = async () => {
    if (!user || !storeId) return;
    if (!name.trim()) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'products'), {
        name: name.trim(),
        price: Number(price) || 0,
        cost: typeof cost === 'number' ? cost : null,
        isExtra: true,
        isPopular: false,
        soldCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setName('');
      setPrice(0);
      setCost(undefined);
    } catch (e) {
      console.error('Failed to add extra', e);
    }
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditingName(p.name);
    setEditingPrice(p.price);
    setEditingCost(p.cost);
  };

  const saveEdit = async () => {
    if (!user || !storeId || !editingId) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId, 'products', editingId), {
        name: editingName.trim(),
        price: Number(editingPrice) || 0,
        cost: typeof editingCost === 'number' ? editingCost : null,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
    } catch (e) {
      console.error('Failed to update extra', e);
    }
  };

  const removeExtra = async (id: string) => {
    if (!user || !storeId) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'stores', storeId, 'products', id));
    } catch (e) {
      console.error('Failed to delete extra', e);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <Package className="h-6 w-6 text-purple-600 mr-3" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Správa extras</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-6">
            {/* Add form */}
            <div className="bg-gray-50 dark:bg-gray-900/20 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Název extra"
                  className="md:col-span-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                  placeholder="Prodejní cena"
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <input
                  type="number"
                  value={typeof cost === 'number' ? cost : ''}
                  onChange={(e) => setCost(e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="Nákupní cena (volitelné)"
                  className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="mt-3 text-right">
                <button onClick={handleAdd} className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                  <Plus className="h-4 w-4 mr-2" /> Přidat extra
                </button>
              </div>
            </div>

            {/* List */}
            <div>
              {loading ? (
                <div className="py-8 text-center text-gray-500 dark:text-gray-400">Načítání...</div>
              ) : extras.length === 0 ? (
                <div className="py-8 text-center text-gray-500 dark:text-gray-400">Zatím žádná extras</div>
              ) : (
                <div className="space-y-2">
                  {extras.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                      {editingId === p.id ? (
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2 mr-3">
                          <input value={editingName} onChange={(e) => setEditingName(e.target.value)} className="md:col-span-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                          <input type="number" value={editingPrice} onChange={(e) => setEditingPrice(parseFloat(e.target.value) || 0)} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                          <input type="number" value={typeof editingCost === 'number' ? editingCost : ''} onChange={(e) => setEditingCost(e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                        </div>
                      ) : (
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-2 mr-3">
                          <div className="md:col-span-2 font-medium text-gray-900 dark:text-white">{p.name}</div>
                          <div className="text-gray-700 dark:text-gray-300">{p.price} Kč</div>
                          <div className="text-gray-500 dark:text-gray-400">{typeof p.cost === 'number' ? `${p.cost} Kč` : '-'}</div>
                        </div>
                      )}
                      <div className="flex items-center space-x-2">
                        {editingId === p.id ? (
                          <>
                            <button onClick={saveEdit} className="px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700">Uložit</button>
                            <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">Zrušit</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(p)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                              <Pencil className="h-4 w-4 text-gray-600" />
                            </button>
                            <button onClick={() => removeExtra(p.id)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};


