'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { resolveEetSettings } from '@/lib/eet/flags';
import { sendSaleToEet } from '@/lib/eetClient';
import type { EetSaveResult } from '@/lib/eetCheckout';
import { autoCloseSeconds, eetResultView, shouldShowEetResult, type EetSaleLike } from '@/lib/eetUi';
import type { Store } from '@/types';
import { EetResultModal } from './EetResultModal';

/** Co má okno sledovat: výsledek checkoutu (hotovost/QR/karta bez SumUp) nebo SumUp doklad. */
export type EetResultSource =
  | { kind: 'checkout'; saleId: string; save: EetSaveResult; amountLabel?: string; isTest?: boolean }
  | { kind: 'sumup'; saleId: string };

interface EetResultHostProps {
  uid: string;
  storeId: string;
  store: Pick<Store, 'eet'> | null;
  source: EetResultSource;
  onClose: () => void;
}

const fmtAmount = (sale: EetSaleLike) => {
  if (typeof sale.totalAmount !== 'number') return undefined;
  return sale.currency === 'EUR' ? `${sale.totalAmount.toFixed(2)} €` : `${sale.totalAmount.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč`;
};

/**
 * Okno výsledku EET v POS. Stav dokladu sleduje živě přes onSnapshot (`sales/{saleId}`),
 * takže zachytí i dokončení SumUp callbacku, frontu a ruční „Odeslat znovu“.
 */
export const EetResultHost: React.FC<EetResultHostProps> = ({ uid, storeId, store, source, onClose }) => {
  const initial: EetSaleLike | null =
    source.kind === 'checkout' && source.save.kind === 'finalized'
      ? { receiptNo: source.save.result.receiptNo, eet: source.save.result.eet ?? null }
      : null;
  const [sale, setSale] = useState<EetSaleLike | null>(initial);

  useEffect(() => {
    return onSnapshot(
      doc(db, 'users', uid, 'stores', storeId, 'sales', source.saleId),
      (snap) => {
        if (snap.exists()) setSale(snap.data() as EetSaleLike);
      },
      (e) => console.warn('EET okno (posluchač dokladu):', e)
    );
  }, [uid, storeId, source.saleId]);

  const settings = resolveEetSettings(store?.eet);
  const offline = source.kind === 'checkout' && source.save.kind === 'offline' && !sale?.receiptNo && !sale?.eet?.pok;
  const view = eetResultView({
    eet: sale?.eet,
    receiptNo: sale?.receiptNo,
    isTest: source.kind === 'checkout' ? source.isTest || sale?.isTest === true : sale?.isTest === true,
    offline,
    timeoutMs: settings.sendTimeoutMs,
  });
  const paymentConfirmed = source.kind === 'sumup';
  const visible = paymentConfirmed || (view.tone !== 'pending' && shouldShowEetResult(view, store?.eet?.showResultModal));

  // Režim „jen při chybě“: po úspěchu okno vůbec neukazovat.
  useEffect(() => {
    if (!paymentConfirmed && view.tone !== 'pending' && !visible) onClose();
  }, [paymentConfirmed, view.tone, visible, onClose]);

  const retry = useCallback(async () => {
    try {
      const r = await sendSaleToEet(storeId, source.saleId);
      setSale((s) => ({ ...(s ?? {}), receiptNo: r.receiptNo ?? s?.receiptNo, eet: r.eet ?? s?.eet }));
    } catch (e) {
      setSale((s) => ({ ...(s ?? {}), eet: { ...(s?.eet ?? {}), status: s?.eet?.status ?? 'queued', message: (e as Error).message } }));
    }
  }, [storeId, source.saleId]);

  if (!visible) return null;
  return (
    <EetResultModal
      view={view}
      amountLabel={(source.kind === 'checkout' ? source.amountLabel : undefined) ?? (sale ? fmtAmount(sale) : undefined)}
      paymentConfirmed={paymentConfirmed}
      autoCloseSec={autoCloseSeconds(store?.eet)}
      onClose={onClose}
      onRetry={retry}
    />
  );
};
