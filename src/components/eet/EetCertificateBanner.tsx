'use client';

import React from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { certificateNotice } from '@/lib/eetUi';
import type { Store } from '@/types';

const TONES = {
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100',
  warning: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-100',
  danger: 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100',
} as const;

/** „Certifikát EET vyprší za N dní“ (jen při zapnutém EET, ≤ 21 dní nebo po selhání obnovy). */
export const EetCertificateBanner: React.FC<{ store: Pick<Store, 'eet'> | null | undefined; now: Date; className?: string }> = ({ store, now, className = '' }) => {
  const notice = certificateNotice(store, now);
  if (!notice) return null;
  return (
    <div role="status" className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm ${TONES[notice.tone]} ${className}`}>
      {notice.tone === 'info' ? <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 min-w-0">{notice.text}</span>
    </div>
  );
};
