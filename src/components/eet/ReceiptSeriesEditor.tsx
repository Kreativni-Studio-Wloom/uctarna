'use client';

import React, { useMemo, useState } from 'react';
import { Hash, Pencil } from 'lucide-react';
import {
  RECEIPT_PREFIX_SEPARATORS,
  composeReceiptPrefix,
  maxReceiptLabelLength,
  parseReceiptPrefix,
  previewReceiptNumbers,
  sanitizeReceiptLabel,
  type ReceiptPrefixParts,
  type ReceiptPrefixSeparator,
} from '@/lib/eetUi';
import { Switch } from './Switch';

interface ReceiptSeriesEditorProps {
  prefix: string;
  resetYearly: boolean;
  onChange: (next: { prefix: string; resetYearly: boolean }) => void;
  error?: string;
}

const separatorLabel = (s: ReceiptPrefixSeparator) => (s === '' ? 'Žádný' : s);

const chipCls = (active: boolean) =>
  `px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
    active
      ? 'bg-brand-600 border-brand-600 text-white'
      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
  }`;

/**
 * Číslování dokladů: vlastní označení + rok + oddělovač se živou ukázkou čísla.
 * Ukládá se dál jako `receiptSeries.prefix` (s {YYYY}); neznámý tvar jde upravit ručně.
 */
export const ReceiptSeriesEditor: React.FC<ReceiptSeriesEditorProps> = ({ prefix, resetYearly, onChange, error }) => {
  const parsed = useMemo(() => parseReceiptPrefix(prefix), [prefix]);
  const [manual, setManual] = useState(parsed === null);
  const parts: ReceiptPrefixParts = parsed ?? { label: '', year: true, separator: '-' };
  const preview = previewReceiptNumbers(prefix, resetYearly);
  // Při ročním resetu musí být rok v čísle (jinak by se čísla opakovala); server ho tehdy doplní sám.
  const yearForced = resetYearly;

  const update = (patch: Partial<ReceiptPrefixParts>) => {
    const next = { ...parts, ...patch };
    if (yearForced) next.year = true;
    next.label = next.label.slice(0, maxReceiptLabelLength(next));
    onChange({ prefix: composeReceiptPrefix(next), resetYearly });
  };

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 shrink-0 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex items-center justify-center">
            <Hash className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white">Číslování dokladů</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Tak bude vypadat číslo na účtence a v EET.</div>
          </div>
        </div>
        <div className="sm:text-right shrink-0 pl-12 sm:pl-0" aria-live="polite">
          {preview ? (
            <>
              <div className="font-mono text-lg font-semibold text-gray-900 dark:text-white">{preview[0]}</div>
              <div className="font-mono text-xs text-gray-500 dark:text-gray-400">další {preview[1]}</div>
            </>
          ) : (
            <div className="text-sm text-red-600 dark:text-red-400">Neplatné číslo</div>
          )}
        </div>
      </div>

      {manual ? (
        <div>
          <label htmlFor="eet-prefix-raw" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Vlastní tvar prefixu
          </label>
          <input
            id="eet-prefix-raw"
            value={prefix}
            onChange={(e) => onChange({ prefix: e.target.value, resetYearly })}
            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Místo roku napište <span className="font-mono">{'{YYYY}'}</span>. Za prefix se přidá šestimístné pořadové číslo.
          </p>
          {parsed !== null && (
            <button type="button" onClick={() => setManual(false)} className="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
              Zpět na jednoduché nastavení
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="eet-prefix-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Vlastní označení <span className="font-normal text-gray-500 dark:text-gray-400">(nepovinné)</span>
            </label>
            <input
              id="eet-prefix-label"
              value={parts.label}
              onChange={(e) => update({ label: sanitizeReceiptLabel(e.target.value) })}
              placeholder="např. PRAHA nebo P1"
              maxLength={maxReceiptLabelLength(parts)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Hodí se, když máte víc prodejen. Bez diakritiky.</p>
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Oddělovač</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Oddělovač">
              {RECEIPT_PREFIX_SEPARATORS.map((s) => (
                <button
                  key={s || 'none'}
                  type="button"
                  role="radio"
                  aria-checked={parts.separator === s}
                  onClick={() => update({ separator: s })}
                  className={`${chipCls(parts.separator === s)} ${s ? 'font-mono min-w-[2.75rem]' : ''}`}
                >
                  {separatorLabel(s)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">Nová řada každý rok</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">V lednu začne číslování znovu od 1, rok je pak vždy součástí čísla.</div>
          </div>
          <Switch
            checked={resetYearly}
            label="Nová řada každý rok"
            onChange={(v) =>
              onChange({ prefix: manual || !v ? prefix : composeReceiptPrefix({ ...parts, year: true }), resetYearly: v })
            }
          />
        </div>
        {!manual && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">Rok v čísle dokladu</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {yearForced ? 'Při nové řadě každý rok je rok v čísle povinný.' : 'Např. 2026 před pořadovým číslem.'}
              </div>
            </div>
            <Switch checked={parts.year || yearForced} disabled={yearForced} label="Rok v čísle dokladu" onChange={(v) => update({ year: v })} />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>Změna platí pro další doklady, pořadí čísel pokračuje.</span>
        {!manual && (
          <button type="button" onClick={() => setManual(true)} className="inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400 hover:underline">
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Upravit ručně
          </button>
        )}
      </div>
    </div>
  );
};
