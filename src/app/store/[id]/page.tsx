'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Store as StoreIcon, ShoppingCart, Receipt, BarChart3, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { POSSystem } from '@/components/pos/POSSystem';
import { ReceiptsView } from '@/components/pos/ReceiptsView';
import { ReportsView } from '@/components/pos/ReportsView';
import { SettingsView } from '@/components/pos/SettingsView';

type ViewType = 'pos' | 'receipts' | 'reports' | 'settings';

export default function StorePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const storeId = params.id as string;
  
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('pos');

  useEffect(() => {
    if (!user || !storeId) return;

    const storeRef = doc(db, 'users', user.uid, 'stores', storeId);
    
    const unsubscribe = onSnapshot(storeRef, (doc) => {
      if (doc.exists()) {
        setStore({ id: doc.id, ...doc.data() } as Store);
      } else {
        // Prodejna neexistuje, přesměrovat zpět
        router.push('/');
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [user, storeId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!store) {
    return null;
  }

  const renderView = () => {
    switch (currentView) {
      case 'pos':
        return <POSSystem storeId={storeId} />;
      case 'receipts':
        return <ReceiptsView storeId={storeId} />;
      case 'reports':
        return <ReportsView storeId={storeId} />;
      case 'settings':
        return <SettingsView storeId={storeId} />;
      default:
        return <POSSystem storeId={storeId} />;
    }
  };

  const getViewIcon = (view: ViewType) => {
    switch (view) {
      case 'pos':
        return <ShoppingCart className="h-5 w-5" />;
      case 'receipts':
        return <Receipt className="h-5 w-5" />;
      case 'reports':
        return <BarChart3 className="h-5 w-5" />;
      case 'settings':
        return <Settings className="h-5 w-5" />;
    }
  };

  const getViewLabel = (view: ViewType) => {
    switch (view) {
      case 'pos':
        return 'Prodej';
      case 'receipts':
        return 'Doklady';
      case 'reports':
        return 'Uzávěrky';
      case 'settings':
        return 'Nastavení';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/')}
                className="mr-4 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              </button>
              <StoreIcon className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  {store.name}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Prodejní systém
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-6 md:space-x-8 overflow-x-auto scrollbar-hide pb-2 md:pb-0">
            {(['pos', 'receipts', 'reports', 'settings'] as ViewType[]).map((view) => (
              <button
                key={view}
                onClick={() => setCurrentView(view)}
                className={`flex items-center px-2 md:px-3 py-3 md:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  currentView === view
                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {getViewIcon(view)}
                <span className="ml-1 md:ml-2">{getViewLabel(view)}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
