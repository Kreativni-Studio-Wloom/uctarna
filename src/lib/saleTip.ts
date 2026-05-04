import { Sale } from '@/types';

/** Přepočte uložené spropitné dokladu na Kč (pro součty v přehledech a uzávěrkách). */
export function saleTipInCzk(sale: Pick<Sale, 'tipAmount' | 'currency' | 'eurRate'>): number {
  const t = sale.tipAmount ?? 0;
  if (t <= 0) return 0;
  if (sale.currency === 'EUR' && typeof sale.eurRate === 'number') {
    return t * sale.eurRate;
  }
  return t;
}
