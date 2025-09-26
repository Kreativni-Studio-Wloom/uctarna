'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Product } from '@/types';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface SelectExtrasModalProps {
  storeId: string;
  onClose: () => void;
  onSelect: (selectedExtraProducts: Product[]) => void;
}

export const SelectExtrasModal: React.FC<SelectExtrasModalProps> = ({ storeId, onClose, onSelect }) => {
  const { user } = useAuth();
  const [extras, setExtras] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

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
    });
    return unsubscribe;
  }, [user, storeId]);

  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return extras;
    return extras.filter((e) => e.name.toLowerCase().includes(n));
  }, [extras, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const confirm = () => {
    const picked = extras.filter((e) => selected.has(e.id));
    onSelect(picked);
    onClose();
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
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <ListPlus className="h-6 w-6 text-purple-600 mr-3" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Vybrat extras</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          <div className="p-5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hledat extras"
              className="w-full mb-4 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />

            <div className="max-h-80 overflow-y-auto space-y-2">
              {filtered.map((e) => {
                const active = selected.has(e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => toggle(e.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      active ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600'
                    }`}
                  >
                    <div className="font-medium text-gray-900 dark:text-white">{e.name}</div>
                    <div className="text-purple-600 dark:text-purple-400 font-semibold">{e.price} Kč</div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center py-6 text-gray-500 dark:text-gray-400">Žádné extras</div>
              )}
            </div>

            <div className="pt-4 text-right">
              <button onClick={confirm} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50" disabled={selected.size === 0}>
                Přidat vybrané
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};


