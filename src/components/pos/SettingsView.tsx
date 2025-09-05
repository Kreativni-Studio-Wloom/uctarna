'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Settings, Euro, Save, Check } from 'lucide-react';

interface SettingsViewProps {
  storeId: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ storeId }) => {
  const { user, updateUserSettings } = useAuth();
  const extendedUser = user as any; // Cast na ExtendedUser
  const [eurRate, setEurRate] = useState(user?.settings?.eurRate || 25.0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      await updateUserSettings({ eurRate });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const formatEurRate = (rate: number) => {
    return `${rate.toFixed(2)} Kč/EUR`;
  };

  // Bezpečné zobrazení displayName
  const displayName = user?.displayName || 'Uživatel';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Nastavení
        </h2>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSave}
          disabled={saving}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Ukládání...
            </>
          ) : saved ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              Uloženo!
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Uložit
            </>
          )}
        </motion.button>
      </div>

      {/* Settings Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EUR Rate Setting */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-4">
              <Euro className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Kurz EUR
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Nastavte aktuální kurz pro převod Kč na EUR
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="eurRate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Kurz (Kč/EUR)
              </label>
              <input
                id="eurRate"
                type="number"
                step="0.01"
                min="0"
                value={eurRate}
                onChange={(e) => setEurRate(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="25.00"
              />
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Aktuální nastavení:
              </div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatEurRate(eurRate)}
              </div>
            </div>

            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Příklad převodu:
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                100 Kč = {(100 / eurRate).toFixed(2)} EUR
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                500 Kč = {(500 / eurRate).toFixed(2)} EUR
              </div>
            </div>
          </div>
        </motion.div>

        {/* Store Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-4">
              <Settings className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Informace o prodejně
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Základní informace a statistiky
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                ID prodejny:
              </div>
              <div className="font-mono text-sm text-gray-900 dark:text-white">
                {storeId}
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Uživatel:
              </div>
              <div className="text-sm text-gray-900 dark:text-white">
                {user?.email}
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Vytvořeno:
              </div>
              <div className="text-sm text-gray-900 dark:text-white">
                {(() => {
                  const currentStore = extendedUser?.stores?.find((store: any) => store.id === storeId);
                  if (!currentStore?.createdAt) return 'N/A';
                  
                  const createdAt = currentStore.createdAt;
                  if (createdAt instanceof Date) {
                    return createdAt.toLocaleDateString('cs-CZ');
                  } else if ((createdAt as any)?.toDate) {
                    return (createdAt as any).toDate().toLocaleDateString('cs-CZ');
                  }
                  return 'N/A';
                })()}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Additional Settings */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Další nastavení
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Téma:
            </div>
            <div className="text-sm text-gray-900 dark:text-white">
              {user?.settings?.theme === 'auto' ? 'Automatické' : 
               user?.settings?.theme === 'dark' ? 'Tmavé' : 'Světlé'}
            </div>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Status:
            </div>
            <div className="text-sm text-green-600 dark:text-green-400">
              Aktivní
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
