'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { XCircle, ArrowLeft, RefreshCw, Home } from 'lucide-react';
import { SumUpCallbackParams } from '@/lib/sumup';

function PaymentFailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [callbackData, setCallbackData] = useState<SumUpCallbackParams | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pokud se stránka otevřela v novém okně (má opener), vrať kontrolu do původního okna
    try {
      if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
        window.opener.location.assign(window.location.href);
        window.close();
        return;
      }
    } catch {}

    // Notifikace původního okna (bez opener)
    try {
      const bc = new BroadcastChannel('uctarna_payments');
      bc.postMessage({ type: 'PAYMENT_FAIL' });
      localStorage.setItem('uctarna_payment_result', JSON.stringify({ type: 'PAYMENT_FAIL', at: Date.now() }));
    } catch {}

    try {
      window.open('', '_self');
      window.close();
    } catch {}

    // Získání callback parametrů z URL
    const status = searchParams.get('smp-status') as SumUpCallbackParams['status'];
    const txCode = searchParams.get('smp-tx-code');
    const foreignTxId = searchParams.get('foreign-tx-id');

    if (status) {
      setCallbackData({
        status,
        txCode: txCode || undefined,
        foreignTxId: foreignTxId || undefined
      });
    }
    
    setLoading(false);
  }, [searchParams]);

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

  const handleRetryPayment = () => {
    // Opakování platby - znovu odeslat platbu přes SumUp
    try {
      const paymentData = localStorage.getItem('uctarna_payment_data');
      if (paymentData) {
        const { storeId, userId, cartItems, totalAmount, currency } = JSON.parse(paymentData);
        
        if (storeId && userId && cartItems && totalAmount) {
          // Import SumUp service pro opakování platby
          import('@/lib/sumup').then(({ sumUpService, SumUpService }) => {
            const paymentParams = {
              amount: totalAmount,
              currency: currency || 'CZK',
              title: `Nákup v obchodě`,
              foreignTxId: SumUpService.generateTransactionId(),
              skipSuccessScreen: true,
              storeId,
              userId,
              cartItems
            };
            
            // Znovu otevřít SumUp app pro platbu
            sumUpService.openSumUpForCardPayment(paymentParams);
          }).catch(error => {
            console.error('Chyba při načítání SumUp service:', error);
            alert('Chyba při opakování platby. Zkuste to znovu.');
          });
          
          return;
        }
      }
      
      // Fallback - pokud nejsou data, přesměrujeme do prodejny
      if (window.history.length > 1) {
        window.history.back();
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('Chyba při opakování platby:', error);
      alert('Chyba při opakování platby. Zkuste to znovu.');
    }
  };

  const getErrorMessage = (status: string) => {
    switch (status) {
      case 'failed':
        return 'Platba se nezdařila. Zkuste to prosím znovu.';
      case 'invalidstate':
        return 'SumUp aplikace není připravena. Otevřete SumUp app a zkuste to znovu.';
      default:
        return 'Došlo k chybě při zpracování platby.';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md mx-auto pt-20 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center"
        >
          {/* Error Icon */}
          <div className="mx-auto w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-6">
            <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
          </div>

          {/* Error Message */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Platba se nezdařila
          </h1>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {callbackData ? getErrorMessage(callbackData.status) : 'Došlo k chybě při zpracování platby.'}
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
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  ❌ Neúspěšně
                </span>
              </div>
            </div>
          )}

          {/* Troubleshooting Tips */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6 text-left">
            <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">
              💡 Tipy pro řešení:
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• Zkontrolujte připojení k internetu</li>
              <li>• Ujistěte se, že máte SumUp app otevřenou</li>
              <li>• Zkontrolujte, zda je karta správně připojena</li>
              <li>• Zkuste platbu zopakovat</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              onClick={handleRetryPayment}
              className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              Zkusit znovu
            </button>
            
            <button
              onClick={handleBackToStore}
              className="w-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center justify-center"
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
            Pokud problém přetrvává, kontaktujte podporu SumUp nebo zkuste jinou platební metodu.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    }>
      <PaymentFailContent />
    </Suspense>
  );
}
