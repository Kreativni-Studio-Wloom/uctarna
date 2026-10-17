// Vypínač EET a výchozí nastavení. Bez 'server-only': importuje ho i klient (CheckoutModal, POS).
// Neimportovat přes '@/lib/eet' (index tahá serverové moduly), ale přímo '@/lib/eet/flags'.

import type { EetEnvironmentId, Store, StoreEetSettings } from '@/types';

type StoreLike = Pick<Store, 'eet'> | null | undefined;

/** EET je zapnuté jen při `store.eet.enabled === true`. Jinak se vše chová jako před EET. */
export function isEetEnabled(store: StoreLike): boolean {
  return store?.eet?.enabled === true;
}

export interface ResolvedEetSettings {
  enabled: boolean;
  environment: EetEnvironmentId;
  eic: string;
  unitId: number;
  registerId: string;
  tipsAreBusinessIncome: boolean;
  sendTimeoutMs: number;
  receiptSeries: { prefix: string; resetYearly: boolean };
}

export const DEFAULT_REGISTER_ID = 'WEB1';
export const DEFAULT_SEND_TIMEOUT_MS = 4000;
export const DEFAULT_RECEIPT_SERIES = { prefix: '{YYYY}-', resetYearly: true } as const;

export function resolveEetSettings(eet: StoreEetSettings | undefined | null): ResolvedEetSettings {
  const s = eet ?? {};
  const timeout = typeof s.sendTimeoutMs === 'number' && Number.isFinite(s.sendTimeoutMs) ? s.sendTimeoutMs : DEFAULT_SEND_TIMEOUT_MS;
  return {
    enabled: s.enabled === true,
    environment: s.environment === 'production' ? 'production' : 'playground',
    eic: (s.eic ?? '').trim().toUpperCase(),
    unitId: typeof s.unitId === 'number' ? s.unitId : Number(s.unitId ?? NaN),
    registerId: (s.registerId ?? '').trim() || DEFAULT_REGISTER_ID,
    tipsAreBusinessIncome: s.tipsAreBusinessIncome !== false,
    sendTimeoutMs: Math.max(2000, timeout),
    receiptSeries: {
      prefix: typeof s.receiptSeries?.prefix === 'string' ? s.receiptSeries.prefix : DEFAULT_RECEIPT_SERIES.prefix,
      resetYearly: s.receiptSeries?.resetYearly ?? DEFAULT_RECEIPT_SERIES.resetYearly,
    },
  };
}

/** Kam checkout uloží prodej: 'legacy' = přesně jako před EET (addDoc z klienta), 'finalize' = /api/sales/finalize. */
export type SaleSavePath = 'legacy' | 'finalize';

export function decideSaleSavePath(store: StoreLike): SaleSavePath {
  return isEetEnabled(store) ? 'finalize' : 'legacy';
}

/** Stavy, které ještě čekají na odeslání (fronta). */
export const EET_OPEN_STATUSES = ['pending', 'queued'] as const;
