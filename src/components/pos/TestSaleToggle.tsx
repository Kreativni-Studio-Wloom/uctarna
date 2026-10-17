'use client';

import React from 'react';
import { FlaskConical, Lock } from 'lucide-react';

interface TestSaleToggleProps {
  checked: boolean;
  /** Režim školení: přepínač je zamčený v poloze zapnuto. */
  locked: boolean;
  onChange: (value: boolean) => void;
}

/** Přepínač „Testovací prodej“ v checkoutu. */
export const TestSaleToggle: React.FC<TestSaleToggleProps> = ({ checked, locked, onChange }) => {
  const isOn = locked || checked;
  return (
    <div
      className={`mb-6 flex items-center justify-between gap-4 p-4 rounded-lg border ${
        isOn
          ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700'
          : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <FlaskConical className={`h-5 w-5 mt-0.5 shrink-0 ${isOn ? 'text-orange-600' : 'text-gray-400'}`} aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-white">Testovací prodej</div>
          <div className="text-xs text-gray-600 dark:text-gray-400">
            {locked
              ? 'Zapnutý testovací režim prodejny: doklad bude testovací.'
              : isOn
                ? 'Doklad se nezapočítá do tržeb a neodešle do EET.'
                : 'Reálný prodej.'}
          </div>
        </div>
      </div>
      <label className={`relative inline-flex items-center shrink-0 ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        {locked && <Lock className="h-3.5 w-3.5 mr-2 text-orange-600" aria-hidden="true" />}
        <input
          type="checkbox"
          checked={isOn}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="Testovací prodej"
          className="sr-only peer"
        />
        <div className="relative w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-orange-500 peer-disabled:opacity-80 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-500 peer-focus:ring-offset-2 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
      </label>
    </div>
  );
};
