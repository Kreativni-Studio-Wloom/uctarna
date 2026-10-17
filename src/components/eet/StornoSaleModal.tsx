'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, RotateCcw } from 'lucide-react';

interface StornoSaleModalProps {
  receiptLabel: string;
  amountLabel: string;
  isCash: boolean;
  onClose: () => void;
  onStorno: () => Promise<void>;
}

/** Potvrzení storna (u prodejny s EET místo mazání, kap. 6.4). */
export const StornoSaleModal: React.FC<StornoSaleModalProps> = ({ receiptLabel, amountLabel, isCash, onClose, onStorno }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onStorno();
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Storno se nepodařilo.');
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="storno-title"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-orange-600 to-orange-700 px-6 py-4 flex items-center">
          <RotateCcw className="h-6 w-6 text-white mr-3" aria-hidden="true" />
          <h3 id="storno-title" className="text-xl font-semibold text-white">
            Stornovat doklad
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Vznikne nový doklad se zápornou částkou a novým číslem. Původní doklad {receiptLabel} ({amountLabel}) zůstane v historii s odkazem na storno.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isCash
              ? 'Hotovostní vratka se odešle do EET jako záporná tržba.'
              : 'Bezhotovostní vratka (karta / QR) se do EET neeviduje. Peníze zákazníkovi vraťte v SumUp / bance.'}
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="flex-1 bg-orange-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
              {busy ? 'Stornuji…' : 'Stornovat'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
