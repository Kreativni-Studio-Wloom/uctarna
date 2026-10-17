'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FlaskConical, Lock, Receipt, Scale } from 'lucide-react';
import { NON_EVIDENCE_REASONS, type CheckoutEvidence, type EetEvidenceChoice } from '@/lib/eetUi';

interface EetEvidenceRowProps {
  evidence: CheckoutEvidence;
  choice: EetEvidenceChoice;
  onChange: (choice: EetEvidenceChoice) => void;
}

/**
 * Checkout: „Evidovat v EET“ (kap. 6.2). Výchozí zapnuto; odškrtnutí se potvrzuje důvodem
 * (testovací doklad / platba nepodléhá evidenci). V režimu školení zamčeno na testovací doklad.
 */
export const EetEvidenceRow: React.FC<EetEvidenceRowProps> = ({ evidence, choice, onChange }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<'test' | 'exempt'>('test');
  const [reason, setReason] = useState<string>(NON_EVIDENCE_REASONS[0]);
  const [custom, setCustom] = useState('');

  const send = evidence.effective === 'send';
  const subtitle = evidence.locked
    ? 'Zapnutý testovací režim prodejny: doklad bude testovací.'
    : evidence.effective === 'test'
      ? 'Testovací doklad: neeviduje se a nepočítá do tržeb.'
      : evidence.effective === 'exempt'
        ? `Neeviduje se: ${evidence.nonEvidenceReason}`
        : evidence.exemptIgnored && choice.mode === 'exempt'
          ? 'Platba přes SumUp terminál se eviduje vždy.'
          : 'Tržba se po zaplacení odešle do EET.';

  const toggle = (checked: boolean) => {
    if (evidence.locked) return;
    if (checked) onChange({ mode: 'send' });
    else setDialogOpen(true);
  };

  const confirm = () => {
    const finalReason = reason === '__custom' ? custom.trim() : reason;
    onChange(mode === 'test' ? { mode: 'test' } : { mode: 'exempt', reason: finalReason });
    setDialogOpen(false);
  };
  const confirmDisabled = mode === 'exempt' && reason === '__custom' && custom.trim().length < 3;

  return (
    <>
      <div
        className={`mb-6 flex items-center justify-between gap-4 p-4 rounded-lg border ${
          send ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          {send ? (
            <Receipt className="h-5 w-5 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
          ) : evidence.effective === 'test' ? (
            <FlaskConical className="h-5 w-5 mt-0.5 shrink-0 text-orange-600" aria-hidden="true" />
          ) : (
            <Scale className="h-5 w-5 mt-0.5 shrink-0 text-orange-600" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white">Evidovat v EET</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{subtitle}</div>
          </div>
        </div>
        <label className={`relative inline-flex items-center shrink-0 ${evidence.locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          {evidence.locked && <Lock className="h-3.5 w-3.5 mr-2 text-orange-600" aria-hidden="true" />}
          <input
            type="checkbox"
            checked={send}
            disabled={evidence.locked}
            onChange={(e) => toggle(e.target.checked)}
            aria-label="Evidovat v EET"
            className="sr-only peer"
          />
          <div className="relative w-11 h-6 bg-orange-300 dark:bg-orange-700 rounded-full peer peer-checked:bg-green-600 peer-disabled:opacity-80 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500 peer-focus:ring-offset-2 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
        </label>
      </div>

      <AnimatePresence>
        {dialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
            onClick={() => setDialogOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="eet-reason-title"
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="eet-reason-title" className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                Proč doklad neevidovat?
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Kontaktní platby se evidují vždy. Vyberte jednu z výjimek.</p>

              <div className="space-y-2" role="radiogroup">
                {(
                  [
                    ['test', 'Testovací doklad', 'Nejde o reálný prodej. Nepočítá se do tržeb.'],
                    ['exempt', 'Platba nepodléhá evidenci', 'Zákonná výjimka, např. převod na účet bez osobního kontaktu. Tržba se počítá.'],
                  ] as const
                ).map(([value, title, sub]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                      mode === value ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{title}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">{sub}</div>
                  </button>
                ))}
              </div>

              {mode === 'exempt' && (
                <div className="mt-4 space-y-2">
                  <label htmlFor="eet-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Důvod
                  </label>
                  <select
                    id="eet-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                  >
                    {NON_EVIDENCE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="__custom">Jiný důvod…</option>
                  </select>
                  {reason === '__custom' && (
                    <input
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      maxLength={200}
                      placeholder="Napište důvod"
                      aria-label="Vlastní důvod"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                    />
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Evidovat
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={confirmDisabled}
                  className="flex-1 px-4 py-2.5 rounded-lg font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
                >
                  Neevidovat
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
