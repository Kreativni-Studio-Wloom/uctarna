'use client';

import React from 'react';
import { format } from 'date-fns';
import { FlaskConical } from 'lucide-react';
import { Sale } from '@/types';
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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-orange-200 dark:border-orange-800 p-4 space-y-3">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={includeTest}
          onChange={(e) => onIncludeTestChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
        />
        <FlaskConical className="h-4 w-4 text-orange-600" aria-hidden="true" />
        <span className="text-sm font-medium text-gray-900 dark:text-white">Zahrnout i testovací prodeje</span>
      </label>

      {!hasTest && (
        <p className="text-xs text-gray-500 dark:text-gray-400">V tomto období nejsou žádné testovací prodeje.</p>
      )}

      {hasTest && !includeTest && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          V období je {summary.count} {countLabel} za {formatCzk(summary.amount)}. Do tržeb, zisku ani uzávěrky se nepočítají.
        </p>
      )}

      {hasTest && includeTest && (
        <>
          <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
            Uzávěrka je {formatIncludedTestSalesNote(summary)}.
          </p>
          <div className="space-y-1.5">
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
