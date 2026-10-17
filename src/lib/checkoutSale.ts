// Objekt prodeje z checkoutu (CheckoutModal). Čisté funkce, aby šlo testem doložit, že bez EET
// se ukládá přesně tentýž dokument jako dřív (tests/checkoutSale.test.ts).
// Pole i hodnoty jsou 1:1 převzaté z původního `handlePayment`; `createdAt` doplní volající.

import type { CartItem } from '@/types';

type Discount = { type: 'percentage' | 'amount'; value: number } | null | undefined;

export interface CommonSaleParams {
  cart: CartItem[];
  /** Částka k úhradě v Kč včetně spropitného */
  actualTotalAmount: number;
  /** Původní částka košíku v Kč */
  totalAmount: number;
  storeId: string;
  userId: string;
  /** Už vyhodnocené jméno zákazníka (null, pokud se nesbírá) */
  customerName: string | null;
  isRefund: boolean;
  refundAmount: number;
  discount: Discount;
  discountAmount: number | undefined;
  /** Spropitné v měně dokladu */
  tipParsed: number;
}

export function buildQrSaleDraft(p: CommonSaleParams & { documentId: string; variableSymbol: string }) {
  return {
    items: p.cart,
    totalAmount: p.actualTotalAmount,
    paymentMethod: 'qr' as const,
    currency: 'CZK' as const,
    eurRate: null,
    originalAmountCZK: p.totalAmount,
    documentId: p.documentId,
    variableSymbol: p.variableSymbol,
    storeId: p.storeId,
    userId: p.userId,
    customerName: p.customerName,
    isRefund: p.isRefund,
    refundAmount: p.isRefund ? p.refundAmount : null,
    paidAmount: null,
    paidCurrency: null,
    changeAmount: null,
    changeAmountEUR: null,
    discount: p.discount || null,
    discountAmount: p.discountAmount || 0,
    finalAmount: p.actualTotalAmount,
    tipAmount: p.tipParsed > 0 ? p.tipParsed : null,
    served: false,
  };
}

export interface CashCardSaleParams extends CommonSaleParams {
  paymentMethod: 'cash' | 'card';
  documentId: string;
  payInEUR: boolean;
  eurAmount: number;
  eurRate: number;
  paidAmount: number;
  paidCurrency: 'CZK' | 'EUR';
  changeAmountCZK: number;
  changeAmountInEUR: number;
  redirectToSumUp: boolean;
  /** Ručně zadaný kód SumUp transakce (už oříznutý) */
  manualSumUpCode: string;
}

export function buildCashCardSaleDraft(p: CashCardSaleParams) {
  const isCash = p.paymentMethod === 'cash';
  return {
    items: p.cart,
    totalAmount: p.payInEUR ? p.eurAmount : p.actualTotalAmount,
    paymentMethod: p.paymentMethod,
    currency: (p.payInEUR ? 'EUR' : 'CZK') as 'EUR' | 'CZK',
    eurRate: p.payInEUR ? p.eurRate : null,
    originalAmountCZK: p.totalAmount,
    documentId: p.documentId,
    storeId: p.storeId,
    userId: p.userId,
    customerName: p.customerName,
    isRefund: p.isRefund,
    refundAmount: p.isRefund ? p.refundAmount : null,
    paidAmount: isCash ? p.paidAmount : null,
    paidCurrency: isCash ? (p.payInEUR ? 'EUR' : p.paidCurrency) : null,
    changeAmount: isCash ? (p.payInEUR ? null : p.changeAmountCZK) : null,
    changeAmountEUR: isCash && p.payInEUR ? p.changeAmountInEUR : null,
    discount: p.discount || null,
    discountAmount: p.discountAmount || 0,
    finalAmount: p.actualTotalAmount,
    tipAmount: p.tipParsed > 0 ? p.tipParsed : null,
    sumUpData:
      p.paymentMethod === 'card' && !p.redirectToSumUp && p.manualSumUpCode
        ? {
            foreignTxId: p.documentId,
            sumUpTxCode: p.manualSumUpCode,
            status: 'success' as const,
            callbackReceived: false,
          }
        : null,
    served: false,
  };
}

export type SaleDraftObject = ReturnType<typeof buildQrSaleDraft> | ReturnType<typeof buildCashCardSaleDraft>;

/** Data pro SumUp návrat v localStorage. `eet: true` jen u prodejny se zapnutým EET. */
export function buildSumUpPaymentData(
  p: {
    storeId: string;
    userId: string;
    cart: CartItem[];
    actualTotalAmount: number;
    documentId: string;
    timestamp: number;
    discount: Discount;
    discountAmount: number | undefined;
    tipAmountKc: number;
    customerName: string | null;
  },
  eetEnabled: boolean
) {
  return {
    storeId: p.storeId,
    userId: p.userId,
    cartItems: p.cart,
    totalAmount: p.actualTotalAmount,
    currency: 'CZK',
    documentId: p.documentId,
    foreignTxId: p.documentId, // Použijeme documentId jako foreignTxId pro SumUp
    timestamp: p.timestamp,
    discount: p.discount || null,
    discountAmount: p.discountAmount || 0,
    finalAmount: p.actualTotalAmount,
    tipAmount: p.tipAmountKc > 0 ? p.tipAmountKc : 0,
    customerName: p.customerName,
    ...(eetEnabled ? { eet: true as const } : {}),
  };
}

/**
 * Doklad uložený z klienta u prodejny s EET, když /api/sales/finalize nejde zavolat (offline,
 * chyba serveru). Číslo dokladu a odeslání do EET dodělá server z fronty (`pendingNumber`).
 * Testovací doklad jde frontou taky (jen kvůli číslu); `registerSale` ho nikdy neodešle.
 */
export function withOfflineEet<T extends object>(sale: T, now: Date) {
  return {
    ...sale,
    pendingNumber: true,
    eet: { status: 'queued' as const, saleAt: now.toISOString(), nextRetryAt: now },
  };
}
