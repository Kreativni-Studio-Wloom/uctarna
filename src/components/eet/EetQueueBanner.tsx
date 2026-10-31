'use client';

import React, { useState } from 'react';
import { AlertTriangle, Clock, Loader2, RotateCw } from 'lucide-react';
import { eetQueueBannerText, summarizeEetQueue, type EetSaleLike } from '@/lib/eetUi';

interface EetQueueBannerProps {
  sales: EetSaleLike[];
  now: Date;
  /** „Odeslat nyní“ (fronta prodejny). */
  onRetry?: () => Promise<void>;
  /** Proklik do historie s filtrem chyb. */
  onShow?: () => void;
  className?: string;
}

const TONES = {
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100',
  warning: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-100',
  danger: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100',
} as const;

/** „X dokladů čeká na odeslání do EET“ – po 24 h oranžový, po 48 h / při trvalé chybě červený. */
export const EetQueueBanner: React.FC<EetQueueBannerProps> = ({ sales, now, onRetry, onShow, className = '' }) => {
  const [busy, setBusy] = useState(false);
  const summary = summarizeEetQueue(sales, now);
  if (summary.count === 0) return null;

  const retry = async () => {
    if (!onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className={`flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg border text-sm ${TONES[summary.tone]} ${className}`}>
      {summary.tone === 'info' ? <Clock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 min-w-[12rem]">{eetQueueBannerText(summary)}</span>
      {onShow && (
        <button type="button" onClick={onShow} className="font-medium underline underline-offset-2 hover:opacity-80">
          Zobrazit
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/70 dark:bg-black/20 font-medium hover:bg-white dark:hover:bg-black/30 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
          Odeslat nyní
        </button>
      )}
    </div>
  );
};
