'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle, ArrowLeft, Receipt, Home } from 'lucide-react';
import { SumUpCallbackParams } from '@/lib/sumup';

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [callbackData, setCallbackData] = useState<SumUpCallbackParams | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const status = searchParams.get('status') as SumUpCallbackParams['status'];
    const txCode = searchParams.get('tx_code');
    const foreignTxId = searchParams.get('foreign_tx_id');
    
    if (status) {
      setCallbackData({
        status,
        txCode: txCode || undefined,
        foreignTxId: foreignTxId || undefined,
        storeId: undefined, // Budeme číst z localStorage
        userId: undefined,  // Budeme číst z localStorage
        cartItems: [] // Cart items se budou načítat z localStorage
      });
    }
    
    // Pokud je platba úspěšná, uložíme prodej do databáze
    if (status === 'success' && foreignTxId) {
      handleSaveSale(status, txCode, foreignTxId);
    }
    
    setLoading(false);
  }, [searchParams]);

  const handleSaveSale = async (
    status: string, 
    txCode: string | null, 
    foreignTxId: string
  ) => {
    try {
      // Načteme data o platbě z localStorage
      const paymentData = localStorage.getItem('uctarna_payment_data');
      if (!paymentData) {
        console.error('Chybí data o platbě v localStorage');
        return;
      }
      
      const { storeId, userId, cartItems, totalAmount } = JSON.parse(paymentData);
      
      if (!storeId || !userId) {
        console.error('Chybí storeId nebo userId v localStorage');
        return;
      }
 
      // Voláme API pro uložení prodeje
      const response = await fetch('/api/sumup-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          txCode,
          foreignTxId,
          amount: totalAmount,
          currency: 'CZK', // SumUp platby jsou vždy v CZK
          storeId,
          userId,
          cartItems
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Prodej úspěšně uložen:', result);
        
        // Vyčistíme localStorage od zbytečností
        localStorage.removeItem('uctarna_payment_data');
        localStorage.removeItem('uctarna_cart');
        
        // Zobrazíme úspěšnou zprávu
        alert('Prodej byl úspěšně uložen do databáze!');
      } else {
        console.error('❌ Chyba při ukládání prodeje:', response.statusText);
        alert('Chyba při ukládání prodeje. Kontaktujte podporu.');
      }
    } catch (error) {
      console.error('❌ Chyba při ukládání prodeje:', error);
      alert('Chyba při ukládání prodeje. Kontaktujte podporu.');
    }
  };

  const handleBackToStore = () => {
    // Návrat zpět do prodejny - použijeme localStorage
    try {
      const paymentData = localStorage.getItem('uctarna_payment_data');
      if (paymentData) {
        const { storeId } = JSON.parse(paymentData);
        if (storeId) {
          // Přesměrujeme přímo do prodejny
          router.push(`/store/${storeId}`);
          return;
        }
      }
    } catch (error) {
      console.error('Chyba při čtení localStorage:', error);
    }
    
    // Fallback - návrat zpět
    if (window.history.length > 1) {
      window.history.back();
    } else {
      // Pokud není historie, přesměrujeme na hlavní stránku
      router.push('/');
    }
  };

  const handleGoHome = () => {
    // Návrat na hlavní stránku
    router.push('/');
  };

  const handleViewReceipt = () => {
    // Zobrazení dokladu - prozatím log do konzole
    console.log('Zobrazení dokladu pro transakci:', callbackData?.txCode);
    
    // Můžeme zde implementovat zobrazení dokladu
    // Prozatím zobrazíme alert s informacemi
    if (callbackData) {
      alert(`Doklad pro transakci:\n\nSumUp kód: ${callbackData.txCode || 'N/A'}\nTransaction ID: ${callbackData.foreignTxId || 'N/A'}\nStatus: Úspěšně dokončeno\n\nDoklad byl odeslán na váš email a je dostupný v SumUp aplikaci.`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md mx-auto pt-20 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center"
        >
          {/* Success Icon */}
          <div className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
          </div>

          {/* Success Message */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Platba byla úspěšná!
          </h1>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Vaše platba byla zpracována a potvrzena.
          </p>

          {/* Transaction Details */}
          {callbackData && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                Detaily transakce:
              </h3>
              
              {callbackData.txCode && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">SumUp kód:</span>
                  <span className="text-sm font-mono text-gray-900 dark:text-white">
                    {callbackData.txCode}
                  </span>
                </div>
              )}
              
              {callbackData.foreignTxId && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">ID transakce:</span>
                  <span className="text-sm font-mono text-gray-900 dark:text-white">
                    {callbackData.foreignTxId}
                  </span>
                </div>
              )}
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
                <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                  ✅ Úspěšně dokončeno
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              onClick={handleViewReceipt}
              className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
            >
              <Receipt className="w-5 h-5 mr-2" />
              Zobrazit doklad
            </button>
            
            <button
              onClick={handleBackToStore}
              className="w-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Zpět do obchodu
            </button>
            
            <button
              onClick={handleGoHome}
              className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
            >
              <Home className="w-5 h-5 mr-2" />
              Hlavní stránka
            </button>
          </div>

          {/* Additional Info */}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-6">
            Doklad byl odeslán na váš email a je dostupný v SumUp aplikaci.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    }>
      <PaymentSuccessContent />
    </Suspense>
  );
}
