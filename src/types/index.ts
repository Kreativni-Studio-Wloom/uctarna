export interface User {
  uid: string;
  email: string;
  displayName?: string | null; // Změněno pro kompatibilitu s Firestore
  createdAt: Date;
  settings: UserSettings;
}

export interface UserSettings {
  eurRate: number; // Kurz EUR
  theme: 'light' | 'dark' | 'auto';
}

export interface Store {
  id: string;
  name: string;
  type: 'prodejna' | 'bistro';
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  redirectToSumUp?: boolean; // Nastavení pro přesměrování na SumUp při platbě kartou
}

export interface Product {
  id: string;
  name: string;
  price: number; // v Kč
  cost?: number; // Náklady na produkt (nepovinné)
  category?: string;
  isPopular: boolean;
  soldCount: number; // Počet historicky prodaných kusů
  createdAt: Date;
  updatedAt: Date;
  // Produkt může být označen jako extra (doplněk k hlavní položce)
  isExtra?: boolean;
}

export interface CartItem {
  // Jedinečný identifikátor položky v košíku (pro vazby parent-child)
  itemId?: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  // Pokud je položka extra, odkazuje na itemId hlavní položky
  parentItemId?: string | null;
}

export interface PendingPurchase {
  id: string;
  items: CartItem[];
  totalAmount: number; // v Kč (může být záporné pro vratky)
  discount?: { type: 'percentage' | 'amount'; value: number } | null;
  finalAmount: number; // v Kč po slevě
  createdAt: Date;
  storeId: string;
  userId: string;
  note?: string; // Volitelná poznámka k odloženému nákupu
}

export interface Sale {
  id: string;
  documentId?: string; // Unikátní 10místné ID dokladu
  items: CartItem[];
  totalAmount: number; // v Kč nebo EUR (může být záporné pro vratky)
  paymentMethod: 'cash' | 'card'; // SumUp funguje automaticky při platbě kartou
  currency: 'CZK' | 'EUR'; // Měna platby
  eurRate?: number; // Kurz EUR při platbě v eurech
  originalAmountCZK?: number; // Původní částka v korunách pro reference
  createdAt: Date;
  storeId: string;
  userId: string;
  // Jméno zákazníka (bistra)
  customerName?: string;
  isRefund?: boolean; // Identifikace vratky
  refundAmount?: number; // Částka vratky (absolutní hodnota)
  sumUpData?: SumUpTransactionData; // SumUp specifická data (pouze při platbě kartou)
  // Informace o vrácení při platbě v eurech
  paidAmount?: number; // Zaplacená částka (pouze při hotovostní platbě)
  paidCurrency?: 'CZK' | 'EUR'; // Měna zaplacené částky
  changeAmount?: number; // Částka k vrácení v korunách
  changeAmountEUR?: number; // Částka k vrácení v eurech (pouze při platbě v eurech)
  // Sleva
  discount?: { type: 'percentage' | 'amount'; value: number } | null;
  discountAmount?: number; // Částka slevy v Kč
  finalAmount?: number; // Finální částka po slevě
  // Výdej (kuchyně): označení, že objednávka byla připravena a vydána
  prepared?: boolean;
  preparedAt?: Date;
  served?: boolean;
  servedAt?: Date;
}

export interface SumUpTransactionData {
  foreignTxId: string; // Vlastní transaction ID
  sumUpTxCode?: string; // SumUp transaction kód (po callback)
  status: 'pending' | 'success' | 'failed';
  callbackReceived?: boolean;
  callbackTimestamp?: Date;
}

export interface Receipt extends Sale {
  receiptNumber: string;
  type: 'sale' | 'refund';
}

export interface DailyReport {
  date: string;
  totalSales: number;
  cashSales: number;
  cardSales: number; // Zahrnuje i SumUp platby (automaticky při kartě)
  customerCount: number;
  sales: Sale[];
}

export interface MonthlyReport {
  month: string;
  totalSales: number;
  cashSales: number;
  cardSales: number; // Zahrnuje i SumUp platby (automaticky při kartě)
  customerCount: number;
  dailyReports: DailyReport[];
}
