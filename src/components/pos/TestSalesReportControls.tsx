'use client';

import React from 'react';
import { format } from 'date-fns';
import { FlaskConical } from 'lucide-react';
import { Sale } from '@/types';
import { Switch } from '@/components/eet/Switch';
import {
  TestSalesSummary,
  formatCzk,
  formatIncludedTestSalesNote,
  saleAmountCzk,
} from '@/lib/testSales';

interface TestSalesReportControlsProps {
  includeTest: boolean;
  onIncludeTestChange: (value: boolean) => void;
  summary: TestSalesSummary;
  testSales: Sale[];
}

const paymentLabel = (method: Sale['paymentMethod']) =>
  method === 'cash' ? 'Hotovost' : method === 'card' ? 'Karta' : 'QR kód';

/** Zaškrtávátko „Zahrnout i testovací prodeje“ v uzávěrkách a jejich samostatný výpis. */
export const TestSalesReportControls: React.FC<TestSalesReportControlsProps> = ({
  includeTest,
  onIncludeTestChange,
  summary,
  testSales,
}) => {
  const hasTest = summary.count > 0;
  const countLabel = summary.count === 1 ? 'testovací prodej' : summary.count < 5 ? 'testovací prodeje' : 'testovacích prodejů';

  const statusText = !hasTest
    ? 'V tomto období nejsou žádné testovací prodeje.'
    : includeTest
      ? `Uzávěrka je ${formatIncludedTestSalesNote(summary)}.`
      : `${summary.count} ${countLabel} za ${formatCzk(summary.amount)} se do tržeb, zisku ani uzávěrky ${summary.count >= 2 && summary.count <= 4 ? 'nepočítají' : 'nepočítá'}.`;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
            <FlaskConical className="h-5 w-5 text-orange-600 dark:text-orange-400" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">Zahrnout testovací prodeje</span>
              {hasTest && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
                  {summary.count}
                </span>
              )}
            </div>
            <p
              className={`text-xs sm:text-sm ${includeTest && hasTest ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-gray-600 dark:text-gray-400'}`}
            >
              {statusText}
            </p>
          </div>
        </div>
        <Switch checked={includeTest} onChange={onIncludeTestChange} label="Zahrnout testovací prodeje" tone="orange" />
      </div>

      {hasTest && includeTest && (
        <>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Testovací prodeje
            </div>
            {testSales.map((sale) => (
              <div
                key={sale.id}
                className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300 min-w-0 truncate">
                  {format(sale.createdAt, 'd.M. HH:mm')} · {sale.documentId || `#${sale.id.slice(-8)}`} · {paymentLabel(sale.paymentMethod)}
                </span>
                <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">
                  {formatCzk(saleAmountCzk(sale))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
