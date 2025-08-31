'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Receipt, Calendar, Eye, DollarSign, CreditCard, Smartphone } from 'lucide-react';
import { Sale } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ReceiptsViewProps {
  storeId: string;
}

export const ReceiptsView: React.FC<ReceiptsViewProps> = ({ storeId }) => {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  useEffect(() => {
    if (!user || !storeId) return;

    const salesRef = collection(db, 'users', user.uid, 'stores', storeId, 'sales');
    const q = query(salesRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sale[];
      
      setSales(salesData);
      setLoading(false);
    });

    return unsubscribe;
  }, [user, storeId]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    
    const dateObj = date instanceof Date ? date : date.toDate();
    return new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  };

  const getPaymentIcon = (method: 'cash' | 'card') => {
    switch (method) {
      case 'cash':
        return <DollarSign className="h-4 w-4" />;
      case 'card':
        return <CreditCard className="h-4 w-4" />;
      default:
        return <CreditCard className="h-4 w-4" />;
    }
  };

  const getPaymentLabel = (method: 'cash' | 'card') => {
    switch (method) {
      case 'cash':
        return 'Hotovost';
      case 'card':
        return 'Karta'; // Zahrnuje i SumUp platby
      default:
        return 'Neznámé';
    }
  };

  const getPaymentColor = (method: 'cash' | 'card') => {
    switch (method) {
      case 'cash':
        return 'text-green-600 dark:text-green-400';
      case 'card':
        return 'text-purple-600 dark:text-purple-400'; // Zahrnuje i SumUp platby
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Doklady
        </h2>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Celkem: {sales.length} dokladů
        </div>
      </div>

      {sales.length === 0 ? (
        <div className="text-center py-12">
          <Receipt className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Zatím nejsou žádné doklady
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Po prvním prodeji se zde zobrazí doklady
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {sales.map((sale, index) => (
              <motion.div
                key={sale.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <Receipt className="h-5 w-5 text-purple-600 mr-2" />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      #{sale.id.slice(-8)}
                    </span>
                  </div>
                  <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                    <div className={getPaymentColor(sale.paymentMethod)}>
                      {getPaymentIcon(sale.paymentMethod)}
                    </div>
                    <span className="ml-1">{getPaymentLabel(sale.paymentMethod)}</span>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-2">
                    <Calendar className="h-4 w-4 mr-2" />
                    {formatDate(sale.createdAt)}
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {sale.totalAmount} Kč
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {sale.items.length} položek
                  </div>
                </div>

                <button
                  onClick={() => setSelectedSale(sale)}
                  className="w-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 py-2 px-4 rounded-lg font-medium hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors flex items-center justify-center"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Zobrazit detail
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Sale Detail Modal */}
      <AnimatePresence>
        {selectedSale && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedSale(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-white">
                    Detail dokladu
                  </h3>
                  <button
                    onClick={() => setSelectedSale(null)}
                    className="text-white hover:text-gray-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Datum:</span>
                    <span className="font-medium">{formatDate(selectedSale.createdAt)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Způsob platby:</span>
                    <span className="font-medium">{getPaymentLabel(selectedSale.paymentMethod)}</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-3">Položky:</h4>
                    <div className="space-y-2">
                      {selectedSale.items.map((item, index) => (
                        <div key={index} className="flex justify-between items-center text-sm">
                          <span className="text-gray-700 dark:text-gray-300">
                            {item.productName} × {item.quantity}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {item.price * item.quantity} Kč
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex justify-between items-center text-lg font-bold text-gray-900 dark:text-white">
                      <span>Celkem:</span>
                      <span>{selectedSale.totalAmount} Kč</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
