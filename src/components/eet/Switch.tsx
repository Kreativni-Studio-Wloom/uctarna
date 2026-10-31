'use client';

import React from 'react';

/** Přepínač ve stylu nastavení aplikace (stejný vzhled jako vypínače v Nastavení). */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Barva zapnutého stavu: brand (výchozí) nebo oranžová (testovací prodeje). */
  tone?: 'brand' | 'orange';
}> = ({ checked, onChange, label, disabled, tone = 'brand' }) => {
  const on = tone === 'orange' ? 'peer-checked:bg-orange-500 peer-focus:ring-orange-500' : 'peer-checked:bg-brand-600 peer-focus:ring-brand-500';
  return (
    <label className={`relative inline-flex items-center shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="sr-only peer"
      />
      <div
        className={`w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer ${on} peer-disabled:opacity-50 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-800 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full`}
      />
    </label>
  );
};
