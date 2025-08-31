'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Package, Upload, CheckCircle, AlertCircle } from 'lucide-react';

interface BulkImportModalProps {
  onClose: () => void;
  onImport: (products: Array<{ name: string; price: number }>) => Promise<void>;
}

// Předdefinované produkty pro "Ráj krystalů"
const predefinedProducts = [
  { name: 'Růženín polished', price: 50.0 },
  { name: 'Křišťál raw', price: 45.0 },
  { name: 'Růženín raw', price: 45.0 },
  { name: 'Křišťál polished', price: 50.0 },
  { name: 'Ametyst polished', price: 50.0 },
  { name: 'Ametyst raw', price: 30.0 },
  { name: 'Tygří oko raw', price: 45.0 },
  { name: 'Tygří oko polished', price: 50.0 },
  { name: 'Citrín raw', price: 45.0 },
  { name: 'Citrín polished', price: 50.0 },
  { name: 'Kalcit polished', price: 65.0 },
  { name: 'Kalcit raw', price: 55.0 },
  { name: 'Avanturín polished', price: 65.0 },
  { name: 'Avanturín raw', price: 55.0 },
  { name: 'Achát polished', price: 65.0 },
  { name: 'Achát raw', price: 55.0 },
  { name: 'Strawberry polished', price: 65.0 },
  { name: 'Strawberry raw', price: 55.0 },
  { name: 'Opalit raw', price: 55.0 },
  { name: 'Opalit polished', price: 65.0 },
  { name: 'Karneol raw', price: 55.0 },
  { name: 'Karneol polished', price: 65.0 },
  { name: 'Chalcedon polished', price: 65.0 },
  { name: 'Chalcedon raw', price: 55.0 },
  { name: 'Labradorit polished', price: 65.0 },
  { name: 'Labradorit raw', price: 55.0 },
  { name: 'Lapis polished', price: 65.0 },
  { name: 'Lapis raw', price: 55.0 },
  { name: 'Unakit raw', price: 55.0 },
  { name: 'Unakit polished', price: 65.0 },
  { name: 'Amazonit raw', price: 55.0 },
  { name: 'Amazonit polished', price: 65.0 },
  { name: 'Obsidián raw', price: 55.0 },
  { name: 'Obsidián polished', price: 65.0 },
  { name: 'Fluorit polished', price: 65.0 },
  { name: 'Fluorit raw', price: 55.0 },
  { name: 'Akvamarín polished', price: 65.0 },
  { name: 'Akvamarín raw', price: 55.0 },
  { name: 'Pukaný křišťál', price: 65.0 },
  { name: 'Geoda', price: 179.0 },
  { name: 'Náramek krystal', price: 89.0 },
  { name: 'Zlato malé', price: 89.0 },
  { name: 'Zlato velké', price: 149.0 },
  { name: 'Mušle s perlou', price: 149.0 },
  { name: 'Náramek rybička', price: 99.0 },
  { name: 'Řetízek', price: 149.0 },
  { name: 'Matching krystal řetízky', price: 179.0 },
  { name: 'Matching stuff', price: 139.0 },
  { name: 'Prstýnek', price: 90.0 },
  { name: 'Kyvadlo', price: 99.0 },
  { name: 'Mince', price: 25.0 },
  { name: 'Kůže', price: 50.0 },
  { name: 'Srdce', price: 119.0 },
  { name: 'Andělíček', price: 139.0 },
  { name: 'Kočka', price: 139.0 },
  { name: 'Náušnice', price: 149.0 },
  { name: 'Svíčka mini', price: 129.0 },
  { name: 'Svíčka koule', price: 179.0 },
  { name: 'Svíčka velká', price: 289.0 },
  { name: 'Svíčka mix', price: 229.0 },
  { name: 'Nábrus', price: 65.0 },
  { name: 'Opalit big', price: 275.0 },
  { name: 'Ruzenin big', price: 250.0 },
  { name: 'Dýška kartou', price: 1.0 },
  { name: 'Svíčka treewick malá', price: 289.0 },
  { name: 'Svíčka treewick velká', price: 379.0 },
  { name: 'Taška', price: 8.0 },
  { name: 'Dřevěný držák', price: 65.0 },
  { name: 'Selenit držák', price: 139.0 },
  { name: 'Selenit', price: 65.0 },
  { name: 'Tyčinky', price: 55.0 },
  { name: 'Hrnicek', price: 149.0 },
  { name: 'Vetsi hrnicek', price: 169.0 },
  { name: 'Stojan drevo', price: 65.0 },
  { name: 'Stojan selenit', price: 139.0 },
  { name: 'Svíčka se srdíčkem', price: 169.0 },
  { name: 'Klíčenka', price: 75.0 },
  { name: 'Lapač slunce', price: 180.0 },
  { name: 'Palo santo', price: 55.0 },
  { name: 'Vykuřovadlo', price: 95.0 },
  { name: 'Apatit raw', price: 55.0 },
  { name: 'Apatit polished', price: 65.0 },
  { name: 'Kalíšek svíčka', price: 65.0 }
];

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ onClose, onImport }) => {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const handleSelectAll = () => {
    if (selectedProducts.size === predefinedProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(predefinedProducts.map(p => p.name)));
    }
  };

  const handleProductToggle = (productName: string) => {
    const newSelected = new Set(selectedProducts);
    if (newSelected.has(productName)) {
      newSelected.delete(productName);
    } else {
      newSelected.add(productName);
    }
    setSelectedProducts(newSelected);
  };

  const handleImport = async () => {
    if (selectedProducts.size === 0) return;

    setLoading(true);
    setError(null);
    
    try {
      const productsToImport = predefinedProducts.filter(p => selectedProducts.has(p.name));
      await onImport(productsToImport);
      setImported(productsToImport.length);
      
      // Počkej 2 sekundy a zavři modal
      setTimeout(() => {
        onClose();
      }, 2000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba při importu');
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectedProducts.size;
  const totalCount = predefinedProducts.length;

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
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Upload className="h-6 w-6 text-white mr-3" />
                <h2 className="text-xl font-semibold text-white">
                  Hromadný import produktů - Ráj krystalů
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-white hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-white hover:bg-opacity-20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {imported > 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Import úspěšný!
                </h3>
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  Úspěšně importováno {imported} produktů
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-600">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                      Přehled importu
                    </h3>
                    <button
                      onClick={handleSelectAll}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      {selectedCount === totalCount ? 'Odznačit vše' : 'Označit vše'}
                    </button>
                  </div>
                  <p className="text-blue-700 dark:text-blue-300">
                    Vybráno {selectedCount} z {totalCount} produktů
                  </p>
                </div>

                {/* Error message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-600">
                    <div className="flex items-center">
                      <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
                      <span className="text-red-700 dark:text-red-300">{error}</span>
                    </div>
                  </div>
                )}

                {/* Products Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                  {predefinedProducts.map((product) => (
                    <div
                      key={product.name}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                        selectedProducts.has(product.name)
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                      onClick={() => handleProductToggle(product.name)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate">
                            {product.name}
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {product.price} Kč
                          </p>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ml-2 ${
                          selectedProducts.has(product.name)
                            ? 'border-purple-500 bg-purple-500'
                            : 'border-gray-300 dark:border-gray-500'
                        }`}>
                          {selectedProducts.has(product.name) && (
                            <CheckCircle className="w-3 h-3 text-white" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200"
                  >
                    Zrušit
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleImport}
                    disabled={loading || selectedCount === 0}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Importuji...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Importovat vybrané ({selectedCount})
                      </>
                    )}
                  </motion.button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
