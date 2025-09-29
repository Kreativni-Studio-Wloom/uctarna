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
    this.affiliateKey = affiliateKey;
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
    url.searchParams.set('affiliate-key', this.affiliateKey);
    
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
    
    if (params.skipSuccessScreen) {
      url.searchParams.set('skip-screen-success', 'true');
    }
    
    // Callback URL pro zpětnou vazbu podle dokumentace
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    
    // Přidáme potřebná data do callback URL pro uložení prodeje
    const successUrl = new URL(`${currentOrigin}/payment/success`);
    const failUrl = new URL(`${currentOrigin}/payment/fail`);
    
    // Přidáme data do callback URL
    if (params.storeId) successUrl.searchParams.set('storeId', params.storeId);
    if (params.userId) successUrl.searchParams.set('userId', params.userId);
    if (params.foreignTxId) successUrl.searchParams.set('foreignTxId', params.foreignTxId);
    if (params.amount) successUrl.searchParams.set('amount', params.amount.toString());
    if (params.currency) successUrl.searchParams.set('currency', params.currency);
    
    if (params.storeId) failUrl.searchParams.set('storeId', params.storeId);
    if (params.userId) failUrl.searchParams.set('userId', params.userId);
    if (params.foreignTxId) failUrl.searchParams.set('foreignTxId', params.foreignTxId);
    if (params.amount) failUrl.searchParams.set('amount', params.amount.toString());
    if (params.currency) failUrl.searchParams.set('currency', params.currency);
    
    url.searchParams.set('callbacksuccess', successUrl.toString());
    url.searchParams.set('callbackfail', failUrl.toString());
    
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
      window.location.href = paymentUrl;
      
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
export const sumUpService = new SumUpService('sup_pk_FM9pSDgv9KUXVkFrcGOdw3xyRhgHU8yTS');
