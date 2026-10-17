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

import type { ColorSchemeId } from '@/lib/colorScheme';

export type { ColorSchemeId };

export interface Store {
  id: string;
  name: string;
  type: 'prodejna' | 'bistro';
  companyName?: string;
  ico?: string;
  companyAddress?: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  redirectToSumUp?: boolean; // Nastavení pro přesměrování na SumUp při platbě kartou
  /** Kurz EUR pro tuto prodejnu (přepisuje uživatelské nastavení). */
  eurRate?: number;
  /** ID produktů připnutých v POS mřížce. */
  pinnedProductIds?: string[];
  /** Zapnuté zadávání spropitného v checkoutu (přičte se k úhradě, uloží se na doklad). */
  tipsEnabled?: boolean;
  /** Jméno zákazníka u objednávky v checkoutu (typicky bistro). Vypnuté = pole se nezobrazí. */
  customerNameEnabled?: boolean;
  iban?: string; // IBAN pro platby QR kódem (SPAYD)
  /** Barevné schéma designu prodejny — legacy preset ID. */
  colorScheme?: ColorSchemeId;
  /** Odstín na kole barev (0–360). */
  brandHue?: number;
  /** Intenzita odstínu (0 = světlý, 100 = tmavý). */
  brandShade?: number;
  /** Režim školení: každý prodej je testovací (`Sale.isTest`), přes POS svítí pruh. */
  testMode?: boolean;
  /** V reálném režimu ukáže v checkoutu přepínač „Testovací prodej“. */
  testSalesEnabled?: boolean;
  /** DIČ prodejny (pro EET je to EIČ). */
  dic?: string;
  /** EET 2.0. Chybí nebo `enabled !== true` = EET vypnuto, aplikace se chová jako dřív. */
  eet?: StoreEetSettings;
}

export type EetEnvironmentId = 'playground' | 'production';

/** Časový údaj ve Firestore (Timestamp z klientského i Admin SDK, případně Date). */
export type FirestoreTime = Date | { toDate(): Date; toMillis(): number };

/** Nastavení EET prodejny (`users/{uid}/stores/{storeId}.eet`). Vše nepovinné, výchozí hodnoty viz `src/lib/eet/flags.ts`. */
export interface StoreEetSettings {
  /** Hlavní vypínač. Jen `true` zapíná EET. */
  enabled?: boolean;
  environment?: EetEnvironmentId;
  /** EIČ = DIČ, `CZ` + 8–10 číslic */
  eic?: string;
  /** Číslo evidenční jednotky z DIS+ */
  unitId?: number;
  /** id_pokl, výchozí 'WEB1' */
  registerId?: string;
  /** Zda je spropitné příjmem podniku (zahrne se do celk_trzba). Výchozí true. */
  tipsAreBusinessIncome?: boolean;
  /** Mezní doba odezvy, min. 2000, výchozí 4000 */
  sendTimeoutMs?: number;
  showResultModal?: 'always' | 'errorsOnly';
  autoCloseSuccessSec?: number;
  /** Jen metadata; certifikát a heslo jsou šifrovaně v `private/eet`. */
  certificate?: {
    subjectEic: string;
    serial: string;
    validFrom: FirestoreTime;
    validTo: FirestoreTime;
    uploadedAt: FirestoreTime;
    env: EetEnvironmentId;
  };
  /** Číselná řada. `{YYYY}` v prefixu se nahradí rokem. Výchozí `{ prefix: '{YYYY}-', resetYearly: true }`. */
  receiptSeries?: { prefix: string; resetYearly: boolean };
}

export type SaleEetStatus = 'test' | 'not_required' | 'pending' | 'sent' | 'queued' | 'failed_permanent';

export interface SaleEetAttempt {
  uuid: string;
  sentAt: string;
  first: boolean;
  result: 'ok' | 'error' | 'timeout' | 'network';
  code?: number;
  text?: string;
  xGlobalTransactionId?: string;
  ms: number;
}

/** Stav EET na dokladu (`sale.eet`). Zapisuje jen server. */
export interface SaleEet {
  status: SaleEetStatus;
  env?: EetEnvironmentId;
  verify?: boolean;
  /** Sekce Data, zmrazená při 1. pokusu; při opakování se nemění. */
  data?: {
    eic: string;
    unitId: number;
    registerId: string;
    porad_cis: string;
    dat_trzby: string;
    celk_trzba: string;
  };
  pok?: string;
  /** dat_prij */
  receivedAt?: string;
  warnings?: { code: number; text: string }[];
  attempts?: SaleEetAttempt[];
  nextRetryAt?: FirestoreTime | null;
  /** Kvůli lhůtě 48 h. Nastaví se těsně před 1. odesláním. */
  firstAttemptAt?: FirestoreTime;
  /** U 'not_required' (např. bezhotovostní vratka) */
  reason?: string;
  /** Offline záloha z checkoutu s výjimkou z evidence: server doklad očísluje a nastaví 'not_required' s tímto důvodem. */
  exemptReason?: string;
  /** Okamžik tržby (ISO), zdroj pro dat_trzby, dokud nejsou data zmrazená. */
  saleAt?: string;
  /** Poslední zpráva pro obsluhu (česky). */
  message?: string;
  /** Uplynulo 48 h od 1. pokusu a doklad stále není zaevidován. */
  overdue?: boolean;
  /** Kolikrát přišla chyba 8 (po 3. je trvalá). */
  code8Count?: number;
  /** Zámek proti souběžnému odeslání (idempotence). */
  lockUntil?: FirestoreTime | null;
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
  /** Testovací produkt: doklad jen s takovými produkty se v checkoutu sám označí jako testovací. */
  isTestProduct?: boolean;
}

export interface CartItem {
  // Jedinečný identifikátor položky v košíku (pro vazby parent-child)
  itemId?: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  // Nákupní cena zafixovaná v okamžiku prodeje (pozdější změny v katalogu ji neovlivní)
  cost?: number | null;
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
  variableSymbol?: string; // Variabilní symbol (numeric) pro SPAYD/QR
  items: CartItem[];
  totalAmount: number; // v Kč nebo EUR (může být záporné pro vratky)
  paymentMethod: 'cash' | 'card' | 'qr'; // SumUp funguje automaticky při platbě kartou, QR pro SPAYD
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
  /** Spropitné v měně dokladu (CZK nebo EUR); celková úhrada je v totalAmount / finalAmount včetně spropitného. */
  tipAmount?: number;
  // Výdej (kuchyně): označení, že objednávka byla připravena a vydána
  prepared?: boolean;
  preparedAt?: Date;
  served?: boolean;
  servedAt?: Date;
  /** Testovací doklad: nepočítá se do tržeb, neodesílá se do EET. Chybí = reálný doklad. */
  isTest?: boolean;
  /** EET 2.0: pořadové číslo dokladu (= porad_cis), přiděluje server. */
  receiptNo?: string;
  /** EET 2.0: doklad uložený offline, číslo přidělí server dodatečně. */
  pendingNumber?: boolean;
  /** EET 2.0: stav evidence. Chybí u prodejen bez EET a u starých dokladů. */
  eet?: SaleEet;
  /** U storna (záporného dokladu): id původního dokladu. */
  stornoOf?: string;
  /** U původního dokladu po stornu. */
  storno?: { by: string; at: FirestoreTime; saleId: string };
  /** Kopie dokladu z „Duplikovat prodejnu“: odkud pochází (kopie nemá receiptNo ani eet). */
  copiedFrom?: { storeId: string; saleId: string; receiptNo?: string };
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
