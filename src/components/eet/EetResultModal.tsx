'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Clock, Info, Loader2, RotateCw, XCircle } from 'lucide-react';
import { shortPok, type EetResultView } from '@/lib/eetUi';

interface EetResultModalProps {
  view: EetResultView;
  /** Částka dokladu k zobrazení (např. „81,60 Kč“). */
  amountLabel?: string;
  /** U SumUp: řádek „Platba ✓“ nad stavem EET (jedno okno se dvěma řádky, kap. 6.3). */
  paymentConfirmed?: boolean;
  autoCloseSec: number;
  onClose: () => void;
  onRetry?: () => Promise<void>;
}

const TONE = {
  success: { ring: 'bg-green-100 dark:bg-green-900/20', icon: <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" /> },
  error: { ring: 'bg-red-100 dark:bg-red-900/20', icon: <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" /> },
  timeout: { ring: 'bg-orange-100 dark:bg-orange-900/20', icon: <Clock className="w-12 h-12 text-orange-600 dark:text-orange-400" /> },
  pending: { ring: 'bg-gray-100 dark:bg-gray-700', icon: <Loader2 className="w-12 h-12 text-brand-600 animate-spin" /> },
  info: { ring: 'bg-blue-100 dark:bg-blue-900/20', icon: <Info className="w-12 h-12 text-blue-600 dark:text-blue-400" /> },
} as const;

/** Okno s výsledkem evidence, vzhledem stejné jako popup „Platba byla úspěšná“ v POSSystem. */
export const EetResultModal: React.FC<EetResultModalProps> = ({ view, amountLabel, paymentConfirmed, autoCloseSec, onClose, onRetry }) => {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showFullPok, setShowFullPok] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const autoClose = view.tone === 'success' || view.tone === 'info';
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Samo se zavře jen úspěch / informace; chybu musí obsluha vidět.
  useEffect(() => {
    setCountdown(autoClose ? autoCloseSec : null);
  }, [autoClose, autoCloseSec]);

  useEffect(() => {
    if (countdown === null || showFullPok) return;
    if (countdown <= 0) {
      onCloseRef.current();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, showFullPok]);

  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const tone = TONE[view.tone];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="eet-result-title"
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Zavřít"
          className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400"
        >
          ✕
        </button>

        <motion.div
          key={view.tone}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
          className={`mx-auto w-20 h-20 ${tone.ring} rounded-full flex items-center justify-center mb-5`}
        >
          {tone.icon}
        </motion.div>

        {paymentConfirmed && (
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-700 dark:text-green-400 mb-2">
            <CheckCircle className="w-4 h-4" aria-hidden="true" /> Platba proběhla
          </div>
        )}

        <h3 id="eet-result-title" className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          {view.title}
        </h3>

        {view.playground && view.tone === 'success' && (
          <span className="inline-block mb-3 px-2 py-0.5 rounded text-[11px] font-bold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
            TEST – POK neplatný
          </span>
        )}

        {view.message && <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{view.message}</p>}
        {view.hint && <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{view.hint}</p>}

        {(amountLabel || view.receiptNo || view.pok) && (
          <dl className="mt-4 mb-4 text-sm text-left grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            {amountLabel && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">Částka</dt>
                <dd className="font-semibold text-gray-900 dark:text-white text-right">{amountLabel}</dd>
              </>
            )}
            {view.receiptNo && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">Doklad</dt>
                <dd className="font-mono text-gray-900 dark:text-white text-right">{view.receiptNo}</dd>
              </>
            )}
            {view.pok && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">POK</dt>
                <dd className="text-right">
                  <button
                    type="button"
                    onClick={() => setShowFullPok((v) => !v)}
                    className="font-mono text-gray-900 dark:text-white break-all text-right hover:underline"
                    title={showFullPok ? 'Zkrátit' : 'Zobrazit celý POK'}
                  >
                    {showFullPok ? view.pok : shortPok(view.pok)}
                  </button>
                </dd>
              </>
            )}
          </dl>
        )}

        {view.warnings.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-left text-sm text-amber-800 dark:text-amber-200">
            {view.warnings.map((w) => (
              <div key={w} className="flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                {w}
              </div>
            ))}
          </div>
        )}

        {view.canRetry && onRetry && (
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Zavřít
            </button>
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="flex-1 px-4 py-2.5 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
              Odeslat znovu
            </button>
          </div>
        )}

        {countdown !== null && !showFullPok && <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Okno se zavře za {countdown} s</p>}
      </motion.div>
    </motion.div>
  );
};
