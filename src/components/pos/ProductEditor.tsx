'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, onSnapshot, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Product } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit, Trash2, Save, X, Package } from 'lucide-react';

interface ProductEditorProps {
  storeId: string;
  onClose: () => void;
}

export const ProductEditor: React.FC<ProductEditorProps> = ({ storeId, onClose }) => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Načtení produktů
  useEffect(() => {
    if (!user || !storeId) return;

    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'products')
    );

    const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
      const productsData: Product[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        const product: Product = {
          id: doc.id,
          name: data.name || 'Neznámý produkt',
          price: data.price || 0,
          category: data.category,
          isPopular: data.isPopular || false,
          soldCount: data.soldCount || 0,
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
          updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
        };
        
        productsData.push(product);
      });
      
      // Seřadit podle názvu
      const sortedProducts = productsData.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      setProducts(sortedProducts);
      setLoading(false);
    }, (error) => {
      console.error('❌ Error loading products:', error);
      setLoading(false);
    });

    return unsubscribe;
  }, [user, storeId]);

  // Zahájení editace produktu
  const startEditing = (product: Product) => {
    setEditingProduct(product);
    setEditName(product.name);
    setEditPrice(product.price);
  };

  // Zrušení editace
  const cancelEditing = () => {
    setEditingProduct(null);
    setEditName('');
    setEditPrice(0);
  };

  // Uložení změn
  const saveProduct = async () => {
    if (!user || !storeId || !editingProduct) return;

    setSaving(true);
    try {
      const productRef = doc(db, 'users', user.uid, 'stores', storeId, 'products', editingProduct.id);
      
      await updateDoc(productRef, {
        name: editName.trim(),
        price: editPrice,
        updatedAt: new Date()
      });

      console.log('✅ Produkt úspěšně upraven:', editingProduct.id);
      cancelEditing();
    } catch (error) {
      console.error('❌ Chyba při úpravě produktu:', error);
      alert('Chyba při úpravě produktu. Zkuste to znovu.');
    } finally {
      setSaving(false);
    }
  };

  // Smazání produktu
  const deleteProduct = async (productId: string) => {
    if (!user || !storeId) return;

    if (!confirm('Opravdu chcete smazat tento produkt? Tato akce je nevratná.')) {
      return;
    }

    setDeleting(productId);
    try {
      const productRef = doc(db, 'users', user.uid, 'stores', storeId, 'products', productId);
      await deleteDoc(productRef);

      console.log('✅ Produkt úspěšně smazán:', productId);
    } catch (error) {
      console.error('❌ Chyba při mazání produktu:', error);
      alert('Chyba při mazání produktu. Zkuste to znovu.');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
          <p className="text-center mt-4 text-gray-600 dark:text-gray-400">Načítání produktů...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <Package className="h-6 w-6 text-purple-600 mr-3" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Editor produktů
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {products.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Žádné produkty
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Zatím nejsou žádné produkty k editaci.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map((product) => (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
                >
                  {editingProduct?.id === product.id ? (
                    // Edit mode
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Název
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="Název produktu"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Cena (Kč)
                        </label>
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(Number(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          placeholder="0"
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={saveProduct}
                          disabled={saving || !editName.trim() || editPrice <= 0}
                          className="flex-1 bg-green-600 text-white py-2 px-3 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {saving ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          ) : (
                            <Save className="h-4 w-4 mr-2" />
                          )}
                          Uložit
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="flex-1 bg-gray-500 text-white py-2 px-3 rounded-lg font-medium hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
                        >
                          <X className="h-4 w-4 mr-2" />
                          Zrušit
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-white text-lg">
                          {product.name}
                        </h3>
                        <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                          {product.price} Kč
                        </p>
                      </div>
                      
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        <p>Prodáno: {product.soldCount || 0}×</p>
                        <p>Kategorie: {product.category || 'Nespecifikováno'}</p>
                        {product.isPopular && (
                          <p className="text-green-600 dark:text-green-400 font-medium">⭐ Populární</p>
                        )}
                      </div>

                      <div className="flex space-x-2">
                        <button
                          onClick={() => startEditing(product)}
                          className="flex-1 bg-blue-600 text-white py-2 px-3 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Upravit
                        </button>
                        <button
                          onClick={() => deleteProduct(product.id)}
                          disabled={deleting === product.id}
                          className="flex-1 bg-red-600 text-white py-2 px-3 rounded-lg font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {deleting === product.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          ) : (
                            <Trash2 className="h-4 w-4 mr-2" />
                          )}
                          Smazat
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Celkem {products.length} produktů
          </p>
          <button
            onClick={onClose}
            className="bg-gray-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
          >
            Zavřít
          </button>
        </div>
      </motion.div>
    </div>
  );
};
