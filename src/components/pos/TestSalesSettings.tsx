'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FlaskConical } from 'lucide-react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';

interface TestSalesSettingsProps {
  storeId: string;
}

type Flag = 'testMode' | 'testSalesEnabled';

// Vypínače se ukládají hned a samostatně, aby „Uložit nastavení“ nepřidávalo
// tato pole prodejnám, které testovací prodeje nepoužívají.
export const TestSalesSettings: React.FC<TestSalesSettingsProps> = ({ storeId }) => {
  const { user } = useAuth();
  const storeDoc = useStore();
  const [savingFlag, setSavingFlag] = useState<Flag | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testMode = storeDoc?.testMode === true;
  const testSalesEnabled = storeDoc?.testSalesEnabled === true;

  const setFlag = async (flag: Flag, value: boolean) => {
    if (!user) return;
    setSavingFlag(flag);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
        [flag]: value,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Nepodařilo se uložit nastavení testovacích prodejů', e);
      setError('Nastavení se nepodařilo uložit. Zkuste to znovu.');
    } finally {
      setSavingFlag(null);
    }
  };

  const rows: Array<{ flag: Flag; checked: boolean; title: string; on: string; off: string; aria: string }> = [
    {
      flag: 'testMode',
      checked: testMode,
      title: 'Testovací režim',
      on: 'Každý prodej je testovací. Přes celý POS svítí oranžový pruh.',
      off: 'Prodeje jsou reálné. Vhodné zapnout pro zaučování nebo zkoušku nového menu.',
      aria: 'Zapnout testovací režim prodejny',
    },
    {
      flag: 'testSalesEnabled',
      checked: testSalesEnabled,
      title: 'Povolit testovací prodeje',
      on: 'V checkoutu je přepínač „Testovací prodej“ (výchozí vypnuto).',
      off: 'Checkout zůstane bez přepínače.',
      aria: 'Povolit testovací prodeje v checkoutu',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-start mb-4">
        <div className="w-12 h-12 shrink-0 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center mr-4">
          <FlaskConical className="h-6 w-6 text-orange-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Testovací prodeje</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Testovací doklady se nepočítají do tržeb, zisku ani uzávěrek a neodesílají se do EET.
            Změna se uloží hned.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.flag} className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">{row.title}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">{row.checked ? row.on : row.off}</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={row.checked}
                disabled={savingFlag !== null}
                onChange={(e) => void setFlag(row.flag, e.target.checked)}
                aria-label={row.aria}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-orange-500 peer-disabled:opacity-60 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </motion.div>
  );
};
