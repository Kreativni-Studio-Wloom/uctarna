'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, DollarSign, Euro, Calculator } from 'lucide-react';
import { CartItem } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sumUpService, SumUpService, SumUpPaymentParams } from '@/lib/sumup';

interface CheckoutModalProps {
  onClose: () => void;
  cart: CartItem[];
  totalAmount: number;
  storeId: string;
  onSuccess: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  onClose,
  cart,
  totalAmount,
  storeId,
  onSuccess
}) => {
  const { user } = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('card');
  const [loading, setLoading] = useState(false);
  const [showEurConversion, setShowEurConversion] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidCurrency, setPaidCurrency] = useState<'CZK' | 'EUR'>('CZK');
  const [sumUpAvailable, setSumUpAvailable] = useState(false);

  const eurRate = user?.settings?.eurRate || 25.0;
  const eurAmount = totalAmount / eurRate;

  // Výpočet částky k vrácení (vždy v korunách)
  const paidAmountInCZK = paidCurrency === 'EUR' ? paidAmount * eurRate : paidAmount;
  const changeAmount = paidAmountInCZK - totalAmount;

  // Kontrola, zda je to vratka (záporná částka)
  const isRefund = totalAmount < 0;
  const refundAmount = Math.abs(totalAmount);

  // Deaktivace platby kartou při vratce
  const canUseCard = !isRefund;

  // Detekce SumUp app dostupnosti
  useEffect(() => {
    if (typeof window !== 'undefined') {
      SumUpService.detectSumUpApp().then(setSumUpAvailable);
    }
  }, []);

  const handlePayment = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // SumUp platba kartou - otevře se až při kliknutí "Zaplatit kartou"
      if (paymentMethod === 'card' && !isRefund && sumUpAvailable) {
        // Uložíme kompletní informace o platbě do localStorage pro callback navigaci a opakování
        localStorage.setItem('uctarna_payment_data', JSON.stringify({
          storeId,
          userId: user.uid,
          cartItems: cart,
          totalAmount,
          currency: 'CZK',
          timestamp: Date.now()
        }));
        
        const paymentParams: SumUpPaymentParams = {
          amount: totalAmount,
          currency: 'CZK',
          title: `Nákup v obchodě`,
          foreignTxId: SumUpService.generateTransactionId(),
          skipSuccessScreen: true,
          // Přidáno pro callback handling
          storeId,
          userId: user.uid,
          cartItems: cart
        };
        
        // Automatické otevření SumUp app pro platbu kartou
        // Prodej se NEukládá do databáze - čekáme na callback od SumUp
        sumUpService.openSumUpForCardPayment(paymentParams);
        return; // Nezavírej modal, nech SumUp app otevřít
      }

      // Hotovost nebo neúspěšná SumUp platba - vytvoř prodej/vratku v Firestore
      const sale = {
        items: cart,
        totalAmount,
        paymentMethod,
        createdAt: serverTimestamp(),
        storeId,
        userId: user.uid,
        isRefund, // Přidáno pole pro identifikaci vratky
        refundAmount: isRefund ? refundAmount : null, // Přidáno pole pro částku vratky
      };

      await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'sales'), sale);

      // Aktualizuj počet prodaných kusů pro každý produkt (vratky se odečítají)
      for (const item of cart) {
        const productRef = doc(db, 'users', user.uid, 'stores', storeId, 'products', item.productId);
        await updateDoc(productRef, {
          soldCount: increment(item.quantity), // item.quantity je záporné pro vratky
          updatedAt: serverTimestamp()
        });
      }

      onSuccess();
    } catch (error) {
      console.error('Error processing payment:', error);
    } finally {
      setLoading(false);
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
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CreditCard className="h-6 w-6 text-white mr-3" />
                <h2 className="text-xl font-semibold text-white">
                  Dokončit nákup
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
          <div className="p-6">
            {/* Cart Summary */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Přehled nákupu
              </h3>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {cart.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center text-sm">
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.productName} × {item.quantity}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {item.price * item.quantity} Kč
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                <div className="flex justify-between items-center text-lg font-bold text-gray-900 dark:text-white">
                  <span>Celkem:</span>
                  <span>{totalAmount} Kč</span>
                </div>
              </div>
            </div>

            {/* EUR Conversion - pouze při platbě hotovostí */}
            {paymentMethod === 'cash' && (
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Převod na EUR
                  </span>
                  <button
                    onClick={() => setShowEurConversion(!showEurConversion)}
                    className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
                  >
                    <Calculator className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <Euro className="h-4 w-4 text-gray-500" />
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {eurAmount.toFixed(2)} EUR
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    (kurz: {eurRate} Kč/EUR)
                  </span>
                </div>
              </div>
            )}

            {/* Zaplaceno - pouze při platbě hotovostí */}
            {paymentMethod === 'cash' && (
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-700 shadow-sm">
                <div className="flex items-center mb-4">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-800 rounded-lg flex items-center justify-center mr-3">
                    <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h4 className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                    Zaplaceno
                  </h4>
                </div>
                
                {/* Input pro částku */}
                <div className="flex items-center space-x-3 mb-4">
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      value={paidAmount || ''}
                      onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-4 py-3 border border-blue-300 dark:border-blue-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  
                  {/* Výběr měny */}
                  <div className="relative">
                    <select
                      value={paidCurrency}
                      onChange={(e) => setPaidCurrency(e.target.value as 'CZK' | 'EUR')}
                      className="px-4 py-3 border border-blue-300 dark:border-blue-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium cursor-pointer appearance-none pr-10"
                    >
                      <option value="CZK">🇨🇿 Kč</option>
                      <option value="EUR">🇪🇺 €</option>
                    </select>
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                      <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Výpočet částky k vrácení */}
                {paidAmount > 0 && (
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-blue-200 dark:border-blue-600 shadow-sm">
                    <div className="flex justify-between items-center text-sm mb-3">
                      <span className="text-blue-700 dark:text-blue-300 font-medium">Zaplaceno:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {paidAmount} {paidCurrency === 'CZK' ? 'Kč' : '€'}
                        {paidCurrency === 'EUR' && (
                          <span className="text-xs text-gray-500 ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-lg">
                            ({paidAmountInCZK.toFixed(2)} Kč)
                          </span>
                        )}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span className="text-green-600 dark:text-green-400">Vrátit:</span>
                      <span className="text-green-600 dark:text-green-400">
                        {changeAmount > 0 ? `${changeAmount.toFixed(2)} Kč` : '0 Kč'}
                      </span>
                    </div>
                    
                    {changeAmount < 0 && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center">
                          <span className="mr-2">⚠️</span>
                          Zaplaceno méně než celková částka
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payment Method */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Způsob platby
              </h3>
              
              {/* Informace o vratce */}
              {isRefund && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                  <div className="flex items-center">
                    <svg className="h-5 w-5 text-red-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    <span className="text-red-700 dark:text-red-300 font-medium">
                      Vratka: Zákazníkovi se musí vrátit {refundAmount} Kč
                    </span>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod('card')}
                  disabled={!canUseCard}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                    paymentMethod === 'card'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  } ${
                    !canUseCard ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <CreditCard className="h-5 w-5 mr-2 text-purple-600" />
                  <span className="font-medium">Karta</span>
                  {!canUseCard && (
                    <span className="text-xs text-gray-500 ml-1">(nedostupná)</span>
                  )}
                </button>
                
                <button
                  onClick={() => setPaymentMethod('cash')}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                    paymentMethod === 'cash'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <DollarSign className="h-5 w-5 mr-2 text-green-600" />
                  <span className="font-medium">Hotovost</span>
                </button>
              </div>
              
              {/* SumUp info - pouze při platbě kartou */}
              {paymentMethod === 'card' && sumUpAvailable && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                    <CreditCard className="h-4 w-4 mr-2" />
                    <span>
                      Platba kartou proběhne přes SumUp aplikaci. Po kliknutí "Zaplatit" se otevře SumUp app s předvyplněnou částkou {totalAmount} Kč.
                    </span>
                  </div>
                </div>
              )}
              
              {/* SumUp nedostupná - pouze při platbě kartou */}
              {paymentMethod === 'card' && !sumUpAvailable && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                  <div className="flex items-center text-sm text-yellow-700 dark:text-yellow-300">
                    <CreditCard className="h-4 w-4 mr-2" />
                    <span>
                      SumUp aplikace není dostupná. Pro platbu kartou nainstalujte SumUp app.
                    </span>
                  </div>
                </div>
              )}
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
                onClick={handlePayment}
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Zpracování...
                  </div>
                ) : (
                  isRefund ? `Vrátit zákazníkovi ${refundAmount} Kč` : `Zaplatit ${totalAmount} Kč`
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
