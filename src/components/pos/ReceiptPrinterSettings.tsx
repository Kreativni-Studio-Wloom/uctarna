'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Printer, Bluetooth } from 'lucide-react';
import { detectBrowser, getBluefySameWindow, getBluefyVariant } from '@/lib/browserReturn';
import {
  PaperWidth,
  PRINTER_STATUS_EVENT,
  PrinterStatus,
  forgetPrinter,
  getPaperWidth,
  getPrinterStatus,
  hasSavedPrinter,
  isAutoPrintEnabled,
  pairPrinter,
  printTestReceipt,
  setAutoPrintEnabled,
  setPaperWidth,
} from '@/lib/receiptPrinter';

type ReceiptStoreData = {
  companyName?: string;
  ico?: string;
  companyAddress?: string;
};

/** Nastavení Bluetooth tiskárny. Ukládá se do tohoto zařízení, ne do prodejny. */
export const ReceiptPrinterSettings: React.FC<{ store: ReceiptStoreData }> = ({ store }) => {
  const [autoPrint, setAutoPrint] = useState(false);
  const [paperWidth, setPaperWidthState] = useState<PaperWidth>(58);
  const [status, setStatus] = useState<PrinterStatus>({ supported: true, connected: false, deviceName: null });
  const [savedPrinter, setSavedPrinter] = useState(false);
  const [busy, setBusy] = useState<null | 'pair' | 'test'>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setAutoPrint(isAutoPrintEnabled());
    setPaperWidthState(getPaperWidth());
    setStatus(getPrinterStatus());
    setSavedPrinter(hasSavedPrinter());
    const onStatus = () => {
      setStatus(getPrinterStatus());
      setSavedPrinter(hasSavedPrinter());
    };
    window.addEventListener(PRINTER_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(PRINTER_STATUS_EVENT, onStatus);
  }, []);

  const describeError = (error: unknown) => {
    if (error instanceof Error) {
      if (error.name === 'NotFoundError') return 'Výběr tiskárny byl zrušen.';
      return error.message;
    }
    return 'Neznámá chyba';
  };

  const handlePair = async () => {
    setBusy('pair');
    setMessage(null);
    try {
      await pairPrinter();
      setMessage({ kind: 'ok', text: 'Tiskárna připojena.' });
    } catch (error) {
      setMessage({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    setMessage(null);
    try {
      await printTestReceipt(store);
      setMessage({ kind: 'ok', text: 'Zkušební doklad odeslán na tiskárnu.' });
    } catch (error) {
      setMessage({ kind: 'error', text: describeError(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleAutoPrint = (enabled: boolean) => {
    setAutoPrint(enabled);
    setAutoPrintEnabled(enabled);
  };

  const handlePaperWidth = (width: PaperWidth) => {
    setPaperWidthState(width);
    setPaperWidth(width);
  };

  // null = nejsme v Bluefy (řádek se nezobrazí), jinak zda je návrat ze SumUp nastavený.
  const [bluefyReturn, setBluefyReturn] = useState<'same-window' | 'new-tab' | false | null>(null);
  useEffect(() => {
    if (detectBrowser() !== 'bluefy') return;
    setBluefyReturn(getBluefySameWindow() ? 'same-window' : getBluefyVariant() ? 'new-tab' : false);
  }, []);

  const statusText = !status.supported
    ? 'Tento prohlížeč neumí Bluetooth. Na iPhonu otevřete Účtenku v aplikaci Bluefy, na Androidu v Chrome.'
    : status.connected
      ? `Připojeno: ${status.deviceName}`
      : savedPrinter
        ? `${status.deviceName} – odpojeno, připojí se při tisku`
        : 'Žádná tiskárna není připojená';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.085 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-start mb-4">
        <div className="w-12 h-12 shrink-0 bg-sky-100 dark:bg-sky-900/20 rounded-lg flex items-center justify-center mr-4">
          <Printer className="h-6 w-6 text-sky-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Tiskárna dokladů
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Bluetooth termotiskárna (ESC/POS). Nastavení platí jen pro toto zařízení a ukládá se hned.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex items-center min-w-0">
            <Bluetooth
              className={`h-5 w-5 mr-3 shrink-0 ${status.connected ? 'text-sky-600' : 'text-gray-400'}`}
            />
            <div className="text-sm text-gray-900 dark:text-white min-w-0 break-words">{statusText}</div>
          </div>
          {status.supported && (
            <button
              type="button"
              onClick={handlePair}
              disabled={busy !== null}
              className="shrink-0 bg-brand-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === 'pair' ? 'Hledám…' : savedPrinter ? 'Změnit' : 'Připojit'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
              Automatický tisk dokladů
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {autoPrint
                ? 'Po kliknutí na „Zaplatit“ se doklad vytiskne na pozadí.'
                : 'Doklady se netisknou automaticky.'}
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => handleAutoPrint(e.target.checked)}
              aria-label="Zapnout automatický tisk dokladů"
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-brand-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
          </label>
        </div>

        {bluefyReturn !== null && (
          <div className="flex items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">Návrat ze SumUp</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {bluefyReturn === 'same-window'
                  ? '✓ Nastaveno správně – po platbě kartou se vrátíte do stejného okna Bluefy.'
                  : bluefyReturn === 'new-tab'
                    ? 'Vrací do Bluefy v nové záložce – doporučujeme nastavit „Stejné okno“.'
                    : 'Nenastaveno – po platbě kartou vás iPhone vrátí do Safari.'}
              </div>
            </div>
            <a
              href="/sumup-navrat"
              className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              {bluefyReturn === 'same-window' ? 'Změnit' : 'Nastavit'}
            </a>
          </div>
        )}

        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="text-sm font-medium text-gray-900 dark:text-white">Šířka papíru</div>
          <div className="flex gap-2">
            {([58, 80] as PaperWidth[]).map((width) => (
              <button
                key={width}
                type="button"
                onClick={() => handlePaperWidth(width)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                  paperWidth === width
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                }`}
              >
                {width} mm
              </button>
            ))}
          </div>
        </div>

        {status.supported && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {busy === 'test' ? 'Tisknu…' : 'Zkušební tisk'}
            </button>
            {savedPrinter && (
              <button
                type="button"
                onClick={() => {
                  forgetPrinter();
                  setMessage(null);
                }}
                disabled={busy !== null}
                className="px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                Odebrat tiskárnu
              </button>
            )}
          </div>
        )}

        {message && (
          <div
            className={`text-sm ${message.kind === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {message.text}
          </div>
        )}
      </div>
    </motion.div>
  );
};
