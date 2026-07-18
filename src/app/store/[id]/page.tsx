'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LoginRequiredModal } from '@/components/auth/LoginRequiredModal';
import { StoreProvider } from '@/contexts/StoreContext';
import { BrandColorProvider } from '@/components/BrandColorProvider';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { backfillSaleCosts } from '@/lib/migrateSaleCosts';
import { Store } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Store as StoreIcon, ShoppingCart, Receipt, BarChart3, Settings, UtensilsCrossed, Sparkles, BookOpen } from 'lucide-react';

const ViewLoading = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
  </div>
);

const POSSystem = dynamic(
  () => import('@/components/pos/POSSystem').then((m) => ({ default: m.POSSystem })),
  { loading: () => <ViewLoading /> }
);
const ReceiptsView = dynamic(
  () => import('@/components/pos/ReceiptsView').then((m) => ({ default: m.ReceiptsView })),
  { loading: () => <ViewLoading /> }
);
const ReportsView = dynamic(
  () => import('@/components/pos/ReportsView').then((m) => ({ default: m.ReportsView })),
  { loading: () => <ViewLoading /> }
);
const SettingsView = dynamic(
  () => import('@/components/pos/SettingsView').then((m) => ({ default: m.SettingsView })),
  { loading: () => <ViewLoading /> }
);
const DispatchView = dynamic(
  () => import('@/components/pos/DispatchView').then((m) => ({ default: m.DispatchView })),
  { loading: () => <ViewLoading /> }
);
const AICopilotView = dynamic(
  () => import('@/components/pos/AICopilotView').then((m) => ({ default: m.AICopilotView })),
  { loading: () => <ViewLoading /> }
);
const CatalogView = dynamic(
  () => import('@/components/pos/CatalogView').then((m) => ({ default: m.CatalogView })),
  { loading: () => <ViewLoading /> }
);

type ViewType = 'pos' | 'receipts' | 'dispatch' | 'katalog' | 'aichat' | 'reports' | 'settings';

export default function StorePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const storeId = params.id as string;

  const [store, setStore] = useState<Store | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('pos');

  useEffect(() => {
    if (authLoading) return;

    if (!user || !storeId) {
      setStoreLoading(false);
      return;
    }

    setStoreLoading(true);
    const storeRef = doc(db, 'users', user.uid, 'stores', storeId);

    const unsubscribe = onSnapshot(storeRef, (snapshot) => {
      if (snapshot.exists()) {
        setStore({ id: snapshot.id, ...snapshot.data() } as Store);
      } else {
        router.push('/');
      }
      setStoreLoading(false);
    });

    return unsubscribe;
  }, [user, authLoading, storeId, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('view') as ViewType | null;
    if (v) setCurrentView(v);
  }, []);

  // Jednorázově zafixuj nákupní ceny u historických prodejů, aby změna nákupky
  // v katalogu neovlivňovala zisk dříve prodaných produktů.
  useEffect(() => {
    if (!user || !storeId) return;
    void backfillSaleCosts(user.uid, storeId);
  }, [user, storeId]);

  if (authLoading || (user && storeLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  if (!user) {
    const query = searchParams.toString();
    const redirectPath = `/store/${storeId}${query ? `?${query}` : ''}`;
    return <LoginRequiredModal redirectPath={redirectPath} />;
  }

  if (!store) {
    return null;
  }

  const renderView = () => {
    return (
      <>
        <div className={currentView === 'pos' ? undefined : 'hidden'} aria-hidden={currentView !== 'pos'}>
          <POSSystem storeId={storeId} storeName={store.name} />
        </div>
        {currentView === 'receipts' && <ReceiptsView storeId={storeId} />}
        {currentView === 'dispatch' && store.type === 'bistro' && <DispatchView storeId={storeId} />}
        {currentView === 'katalog' && <CatalogView storeId={storeId} />}
        {currentView === 'aichat' && <AICopilotView storeId={storeId} storeName={store.name} />}
        {currentView === 'reports' && <ReportsView storeId={storeId} />}
        {currentView === 'settings' && <SettingsView storeId={storeId} />}
      </>
    );
  };

  const getViewIcon = (view: ViewType) => {
    switch (view) {
      case 'pos':
        return <ShoppingCart className="h-5 w-5" />;
      case 'receipts':
        return <Receipt className="h-5 w-5" />;
      case 'dispatch':
        return <UtensilsCrossed className="h-5 w-5" />;
      case 'katalog':
        return <BookOpen className="h-5 w-5" />;
      case 'aichat':
        return <Sparkles className="h-5 w-5" />;
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
      case 'dispatch':
        return 'Výdej';
      case 'katalog':
        return 'Katalog';
      case 'aichat':
        return 'AI Chat';
      case 'reports':
        return 'Uzávěrky';
      case 'settings':
        return 'Nastavení';
    }
  };

  return (
    <StoreProvider store={store}>
      <BrandColorProvider store={store}>
      <div className="min-h-screen bg-gray-50 dark:bg-gradient-to-br dark:from-gray-900 dark:to-gray-800">
        <header className="sticky top-0 z-50 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center">
                <button
                  onClick={() => router.push('/')}
                  className="mr-4 w-10 h-10 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-center"
                >
                  <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                </button>
                {store.type === 'bistro' ? (
                  <UtensilsCrossed className="h-8 w-8 text-brand-600 mr-3" />
                ) : (
                  <StoreIcon className="h-8 w-8 text-brand-600 mr-3" />
                )}
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">{store.name}</h1>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Prodejní systém</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <nav className="sticky top-16 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="w-full flex justify-between items-stretch">
              {(['pos', 'receipts', ...(store.type === 'bistro' ? (['dispatch'] as ViewType[]) : []), 'katalog', 'aichat', 'reports', 'settings'] as ViewType[]).map((view) => (
                <button
                  key={view}
                  onClick={() => setCurrentView(view)}
                  className={`flex-1 min-h-[56px] flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 px-1 md:px-3 py-2 md:py-4 text-sm font-medium border-b-2 transition-colors ${
                    currentView === view
                      ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {getViewIcon(view)}
                  <span className="hidden md:block">{getViewLabel(view)}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>

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
      </BrandColorProvider>
    </StoreProvider>
  );
}
