'use client';

import React from 'react';
import { FlaskConical } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { TEST_MODE_BANNER_TEXT } from '@/lib/testSales';

/** Pruh přes celý POS, dokud je zapnutý testovací režim prodejny. */
export const TestModeBanner: React.FC = () => {
  const storeDoc = useStore();
  if (storeDoc?.testMode !== true) return null;

  return (
    <div
      role="status"
      className="bg-orange-500 text-white text-sm font-semibold"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-center gap-2 text-center">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{TEST_MODE_BANNER_TEXT}</span>
      </div>
    </div>
  );
};
