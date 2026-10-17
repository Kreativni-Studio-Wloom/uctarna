'use client';

import React from 'react';
import { eetBadge, type EetBadgeTone, type EetSaleLike } from '@/lib/eetUi';

const TONES: Record<EetBadgeTone, string> = {
  success: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  danger: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  pending: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  neutral: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  test: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
};

/** Štítek stavu EET (✓ POK / ⏳ ve frontě / ✗ chyba / TEST / neeviduje se). */
export const EetBadge: React.FC<{ sale: EetSaleLike; className?: string }> = ({ sale, className = '' }) => {
  const b = eetBadge(sale);
  if (!b) return null;
  return (
    <span title={b.title} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${TONES[b.tone]} ${className}`}>
      {b.label}
    </span>
  );
};
