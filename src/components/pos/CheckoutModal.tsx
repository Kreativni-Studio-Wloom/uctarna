'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, DollarSign, Euro, Calculator, QrCode } from 'lucide-react';
import { CartItem } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sumUpService, SumUpService, SumUpPaymentParams } from '@/lib/sumup';
import QRCode from 'react-qr-code';

interface CheckoutModalProps {
  onClose: () => void;
  cart: CartItem[];
  totalAmount: number;
  storeId: string;
  storeName: string;
  onSuccess: () => void;
  discount?: { type: 'percentage' | 'amount'; value: number } | null;
  discountAmount?: number;
  finalAmount?: number;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  onClose,
  cart,
  totalAmount,
  storeId,
  storeName,
  onSuccess,
  discount,
  discountAmount,
  finalAmount
}) => {
  const { user } = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'qr'>('cash');
  const [loading, setLoading] = useState(false);
  const [showEurConversion, setShowEurConversion] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [paidCurrency, setPaidCurrency] = useState<'CZK' | 'EUR'>('CZK');
  const [sumUpAvailable, setSumUpAvailable] = useState(false);
  const [sumUpAffiliateKeyConfigured, setSumUpAffiliateKeyConfigured] = useState(false);
  const [payInEUR, setPayInEUR] = useState(false);
  const [customerName, setCustomerName] = useState<string>('');
  const [storeType, setStoreType] = useState<'prodejna' | 'bistro' | null>(null);
  const [redirectToSumUp, setRedirectToSumUp] = useState(true);
  const [iban, setIban] = useState<string>('');
  const [qrDocumentId, setQrDocumentId] = useState<string>(''); // 10 chars (existing format)
  const [qrVariableSymbol, setQrVariableSymbol] = useState<string>(''); // numeric only

  const [eurRate, setEurRate] = useState<number>(25.0);
  // Použij finální částku po slevě, pokud je k dispozici, jinak původní částku
  const actualTotalAmount = finalAmount !== undefined ? finalAmount : totalAmount;
  const eurAmount = actualTotalAmount / eurRate;

  // Výpočet částky k vrácení
  let changeAmount: number;
  let paidAmountInCZK: number;
  
  if (payInEUR) {
    // Při platbě v eurech: zaplacená částka v eurech - hodnota nákupu v eurech, pak přepočítat na koruny
    const paidAmountInEUR = paidCurrency === 'EUR' ? paidAmount : paidAmount / eurRate;
    const changeAmountInEUR = paidAmountInEUR - eurAmount; // Zaplacená částka minus hodnota nákupu
    changeAmount = changeAmountInEUR * eurRate; // Přepočítat na koruny (může být záporné)
    paidAmountInCZK = paidAmountInEUR * eurRate; // Pro zobrazení - přepočítat zaplacenou částku na koruny
  } else {
    // Při platbě v korunách: standardní výpočet
    paidAmountInCZK = paidCurrency === 'EUR' ? paidAmount * eurRate : paidAmount;
    changeAmount = paidAmountInCZK - actualTotalAmount;
  }

  // Aktuální částka pro zobrazení (v eurech pokud je vybrána platba v eurech)
  const displayAmount = payInEUR ? eurAmount : actualTotalAmount;
  const displayCurrency = payInEUR ? 'EUR' : 'CZK';

  // Kontrola, zda je to vratka (záporná částka)
  const isRefund = actualTotalAmount < 0;
  const refundAmount = Math.abs(actualTotalAmount);

  // Deaktivace platby kartou při vratce
  const canUseCard = !isRefund;
  const requiresSumUpRedirect = paymentMethod === 'card' && sumUpAvailable && redirectToSumUp;
  const canProceedWithCard = !requiresSumUpRedirect || sumUpAffiliateKeyConfigured;
  const hasIban = Boolean(iban && iban.trim().length > 0);
  const canUseQr = !isRefund && displayCurrency === 'CZK' && paymentMethod !== 'card' ? hasIban : hasIban && !isRefund; // guard; UI also checks

  // Načtení kurzu pro store z Firestore a detekce SumUp
  useEffect(() => {
    if (!user || !storeId) return;
    if (typeof window !== 'undefined') {
      SumUpService.detectSumUpApp().then(setSumUpAvailable);
      setSumUpAffiliateKeyConfigured(sumUpService.hasAffiliateKeyConfigured());
    }
    const storeRef = doc(db, 'users', user.uid, 'stores', storeId);
    const unsubscribe = onSnapshot(storeRef, (snap) => {
      const data: any = snap.data() || {};
      if (typeof data.eurRate === 'number') {
        setEurRate(data.eurRate);
      }
      if (data.type === 'prodejna' || data.type === 'bistro') {
        setStoreType(data.type);
      }
      if (typeof data.redirectToSumUp === 'boolean') {
        setRedirectToSumUp(data.redirectToSumUp);
      }
      if (typeof data.iban === 'string') {
        setIban(data.iban);
      } else {
        setIban('');
      }
    });
    return unsubscribe;
  }, [user, storeId]);

  // Poslech výsledku platby z návratové stránky (BroadcastChannel + storage event)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('uctarna_payments');
      bc.onmessage = (ev) => {
        if (ev?.data?.type === 'PAYMENT_SUCCESS') {
          // Zavři modal a dej vědět rodiči
          onSuccess();
        }
      };
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'uctarna_payment_result' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (data?.type === 'PAYMENT_SUCCESS') {
            onSuccess();
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      try { bc && bc.close(); } catch {}
    };
  }, [onSuccess]);

  // Automaticky nastavit měnu podle platby v eurech
  useEffect(() => {
    if (payInEUR) {
      setPaidCurrency('EUR');
    } else {
      setPaidCurrency('CZK');
    }
  }, [payInEUR]);

  // Resetovat platbu v eurech při změně způsobu platby na kartu
  useEffect(() => {
    if (paymentMethod === 'card') {
      setPayInEUR(false);
    }
  }, [paymentMethod]);

  // Při volbě QR vygeneruj documentId, pokud ještě není
  useEffect(() => {
    if (paymentMethod !== 'qr') return;
    if (qrDocumentId && qrVariableSymbol) return;
    if (!qrDocumentId) setQrDocumentId(SumUpService.generateDocumentId());
    if (!qrVariableSymbol) {
      // 10 číslic pro maximální kompatibilitu bank u SPAYD X-VS
      const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
      setQrVariableSymbol(digits);
    }
  }, [paymentMethod, qrDocumentId, qrVariableSymbol]);

  const normalizeIban = (value: string) => value.replace(/\s+/g, '').toUpperCase();
  const normalizeSpaydMsg = (value: string) => {
    const ascii = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ''); // only ASCII
    return ascii.replace(/\*/g, ' ').trim().slice(0, 60);
  };

  const getSpaydString = () => {
    const acc = normalizeIban(iban || '');
    const amount = Math.abs(actualTotalAmount).toFixed(2); // dot separator
    const vs = qrVariableSymbol;
    const msg = normalizeSpaydMsg(storeName || '');
    return `SPD*1.0*ACC:${acc}*AM:${amount}*CC:CZK*X-VS:${vs}*MSG:${msg}`;
  };

  const handlePayment = async () => {
    if (!user) return;

    setLoading(true);
    try {
      if (paymentMethod === 'qr') {
        if (!hasIban) return;
        const documentId = qrDocumentId || SumUpService.generateDocumentId();
        const variableSymbol = qrVariableSymbol;
        const sale = {
          items: cart,
          totalAmount: actualTotalAmount,
          paymentMethod: 'qr',
          currency: 'CZK',
          eurRate: null,
          originalAmountCZK: totalAmount,
          documentId,
          variableSymbol,
          createdAt: serverTimestamp(),
          storeId,
          userId: user.uid,
          customerName: storeType === 'bistro' ? (customerName || null) : null,
          isRefund,
          refundAmount: isRefund ? refundAmount : null,
          paidAmount: null,
          paidCurrency: null,
          changeAmount: null,
          changeAmountEUR: null,
          discount: discount || null,
          discountAmount: discountAmount || 0,
          finalAmount: actualTotalAmount,
          served: false,
        };

        await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'sales'), sale);

        for (const item of cart) {
          const productRef = doc(db, 'users', user.uid, 'stores', storeId, 'products', item.productId);
          await updateDoc(productRef, {
            soldCount: increment(item.quantity),
            updatedAt: serverTimestamp(),
          });
        }

        onSuccess();
        return;
      }

      if (paymentMethod === 'card' && sumUpAvailable && redirectToSumUp && !sumUpAffiliateKeyConfigured) {
        alert('Chybí SumUp affiliate key. Nastavte NEXT_PUBLIC_SUMUP_AFFILIATE_KEY a restartujte aplikaci.');
        return;
      }

      // SumUp platba kartou - otevře se až při kliknutí "Zaplatit kartou"
      if (paymentMethod === 'card' && !isRefund && sumUpAvailable && redirectToSumUp) {
        // Vygenerujeme unikátní ID dokladu
        const documentId = SumUpService.generateDocumentId();

        // Uložíme kompletní informace o platbě do localStorage pro callback navigaci a opakování
        localStorage.setItem('uctarna_payment_data', JSON.stringify({
          storeId,
          userId: user.uid,
          cartItems: cart,
          totalAmount: actualTotalAmount,
          currency: 'CZK',
          documentId: documentId,
          foreignTxId: documentId, // Použijeme documentId jako foreignTxId pro SumUp
          timestamp: Date.now(),
          discount: discount || null,
          discountAmount: discountAmount || 0,
          finalAmount: actualTotalAmount,
          customerName: storeType === 'bistro' ? (customerName || null) : null
        }));
        
        const paymentParams: SumUpPaymentParams = {
          amount: actualTotalAmount,
          currency: 'CZK',
          title: `${documentId} - ${storeName}`,
          foreignTxId: documentId,
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

      // Hotovost nebo platba kartou bez přesměrování na SumUp - vytvoř prodej/vratku v Firestore
      const documentId = SumUpService.generateDocumentId(); // Generuj documentId i pro hotovost
      const sale = {
        items: cart,
        totalAmount: payInEUR ? eurAmount : actualTotalAmount, // Uložit částku v eurech pokud je vybrána platba v eurech
        paymentMethod,
        currency: payInEUR ? 'EUR' : 'CZK', // Přidat měnu
        eurRate: payInEUR ? eurRate : null, // Přidat kurz pokud je platba v eurech
        originalAmountCZK: totalAmount, // Původní částka v korunách pro reference
        documentId: documentId, // Unikátní ID dokladu
        createdAt: serverTimestamp(),
        storeId,
        userId: user.uid,
        customerName: storeType === 'bistro' ? (customerName || null) : null,
        isRefund, // Přidáno pole pro identifikaci vratky
        refundAmount: isRefund ? refundAmount : null, // Přidáno pole pro částku vratky
        // Informace o vrácení při platbě v eurech
        paidAmount: paymentMethod === 'cash' ? paidAmount : null,
        paidCurrency: paymentMethod === 'cash' ? (payInEUR ? 'EUR' : paidCurrency) : null,
        changeAmount: paymentMethod === 'cash' ? changeAmount : null,
        changeAmountEUR: paymentMethod === 'cash' && payInEUR ? (changeAmount / eurRate) : null,
        // Sleva
        discount: discount || null,
        discountAmount: discountAmount || 0,
        finalAmount: actualTotalAmount,
        served: false,
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
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
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
          <div className="p-6 flex-1 overflow-y-auto overscroll-contain">
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
                  <span>
                    {displayCurrency === 'EUR' ? 
                      `${displayAmount.toFixed(2)} €` : 
                      `${displayAmount.toFixed(2)} Kč`
                    }
                    {payInEUR && (
                      <span className="text-sm text-gray-500 ml-2">
                        ({totalAmount} Kč)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>


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
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={paidAmount ? String(Math.trunc(paidAmount)) : ''}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/\D/g, '');
                        setPaidAmount(digitsOnly ? parseInt(digitsOnly, 10) : 0);
                      }}
                      placeholder="0"
                      className="w-full px-4 py-3 border border-blue-300 dark:border-blue-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  
                  {/* Výběr měny - vždy deaktivovaný */}
                  <div className="relative">
                    <select
                      value={payInEUR ? 'EUR' : paidCurrency}
                      disabled={true}
                      className="px-4 py-3 border border-blue-300 dark:border-blue-600 rounded-xl bg-gray-100 dark:bg-gray-600 text-gray-500 dark:text-gray-400 font-medium cursor-not-allowed appearance-none pr-4 opacity-50"
                    >
                      <option value="CZK">🇨🇿 Kč</option>
                      <option value="EUR">🇪🇺 €</option>
                    </select>
                  </div>
                </div>

                {/* Výpočet částky k vrácení */}
                {paidAmount > 0 && (
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-blue-200 dark:border-blue-600 shadow-sm">
                    <div className="flex justify-between items-center text-sm mb-3">
                      <span className="text-blue-700 dark:text-blue-300 font-medium">Zaplaceno:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {payInEUR ? 
                          `${paidAmount.toFixed(2)} €` : 
                          `${paidAmount} ${paidCurrency === 'CZK' ? 'Kč' : '€'}`
                        }
                        {payInEUR && (
                          <span className="text-xs text-gray-500 ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-lg">
                            ({(paidAmount * eurRate).toFixed(2)} Kč)
                          </span>
                        )}
                        {!payInEUR && paidCurrency === 'EUR' && (
                          <span className="text-xs text-gray-500 ml-2 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-lg">
                            ({paidAmountInCZK.toFixed(2)} Kč)
                          </span>
                        )}
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span className="text-green-600 dark:text-green-400">Vrátit:</span>
                      <span className="text-green-600 dark:text-green-400">
                        {changeAmount > 0 ? (
                          `${changeAmount.toFixed(2)} Kč`
                        ) : changeAmount < 0 ? (
                          `0 Kč`
                        ) : (
                          '0 Kč'
                        )}
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

            {/* QR kód obrazovka */}
            {paymentMethod === 'qr' && hasIban && !isRefund && (
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm">
                <div className="flex items-center mb-4">
                  <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-3">
                    <QrCode className="h-4 w-4 text-purple-700 dark:text-purple-300" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Platba QR kódem
                  </h4>
                </div>

                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm flex items-center justify-center">
                  <QRCode value={getSpaydString()} size={220} />
                </div>

                <div className="mt-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handlePayment}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    Dokončit prodej
                  </motion.button>
                </div>
              </div>
            )}

            {/* Payment Method */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Způsob platby
              </h3>

            {/* Jméno zákazníka - pouze pro bistro */}
            {storeType === 'bistro' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Jméno
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Zadejte jméno zákazníka"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            )}
              
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
                  <span className="font-medium text-gray-900 dark:text-white">Karta</span>
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
                  <span className="font-medium text-gray-900 dark:text-white">Hotovost</span>
                </button>
              </div>
              
              {/* Spodní řada: Platba v eurech + QR kód (QR jen když je IBAN) */}
              {(paymentMethod === 'cash' || paymentMethod === 'qr') && (
                <div className="mt-3">
                  <div className={`grid grid-cols-2 gap-3 ${hasIban && !isRefund ? '' : 'grid-cols-1'}`}>
                    <button
                      onClick={() => { setPaymentMethod('cash'); setPayInEUR(!payInEUR); }}
                      className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                        payInEUR
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      <Euro className="h-5 w-5 mr-2 text-blue-600" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {payInEUR ? 'Eura (zapnuto)' : 'Eura'}
                      </span>
                    </button>

                    {hasIban && !isRefund && (
                      <button
                        onClick={() => { setPayInEUR(false); setPaymentMethod('qr'); }}
                        className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                          paymentMethod === 'qr'
                            ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                        }`}
                      >
                        <QrCode className="h-5 w-5 mr-2 text-purple-600" />
                        <span className="font-medium text-gray-900 dark:text-white">QR kód</span>
                      </button>
                    )}
                  </div>
                  {payInEUR && (
                    <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                      <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                        <Euro className="h-4 w-4 mr-2" />
                        <span>
                          Celková částka: {displayAmount.toFixed(2)} € (kurz: {eurRate} Kč/EUR)
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* SumUp info - pouze při platbě kartou */}
              {paymentMethod === 'card' && sumUpAvailable && redirectToSumUp && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                    <CreditCard className="h-4 w-4 mr-2" />
                    <span>
                      Platba kartou proběhne přes SumUp aplikaci. Po kliknutí "Zaplatit" se otevře SumUp app s předvyplněnou částkou {totalAmount} Kč.
                    </span>
                  </div>
                </div>
              )}

              {/* Chybějící affiliate key - může způsobit chybu při volbě terminálu */}
              {paymentMethod === 'card' && sumUpAvailable && redirectToSumUp && !sumUpAffiliateKeyConfigured && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                  <div className="flex items-center text-sm text-red-700 dark:text-red-300">
                    <CreditCard className="h-4 w-4 mr-2" />
                    <span>
                      Chybí SumUp affiliate key. Tap to Pay může fungovat, ale platba přes terminál často selže chybou připojení k serveru.
                    </span>
                  </div>
                </div>
              )}
              
              {/* SumUp vypnuté - pouze při platbě kartou */}
              {paymentMethod === 'card' && sumUpAvailable && !redirectToSumUp && (
                <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                  <div className="flex items-center text-sm text-green-700 dark:text-green-300">
                    <CreditCard className="h-4 w-4 mr-2" />
                    <span>
                      Platba kartou se zaznamená pouze do dokladu. SumUp aplikace se neotevře.
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
                disabled={loading || (paymentMethod === 'card' && !canProceedWithCard)}
                className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Zpracování...
                  </div>
                ) : (
                  isRefund ? 
                    `Vrátit zákazníkovi ${refundAmount} Kč` : 
                    displayCurrency === 'EUR' ? 
                      `Zaplatit ${displayAmount.toFixed(2)} €` : 
                      `Zaplatit ${displayAmount.toFixed(2)} Kč`
                )}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
