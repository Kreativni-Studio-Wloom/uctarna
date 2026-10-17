import 'server-only';
import type { Sale } from '@/types';

/*
 * Částka pro celk_trzba v Kč. Čistá funkce (bez I/O).
 *
 * Jak Účtárna ukládá prodej (CheckoutModal):
 *  - `finalAmount` je vždy v Kč, po slevě a včetně spropitného (u EUR přepočteného kurzem);
 *  - `totalAmount` je v měně dokladu (u EUR v eurech), u vratek záporné;
 *  - `tipAmount` je v měně dokladu (u EUR v eurech).
 */

export type EetAmountSale = Pick<Sale, 'totalAmount' | 'currency'> &
  Partial<Pick<Sale, 'finalAmount' | 'eurRate' | 'tipAmount' | 'paymentMethod'>>;

export interface EetAmountOptions {
  /** Spropitné je příjmem podniku → eviduje se. Jinak se odečte. */
  tipsAreBusinessIncome: boolean;
  /** Hotovost v Kč se přijímá zaokrouhlená na celé koruny → evidovat zaokrouhleně. */
  roundCashToWholeCzk?: boolean;
}

const round2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON) / 100;

export function computeEetAmountCZK(sale: EetAmountSale, opts: EetAmountOptions): number {
  const isEur = sale.currency === 'EUR';
  const rate = isEur ? sale.eurRate : 1;
  if (isEur && !(typeof rate === 'number' && Number.isFinite(rate) && rate > 0)) {
    throw new Error('EET: doklad v EUR nemá kurz (eurRate)');
  }
  const r = rate as number;

  const toNum = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const finalCzk = toNum(sale.finalAmount);
  let czk = finalCzk ?? sale.totalAmount * r;

  const tip = toNum(sale.tipAmount);
  if (!opts.tipsAreBusinessIncome && tip && tip > 0) czk -= tip * r;

  if (opts.roundCashToWholeCzk && sale.paymentMethod === 'cash' && !isEur) {
    czk = Math.sign(czk) * Math.round(Math.abs(czk));
  }
  const out = round2(czk);
  return Object.is(out, -0) ? 0 : out;
}
