'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, DollarSign, Euro, Calculator, QrCode } from 'lucide-react';
import { CartItem } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sumUpService, SumUpService, SumUpPaymentParams } from '@/lib/sumup';
import QRCode from 'react-qr-code';
import { autoPrintReceipt } from '@/lib/receiptPrinter';
import type { Sale } from '@/types';
import { TestSaleToggle } from './TestSaleToggle';
import { defaultTestSaleState, resolveIsTestSale, testSalesUiEnabled, withTestFlag } from '@/lib/testSales';
import { buildCashCardSaleDraft, buildQrSaleDraft, buildSumUpPaymentData, type SaleDraftObject } from '@/lib/checkoutSale';
import { decideSaleSavePath, isEetEnabled } from '@/lib/eet/flags';
import { saveSaleWithEet, type EetSaveResult } from '@/lib/eetCheckout';
import { defaultEvidenceChoice, resolveCheckoutEvidence, type EetEvidenceChoice } from '@/lib/eetUi';
import { EetEvidenceRow } from '@/components/eet/EetEvidenceRow';

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
  /** ID testovacích produktů; doklad jen s nimi má přepínač „Testovací prodej“ zapnutý. */
  testProductIds?: string[];
  /** EET 2.0 (jen při zapnutém EET): výsledek uložení přes /api/sales/finalize (POS ukáže okno výsledku). */
  onEetResult?: (result: EetSaveResult, sale: { saleId: string; amountLabel: string; isTest: boolean }) => void;
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
  finalAmount,
  testProductIds,
  onEetResult
}) => {
  const { user } = useAuth();
  const storeDoc = useStore();
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
  const [manualSumUpCode, setManualSumUpCode] = useState('');
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [tipInput, setTipInput] = useState('');
  const [iban, setIban] = useState<string>('');
  const [qrDocumentId, setQrDocumentId] = useState<string>(''); // 10 chars (existing format)
  const [qrVariableSymbol, setQrVariableSymbol] = useState<string>(''); // numeric only
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [testSaleToggle, setTestSaleToggle] = useState(() => defaultTestSaleState(cart, testProductIds ?? []));
  // Bez zapnutého vypínače prodejny je prodej vždy reálný (chování jako dřív).
  const showTestSaleToggle = testSalesUiEnabled(storeDoc);
  // EET 2.0: řádek „Evidovat v EET“ nahrazuje přepínač testovacího prodeje (jen při zapnutém EET).
  const eetEnabled = isEetEnabled(storeDoc);
  const [eetChoice, setEetChoice] = useState<EetEvidenceChoice>(() => defaultEvidenceChoice(defaultTestSaleState(cart, testProductIds ?? [])));

  const [eurRate, setEurRate] = useState<number>(25.0);
  const baseAmount = finalAmount !== undefined ? finalAmount : totalAmount;
  const tipParsed =
    tipsEnabled && baseAmount >= 0
      ? Math.max(0, parseFloat(tipInput.replace(/\s/g, '').replace(',', '.') || '') || 0)
      : 0;
  /** Příspěvek spropitného k celkové částce v Kč (u plateb v EUR je vstup v €). */
  const tipAmountKč = payInEUR ? tipParsed * eurRate : tipParsed;
  const actualTotalAmount = baseAmount + tipAmountKč;
  const isRefund = baseAmount < 0;
  const eurAmount = actualTotalAmount / eurRate;

  // Výpočet částky k vrácení
  let changeAmountCZK: number;
  let changeAmountInEUR: number;
  let paidAmountInCZK: number;
  
  if (payInEUR) {
    // Při platbě v eurech: vrací se vždy v eurech
    const paidAmountInEUR = paidCurrency === 'EUR' ? paidAmount : paidAmount / eurRate;
    changeAmountInEUR = paidAmountInEUR - eurAmount; // Zaplacená částka minus hodnota nákupu
    changeAmountCZK = changeAmountInEUR * eurRate; // pouze informativní přepočet
    paidAmountInCZK = paidAmountInEUR * eurRate; // Pro zobrazení - přepočítat zaplacenou částku na koruny
  } else {
    // Při platbě v korunách: standardní výpočet
    paidAmountInCZK = paidCurrency === 'EUR' ? paidAmount * eurRate : paidAmount;
    changeAmountCZK = paidAmountInCZK - actualTotalAmount;
    changeAmountInEUR = changeAmountCZK / eurRate;
  }

  // Aktuální částka pro zobrazení (v eurech pokud je vybrána platba v eurech)
  const displayAmount = payInEUR ? eurAmount : actualTotalAmount;
  const displayCurrency = payInEUR ? 'EUR' : 'CZK';

  const refundAmount = Math.abs(baseAmount);

  // Deaktivace platby kartou při vratce
  const canUseCard = !isRefund;
  const eetEvidence = eetEnabled
    ? resolveCheckoutEvidence({ store: storeDoc, choice: eetChoice, viaSumUpRedirect: paymentMethod === 'card' && sumUpAvailable && redirectToSumUp })
    : null;
  const isTestSale = eetEvidence ? eetEvidence.isTest : showTestSaleToggle && resolveIsTestSale(storeDoc, testSaleToggle);
  // Testovací prodej kartou neprochází SumUp terminálem, uloží se jen doklad.
  const requiresSumUpRedirect = paymentMethod === 'card' && sumUpAvailable && redirectToSumUp && !isTestSale;
  const canProceedWithCard = !requiresSumUpRedirect || sumUpAffiliateKeyConfigured;
  const hasIban = Boolean(iban && iban.trim().length > 0);
  const canUseQr = !isRefund && displayCurrency === 'CZK' && paymentMethod !== 'card' ? hasIban : hasIban && !isRefund; // guard; UI also checks
  const customerNameEnabled = storeDoc?.customerNameEnabled !== false;
  const collectCustomerName = storeType === 'bistro' && customerNameEnabled;

  // Nastavení prodejny sdílená z StoreContext (bez duplicitního Firestore listeneru).
  useEffect(() => {
    if (typeof window !== 'undefined') {
      SumUpService.detectSumUpApp().then(setSumUpAvailable);
      setSumUpAffiliateKeyConfigured(sumUpService.hasAffiliateKeyConfigured());
    }
  }, []);

  useEffect(() => {
    if (!storeDoc) return;
    if (typeof storeDoc.eurRate === 'number') {
      setEurRate(storeDoc.eurRate);
    }
    if (storeDoc.type === 'prodejna' || storeDoc.type === 'bistro') {
      setStoreType(storeDoc.type);
    }
    if (typeof storeDoc.redirectToSumUp === 'boolean') {
      setRedirectToSumUp(storeDoc.redirectToSumUp);
    }
    if (typeof storeDoc.iban === 'string') {
      setIban(storeDoc.iban);
    } else {
      setIban('');
    }
    if (typeof storeDoc.tipsEnabled === 'boolean') {
      setTipsEnabled(storeDoc.tipsEnabled);
    }
  }, [storeDoc]);

  useEffect(() => {
    if (!tipsEnabled) setTipInput('');
  }, [tipsEnabled]);

  useEffect(() => {
    if (!collectCustomerName) setCustomerName('');
  }, [collectCustomerName]);

  useEffect(() => {
    setTipInput('');
  }, [payInEUR]);

  // Poslech výsledku platby z návratové stránky (BroadcastChannel + storage event)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('uctarna_payments');
      bc.onmessage = (ev) => {
        if (ev?.data?.type === 'PAYMENT_SUCCESS') {
          // Uložení prodeje (vč. spropitného z terminálu) řeší POSSystem přes pendingSave.
          if (ev?.data?.pendingSave) return;
          onSuccess();
        }
      };
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'uctarna_payment_result' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (data?.type === 'PAYMENT_SUCCESS') {
            if (data?.pendingSave) return;
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

  useEffect(() => {
    if (paymentMethod !== 'qr') setQrFullscreen(false);
  }, [paymentMethod]);

  useEffect(() => {
    if (!qrFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setQrFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [qrFullscreen]);

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

  const openSumUpManualRedirect = () => {
    if (typeof window === 'undefined') return;
    try {
      // V manuálním režimu jen otevřeme SumUp app bez předání transakčních dat.
      window.location.assign('sumupmerchant://');
    } catch (error) {
      console.error('❌ Chyba při manuálním otevření SumUp app:', error);
    }
  };

  const commonSaleParams = (userId: string) => ({
    cart,
    actualTotalAmount,
    totalAmount,
    storeId,
    userId,
    customerName: collectCustomerName ? (customerName || null) : null,
    isRefund,
    refundAmount,
    discount,
    discountAmount,
    tipParsed,
  });

  // Bez zapnutého EET (decideSaleSavePath → 'legacy') přesně jako dřív: addDoc + soldCount z klienta.
  // Se zapnutým EET: /api/sales/finalize (číslo dokladu a EET na serveru), offline záloha z klienta.
  const saveSale = async (userId: string, draft: SaleDraftObject) => {
    const legacySave = async () => {
      const saleRef = await addDoc(collection(db, 'users', userId, 'stores', storeId, 'sales'), withTestFlag({ ...draft, createdAt: serverTimestamp() }, isTestSale));
      // Tisk běží na pozadí – pokladna nečeká na tiskárnu.
      autoPrintReceipt({ ...draft, id: saleRef.id, createdAt: new Date() } as unknown as Sale, storeDoc);

      // Aktualizuj počet prodaných kusů pro každý produkt (vratky se odečítají)
      for (const item of cart) {
        const productRef = doc(db, 'users', userId, 'stores', storeId, 'products', item.productId);
        await updateDoc(productRef, {
          soldCount: increment(item.quantity), // item.quantity je záporné pro vratky
          updatedAt: serverTimestamp()
        });
      }
    };
    if (decideSaleSavePath(storeDoc) === 'legacy') {
      await legacySave();
      return;
    }
    const result = await saveSaleWithEet({
      uid: userId,
      storeId,
      draft,
      isTest: isTestSale,
      nonEvidenceReason: eetEvidence?.nonEvidenceReason,
      legacySave,
    });
    if (result.kind !== 'legacy') {
      autoPrintReceipt({ ...draft, id: draft.documentId, createdAt: new Date() } as unknown as Sale, storeDoc);
    }
    const amountLabel = draft.currency === 'EUR' ? `${draft.totalAmount.toFixed(2)} €` : `${draft.totalAmount.toFixed(2)} Kč`;
    onEetResult?.(result, { saleId: draft.documentId, amountLabel, isTest: isTestSale });
  };

  const handlePayment = async () => {
    if (!user) return;

    setLoading(true);
    try {
      if (paymentMethod === 'qr') {
        if (!hasIban) return;
        const documentId = qrDocumentId || SumUpService.generateDocumentId();
        const variableSymbol = qrVariableSymbol;
        const sale = buildQrSaleDraft({
          ...commonSaleParams(user.uid),
          documentId,
          variableSymbol,
        });

        await saveSale(user.uid, sale);

        onSuccess();
        return;
      }

      if (requiresSumUpRedirect && !sumUpAffiliateKeyConfigured) {
        alert('Chybí SumUp affiliate key. Nastavte NEXT_PUBLIC_SUMUP_AFFILIATE_KEY a restartujte aplikaci.');
        return;
      }

      // SumUp platba kartou - otevře se až při kliknutí "Zaplatit kartou"
      if (requiresSumUpRedirect && !isRefund) {
        // Vygenerujeme unikátní ID dokladu
        const documentId = SumUpService.generateDocumentId();

        // Uložíme kompletní informace o platbě do localStorage pro callback navigaci a opakování
        // `eet: true` jen při zapnutém EET: číslo dokladu a odeslání pak řeší server v callbacku.
        localStorage.setItem('uctarna_payment_data', JSON.stringify(buildSumUpPaymentData({
          storeId,
          userId: user.uid,
          cart,
          actualTotalAmount,
          documentId,
          timestamp: Date.now(),
          discount,
          discountAmount,
          tipAmountKc: tipAmountKč,
          customerName: collectCustomerName ? (customerName || null) : null
        }, isEetEnabled(storeDoc))));
        
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
      const trimmedManualSumUpCode = manualSumUpCode.trim();
      // Hotovostní vratka (záporná částka) jde se zapnutým EET jako záporná tržba.
      const sale = buildCashCardSaleDraft({
        ...commonSaleParams(user.uid),
        paymentMethod: paymentMethod as 'cash' | 'card',
        documentId,
        payInEUR,
        eurAmount,
        eurRate,
        paidAmount,
        paidCurrency,
        changeAmountCZK,
        changeAmountInEUR,
        redirectToSumUp,
        manualSumUpCode: trimmedManualSumUpCode,
      });

      await saveSale(user.uid, sale);

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
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-2 sm:p-4"
        onClick={() => {
          if (qrFullscreen) {
            setQrFullscreen(false);
            return;
          }
          onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-brand-500 to-brand-700 px-5 py-3 short:py-2.5 sm:px-6 tall:py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CreditCard className="h-5 w-5 text-white mr-3" />
                <h2 className="text-lg font-semibold text-white">
                  Dokončit nákup
                </h2>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 text-white hover:text-gray-200 transition-colors rounded-lg hover:bg-white hover:bg-opacity-20 flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-5 py-4 short:py-3 sm:px-6 tall:py-5 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3.5 short:space-y-2.5 tall:space-y-5">
            {/* Cart Summary */}
            <div>
              <h3 className="hidden tall:block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2.5">
                Přehled nákupu
              </h3>
              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-gray-700 dark:text-gray-300 truncate">
                      {item.productName} × {item.quantity}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">
                      {item.price * item.quantity} Kč
                    </span>
                  </div>
                ))}
              </div>

              {/* Jméno zákazníka (bistro) + spropitné vedle sebe */}
              {(collectCustomerName || (tipsEnabled && !isRefund)) && (
                <div
                  className={`grid gap-3 mt-3 tall:mt-4 ${
                    collectCustomerName && tipsEnabled && !isRefund ? 'grid-cols-[3fr_2fr]' : 'grid-cols-1'
                  }`}
                >
                  {collectCustomerName && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                        Jméno
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Jméno zákazníka"
                        className="w-full px-3 py-2 tall:py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  )}
                  {tipsEnabled && !isRefund && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                        {payInEUR ? 'Spropitné (€)' : 'Spropitné (Kč)'}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tipInput}
                        onChange={(e) => setTipInput(e.target.value)}
                        placeholder="0"
                        className="w-full px-3 py-2 tall:py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 tall:mt-4">
                <div className="flex justify-between items-baseline text-lg font-bold text-gray-900 dark:text-white">
                  <span>{tipsEnabled && !isRefund && tipParsed > 0 ? 'K úhradě:' : 'Celkem:'}</span>
                  <span>
                    {displayCurrency === 'EUR' ?
                      `${displayAmount.toFixed(2)} €` :
                      `${displayAmount.toFixed(2)} Kč`
                    }
                    {payInEUR && (
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        ({totalAmount} Kč)
                      </span>
                    )}
                  </span>
                </div>
                {((tipsEnabled && !isRefund && tipParsed > 0) || payInEUR) && (
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>
                      {tipsEnabled && !isRefund && tipParsed > 0 && (
                        <>
                          Po slevě{' '}
                          {payInEUR
                            ? `${(baseAmount / eurRate).toFixed(2)} €`
                            : `${baseAmount.toFixed(2)} Kč`}
                          {' '}+ spropitné {payInEUR ? `${tipParsed.toFixed(2)} €` : `${tipParsed.toFixed(2)} Kč`}
                        </>
                      )}
                    </span>
                    {payInEUR && <span>kurz {eurRate} Kč/€</span>}
                  </div>
                )}
              </div>
            </div>

            {eetEvidence && <EetEvidenceRow evidence={eetEvidence} choice={eetChoice} onChange={setEetChoice} />}

            {!eetEvidence && showTestSaleToggle && (
              <TestSaleToggle
                checked={isTestSale}
                locked={storeDoc?.testMode === true}
                onChange={setTestSaleToggle}
              />
            )}

            {/* Informace o vratce */}
            {isRefund && (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                <div className="flex items-center text-sm">
                  <svg className="h-4 w-4 text-red-600 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  <span className="text-red-700 dark:text-red-300 font-medium">
                    Vratka: Zákazníkovi se musí vrátit {refundAmount} Kč
                  </span>
                </div>
              </div>
            )}

            {/* Payment Method – všechny volby v jedné řadě */}
            <div>
              <h3 className="hidden tall:block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2.5">
                Způsob platby
              </h3>
              <div className={`grid gap-2.5 sm:gap-3 ${hasIban && !isRefund ? 'grid-cols-4' : 'grid-cols-3'}`}>
                <button
                  onClick={() => setPaymentMethod('card')}
                  disabled={!canUseCard}
                  title={!canUseCard ? 'Karta je u vratky nedostupná' : undefined}
                  className={`py-2.5 short:py-2 tall:py-3 px-1 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                    paymentMethod === 'card'
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  } ${
                    !canUseCard ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <CreditCard className="h-5 w-5 text-brand-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Karta</span>
                </button>

                <button
                  onClick={() => { setPaymentMethod('cash'); setPayInEUR(false); }}
                  className={`py-2.5 short:py-2 tall:py-3 px-1 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                    paymentMethod === 'cash' && !payInEUR
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <DollarSign className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Hotovost</span>
                </button>

                <button
                  onClick={() => { setPaymentMethod('cash'); setPayInEUR(!(payInEUR && paymentMethod === 'cash')); }}
                  className={`py-2.5 short:py-2 tall:py-3 px-1 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                    payInEUR
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <Euro className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">Eura</span>
                </button>

                {hasIban && !isRefund && (
                  <button
                    onClick={() => { setPayInEUR(false); setPaymentMethod('qr'); }}
                    className={`py-2.5 short:py-2 tall:py-3 px-1 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center gap-1 ${
                      paymentMethod === 'qr'
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    <QrCode className="h-5 w-5 text-brand-600" />
                    <span className="text-sm font-medium text-gray-900 dark:text-white">QR kód</span>
                  </button>
                )}
              </div>
            </div>

            {/* Zaplaceno / Vrátit - pouze při platbě hotovostí */}
            {paymentMethod === 'cash' && (
              <div className="p-3.5 short:p-3 tall:p-4 bg-gradient-to-r from-brand-50 to-brand-100 dark:from-brand-900/20 dark:to-brand-800/20 rounded-xl border border-brand-200 dark:border-brand-700">
                <div className="grid grid-cols-2 gap-3 sm:gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-brand-700 dark:text-brand-300 mb-1.5">
                      Zaplaceno
                    </label>
                    <div className="relative">
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
                        className="w-full pl-3 pr-9 py-2 tall:py-2.5 border border-brand-300 dark:border-brand-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500 dark:text-gray-400 pointer-events-none">
                        {payInEUR || paidCurrency === 'EUR' ? '€' : 'Kč'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs font-semibold text-green-600 dark:text-green-400 mb-1.5">
                      Vrátit
                    </span>
                    <div className="h-[46px] tall:h-[50px] px-3 bg-white dark:bg-gray-800 rounded-lg border border-brand-200 dark:border-brand-600 flex items-center justify-end">
                      <span className="text-lg font-bold text-green-600 dark:text-green-400 whitespace-nowrap">
                        {paidAmount <= 0 ? (
                          '—'
                        ) : payInEUR ? (
                          changeAmountInEUR > 0 ? `${changeAmountInEUR.toFixed(2)} €` : '0 €'
                        ) : changeAmountCZK > 0 ? (
                          `${changeAmountCZK.toFixed(2)} Kč`
                        ) : (
                          '0 Kč'
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {paidAmount > 0 && (
                  ((payInEUR && changeAmountInEUR < 0) || (!payInEUR && changeAmountCZK < 0)) ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      ⚠️ Zaplaceno méně než celková částka
                    </p>
                  ) : payInEUR ? (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Zaplaceno {(paidAmount * eurRate).toFixed(2)} Kč
                      {changeAmountInEUR > 0 && ` · vrátit informačně ${(changeAmountInEUR * eurRate).toFixed(2)} Kč`}
                    </p>
                  ) : !payInEUR && paidCurrency === 'EUR' ? (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Zaplaceno {paidAmountInCZK.toFixed(2)} Kč
                    </p>
                  ) : null
                )}
              </div>
            )}

            {/* QR kód – vedle textu, aby se vešel i na nižší displeje */}
            {paymentMethod === 'qr' && hasIban && !isRefund && (
              <button
                type="button"
                onClick={() => setQrFullscreen(true)}
                className="group w-full p-3 short:p-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 flex items-center gap-4 text-left transition-all duration-200 hover:border-brand-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                aria-label="Zvětšit QR kód na celou obrazovku"
              >
                <div className="shrink-0 bg-white p-2 rounded-lg w-[clamp(88px,calc(100dvh_-_664px),168px)] tall:w-[clamp(104px,calc(100dvh_-_764px),168px)]">
                  <QRCode
                    value={getSpaydString()}
                    size={168}
                    className="block"
                    style={{ display: 'block', height: 'auto', maxWidth: '100%', width: '100%' }}
                    viewBox="0 0 256 256"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm text-gray-600 dark:text-gray-300">Naskenujte v bankovní aplikaci</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{actualTotalAmount.toFixed(2)} Kč</p>
                  <p className="text-xs text-brand-600 dark:text-brand-300 group-hover:underline">Klepněte pro zvětšení</p>
                </div>
              </button>
            )}

            {/* SumUp info - pouze při platbě kartou */}
            {requiresSumUpRedirect && (
              <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex items-center text-xs text-blue-700 dark:text-blue-300">
                  <CreditCard className="h-4 w-4 mr-2 shrink-0" />
                  <span>
                    Po kliknutí na „Zaplatit“ se otevře SumUp s předvyplněnou částkou {actualTotalAmount.toFixed(2)} Kč.
                  </span>
                </div>
              </div>
            )}

            {/* Chybějící affiliate key - může způsobit chybu při volbě terminálu */}
            {requiresSumUpRedirect && !sumUpAffiliateKeyConfigured && (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                <div className="flex items-center text-xs text-red-700 dark:text-red-300">
                  <CreditCard className="h-4 w-4 mr-2 shrink-0" />
                  <span>
                    Chybí SumUp affiliate key. Tap to Pay může fungovat, ale platba přes terminál často selže chybou připojení k serveru.
                  </span>
                </div>
              </div>
            )}

            {paymentMethod === 'card' && sumUpAvailable && redirectToSumUp && isTestSale && (
              <div className="px-3 py-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg">
                <div className="flex items-center text-xs text-orange-700 dark:text-orange-300">
                  <CreditCard className="h-4 w-4 mr-2 shrink-0" />
                  <span>Testovací prodej kartou se neodesílá do SumUp. Uloží se jen testovací doklad.</span>
                </div>
              </div>
            )}

            {/* SumUp vypnuté - pouze při platbě kartou */}
            {paymentMethod === 'card' && sumUpAvailable && !redirectToSumUp && (
              <div className="space-y-2">
                <p className="text-xs text-green-700 dark:text-green-300">
                  Platba kartou se zaznamená pouze do dokladu. SumUp aplikace se neotevře.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualSumUpCode}
                    onChange={(e) => setManualSumUpCode(e.target.value)}
                    placeholder="Kód transakce (nepovinné)"
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={openSumUpManualRedirect}
                    className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-gray-800 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/20 transition-all duration-200"
                  >
                    Otevřít SumUp
                  </button>
                </div>
              </div>
            )}

            {/* SumUp nedostupná - pouze při platbě kartou */}
            {paymentMethod === 'card' && !sumUpAvailable && (
              <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                <div className="flex items-center text-xs text-yellow-700 dark:text-yellow-300">
                  <CreditCard className="h-4 w-4 mr-2 shrink-0" />
                  <span>
                    SumUp aplikace není dostupná. Pro platbu kartou nainstalujte SumUp app.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons – vždy viditelné dole */}
          <div className="shrink-0 flex gap-3 px-5 py-3.5 short:py-3 sm:px-6 tall:py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onClose}
              className="w-1/3 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200"
            >
              Zrušit
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handlePayment}
              disabled={loading || (paymentMethod === 'card' && !canProceedWithCard)}
              className="flex-1 bg-gradient-to-r from-brand-500 to-brand-700 text-white px-4 py-3 rounded-lg font-medium hover:from-brand-600 hover:to-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Zpracování...
                </div>
              ) : (
                isRefund ?
                  (displayCurrency === 'EUR'
                    ? `Vrátit zákazníkovi ${displayAmount.toFixed(2)} €`
                    : `Vrátit zákazníkovi ${refundAmount} Kč`) :
                  paymentMethod === 'qr' ?
                    'Dokončit prodej' :
                  displayCurrency === 'EUR' ?
                    `Zaplatit ${displayAmount.toFixed(2)} €` :
                    `Zaplatit ${displayAmount.toFixed(2)} Kč`
              )}
            </motion.button>
          </div>
        </motion.div>

        <AnimatePresence>
          {qrFullscreen && paymentMethod === 'qr' && hasIban && !isRefund && (
            <motion.div
              key="qr-fullscreen"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[80] flex flex-col bg-gray-950/90 backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                setQrFullscreen(false);
              }}
              role="dialog"
              aria-modal="true"
              aria-label="QR kód na celou obrazovku"
            >
              <div className="flex items-center justify-between px-5 py-4 shrink-0">
                <div className="flex items-center min-w-0">
                  <div className="w-9 h-9 bg-brand-500/20 rounded-lg flex items-center justify-center mr-3">
                    <QrCode className="h-5 w-5 text-brand-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">Platba QR kódem</p>
                    <p className="text-sm text-gray-400 truncate">
                      {actualTotalAmount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQrFullscreen(false);
                  }}
                  className="w-11 h-11 text-white/90 hover:text-white transition-colors rounded-xl hover:bg-white/10 flex items-center justify-center"
                  aria-label="Zavřít zvětšený QR kód"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="flex-1 flex items-center justify-center px-4 min-h-0">
                <motion.div
                  initial={{ scale: 0.92, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                  className="bg-white rounded-3xl p-5 sm:p-8 shadow-2xl flex items-center justify-center"
                  style={{
                    width: 'min(92vw, calc(100dvh - 12rem))',
                    height: 'min(92vw, calc(100dvh - 12rem))',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <QRCode
                    value={getSpaydString()}
                    size={512}
                    style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
                    viewBox="0 0 256 256"
                  />
                </motion.div>
              </div>

              <div
                className="shrink-0 px-5 pb-6 pt-3 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-center text-sm text-gray-400">
                  Namiřte fotoaparát bankovní aplikace na kód
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePayment}
                  disabled={loading}
                  className="w-full max-w-lg mx-auto block bg-gradient-to-r from-brand-500 to-brand-700 text-white px-4 py-3.5 rounded-xl font-medium hover:from-brand-600 hover:to-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? 'Zpracování...' : 'Dokončit prodej'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};
