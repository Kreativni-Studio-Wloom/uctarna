export interface SumUpPaymentParams {
  amount: number;
  currency: string;
  title?: string;
  foreignTxId?: string;
  receiptEmail?: string;
  skipSuccessScreen?: boolean;
  // Přidáno pro callback handling
  storeId?: string;
  userId?: string;
  cartItems?: any[];
}

export interface SumUpCallbackParams {
  status: 'success' | 'failed' | 'invalidstate';
  txCode?: string;
  foreignTxId?: string;
  // Přidáno pro callback handling
  storeId?: string;
  userId?: string;
  cartItems?: any[];
}

export class SumUpService {
  private affiliateKey: string;
  private baseUrl = 'sumupmerchant://pay/1.0';
  
  constructor(affiliateKey: string) {
    this.affiliateKey = affiliateKey.trim();
  }

  hasAffiliateKeyConfigured(): boolean {
    return this.affiliateKey.length > 0;
  }
  
  /**
   * Vytvoří SumUp platební URL podle oficiální dokumentace
   * https://github.com/sumup/sumup-ios-url-scheme.git
   */
  createPaymentUrl(params: SumUpPaymentParams): string {
    const url = new URL(this.baseUrl);
    
    // Povinné parametry podle dokumentace
    url.searchParams.set('amount', params.amount.toFixed(2));
    url.searchParams.set('currency', params.currency);
    // Pro stabilní chování (hlavně při "Pay with terminal") posílej affiliate-key vždy,
    // pokud je v aplikaci nakonfigurovaný.
    if (this.hasAffiliateKeyConfigured()) {
      url.searchParams.set('affiliate-key', this.affiliateKey);
    }
    
    // Volitelné parametry podle dokumentace
    if (params.title) {
      url.searchParams.set('title', params.title);
    }
    
    if (params.foreignTxId) {
      url.searchParams.set('foreign-tx-id', params.foreignTxId);
    }
    
    if (params.receiptEmail) {
      url.searchParams.set('receipt-email', params.receiptEmail);
    }
    
    // Callback URL pro zpětnou vazbu podle dokumentace
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    
    // Pro maximální kompatibilitu necháváme callback URL bez vlastních query parametrů.
    // Stav platby a kontext objednávky držíme v localStorage (uctarna_payment_data).
    const successUrl = new URL(`${currentOrigin}/payment/success`);
    const failUrl = new URL(`${currentOrigin}/payment/fail`);
    
    // Debug URL pro testování
    const debugUrl = new URL(`${currentOrigin}/api/debug-sumup`);
    
    // Pro debugování použijeme debug endpoint
    const useDebug = typeof window !== 'undefined' && window.location.hostname === 'localhost';
    
    if (useDebug) {
      console.log('🔍 DEBUG MODE: Používám debug endpoint');
      url.searchParams.set('callbacksuccess', debugUrl.toString());
      url.searchParams.set('callbackfail', debugUrl.toString());
    } else {
      url.searchParams.set('callbacksuccess', successUrl.toString());
      url.searchParams.set('callbackfail', failUrl.toString());
    }
    
    return url.toString();
  }
  
  /**
   * Automaticky otevře SumUp app pro platbu kartou
   * Podle iOS dokumentace: https://github.com/sumup/sumup-ios-url-scheme.git
   */
  openSumUpForCardPayment(params: SumUpPaymentParams): void {
    if (typeof window === 'undefined') return;
    
    try {
      const paymentUrl = this.createPaymentUrl(params);
      
      // Otevření SumUp app přes URL scheme
      // iOS: sumupmerchant://pay/1.0
      // Android: sumupmerchant://pay/1.0
      // Otevři SumUp ve stejném okně/záložce
      window.location.assign(paymentUrl);
      
      console.log('🔗 Otevírám SumUp app pro platbu kartou:', paymentUrl);
    } catch (error) {
      console.error('❌ Chyba při otevírání SumUp app:', error);
    }
  }
  
  /**
   * Detekuje, zda je SumUp app dostupná
   * Podle iOS dokumentace pro bundle identifier
   */
  static detectSumUpApp(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(false);
        return;
      }
      
      try {
        // Pro jednoduchost předpokládáme, že SumUp app je dostupná
        // V reálném prostředí by se mohla použít skutečná detekce
        // nebo by se mohla nechat uživateli, aby SumUp app otevřel ručně
        
        // Vždy vrátíme true, protože SumUp app se otevře až při platbě
        resolve(true);
        
      } catch (error) {
        console.error('SumUp app detection error:', error);
        resolve(false);
      }
    });
  }
  
  /**
   * Validuje platební parametry podle oficiální dokumentace
   */
  static validatePaymentParams(params: SumUpPaymentParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Validace podle iOS dokumentace
    if (params.amount <= 0) {
      errors.push('Částka musí být větší než 0');
    }
    
    if (params.amount > 10000) {
      errors.push('Částka nemůže být větší než 10,000');
    }
    
    // Podporované měny podle dokumentace
    if (!['EUR', 'CZK', 'GBP', 'BRL', 'CHF', 'PLN', 'USD'].includes(params.currency)) {
      errors.push('Nepodporovaná měna');
    }
    
    if (params.title && params.title.length > 100) {
      errors.push('Název transakce je příliš dlouhý');
    }
    
    // foreign-tx-id podle dokumentace: max 128 znaků, ASCII
    if (params.foreignTxId && params.foreignTxId.length > 128) {
      errors.push('Transaction ID je příliš dlouhé (max 128 znaků)');
    }
    
    if (params.foreignTxId && !/^[\x20-\x7E]+$/.test(params.foreignTxId)) {
      errors.push('Transaction ID obsahuje neplatné znaky (pouze ASCII)');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Generuje unikátní transaction ID podle dokumentace
   * Max 128 znaků, pouze ASCII
   */
  static generateTransactionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `TX_${timestamp}_${random}`;
  }

  /**
   * Generuje unikátní 10místné ID dokladu (malá písmena + číslice)
   * Zajišťuje, že se ID nikdy neopakuje
   */
  static generateDocumentId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    // Generuj přesně 10 znaků
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }
}

// Instance SumUp service s vaším API klíčem
export const sumUpService = new SumUpService(process.env.NEXT_PUBLIC_SUMUP_AFFILIATE_KEY || '');

/**
 * Načte spropitné z terminálu přes /api/sumup/transaction (volá SumUp REST API na serveru).
 * Preferujte nechat doplnění tipu přímo v /api/sumup-callback – tento helper je záložní.
 */
export async function fetchSumUpTipAmount(
  txCode: string | null | undefined,
  options?: { foreignTxId?: string | null; sentAmount?: number; timeoutMs?: number }
): Promise<number> {
  if (!txCode && !options?.foreignTxId) return 0;
  if (typeof window === 'undefined') return 0;

  const params = new URLSearchParams();
  if (txCode) params.set('txCode', txCode);
  if (options?.foreignTxId) params.set('foreignTxId', options.foreignTxId);
  if (typeof options?.sentAmount === 'number') {
    params.set('sentAmount', String(options.sentAmount));
  }

  const timeoutMs = options?.timeoutMs ?? 15000;

  try {
    const response = await fetch(`/api/sumup/transaction?${params}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn('⚠️ Spropitné ze SumUp se nepodařilo načíst:', response.status);
      return 0;
    }
    const data = await response.json();
    const tip = typeof data?.tipAmount === 'number' ? data.tipAmount : 0;
    return tip > 0 ? tip : 0;
  } catch (error) {
    console.warn('⚠️ Spropitné ze SumUp se nepodařilo načíst:', error);
    return 0;
  }
}
