'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';
import { motion } from 'framer-motion';
import { Settings, Euro, Save, Check, CreditCard, QrCode, Banknote, Store as StoreIcon, Palette } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { applyColorScheme, COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, isLightColorScheme } from '@/lib/colorScheme';
import { ColorSchemeId } from '@/types';

interface SettingsViewProps {
  storeId: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ storeId }) => {
  const { user } = useAuth();
  const storeDoc = useStore();
  const [storeName, setStoreName] = useState('');
  const [eurRate, setEurRate] = useState(25.0);
  const [redirectToSumUp, setRedirectToSumUp] = useState(true);
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [iban, setIban] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');
  const [ico, setIco] = useState<string>('');
  const [companyAddress, setCompanyAddress] = useState<string>('');
  const [colorScheme, setColorScheme] = useState<ColorSchemeId>(DEFAULT_COLOR_SCHEME);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Synchronizace z jediného store listeneru na úrovni stránky prodejny.
  useEffect(() => {
    if (!storeDoc) return;
    setStoreName(typeof storeDoc.name === 'string' ? storeDoc.name : '');
    if (typeof storeDoc.eurRate === 'number') {
      setEurRate(storeDoc.eurRate);
    }
    if (typeof storeDoc.redirectToSumUp === 'boolean') {
      setRedirectToSumUp(storeDoc.redirectToSumUp);
    }
    if (typeof storeDoc.tipsEnabled === 'boolean') {
      setTipsEnabled(storeDoc.tipsEnabled);
    }
    if (typeof storeDoc.iban === 'string') {
      setIban(storeDoc.iban);
    }
    setCompanyName(typeof storeDoc.companyName === 'string' ? storeDoc.companyName : '');
    setIco(typeof storeDoc.ico === 'string' ? storeDoc.ico : '');
    setCompanyAddress(typeof storeDoc.companyAddress === 'string' ? storeDoc.companyAddress : '');
    if (storeDoc.colorScheme) {
      setColorScheme(storeDoc.colorScheme);
    } else {
      setColorScheme(DEFAULT_COLOR_SCHEME);
    }
  }, [storeDoc]);

  // Okamžitý náhled vybrané barvy před uložením
  useEffect(() => {
    applyColorScheme(colorScheme);
  }, [colorScheme]);

  // Po opuštění nastavení bez uložení vrátit uloženou barvu prodejny
  useEffect(() => {
    return () => {
      applyColorScheme(storeDoc?.colorScheme ?? DEFAULT_COLOR_SCHEME);
    };
  }, [storeDoc?.colorScheme]);

  const handleSave = async () => {
    if (!user) return;

    const trimmedName = storeName.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
        name: trimmedName,
        eurRate,
        redirectToSumUp,
        tipsEnabled,
        iban: iban.trim(),
        companyName: companyName.trim(),
        ico: ico.trim(),
        companyAddress: companyAddress.trim(),
        colorScheme,
        updatedAt: serverTimestamp(),
      });
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
          disabled={saving || !storeName.trim()}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center"
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

      {/* Store Name */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <div className="flex items-start mb-4">
          <div className="w-12 h-12 shrink-0 bg-brand-100 dark:bg-brand-900/20 rounded-lg flex items-center justify-center mr-4">
            <StoreIcon className="h-6 w-6 text-brand-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Název prodejny
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Zobrazuje se na úvodní stránce a v hlavičce prodejny
            </p>
          </div>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <label htmlFor="storeName" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
            Název
          </label>
          <input
            id="storeName"
            type="text"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Např. Hlavní prodejna"
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
          />
        </div>
      </motion.div>

      {/* Color Scheme */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <div className="flex items-start mb-4">
          <div className="w-12 h-12 shrink-0 bg-brand-100 dark:bg-brand-900/20 rounded-lg flex items-center justify-center mr-4">
            <Palette className="h-6 w-6 text-brand-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Barevné schéma
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Změní barvu designových prvků v celé prodejně — tlačítka, ikony, texty a stíny
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
          {COLOR_SCHEMES.map((scheme) => {
            const isSelected = colorScheme === scheme.id;
            const isLight = isLightColorScheme(scheme.id);
            return (
              <button
                key={scheme.id}
                type="button"
                onClick={() => setColorScheme(scheme.id)}
                className={`relative flex flex-col items-center gap-1.5 sm:gap-2 p-2 sm:p-3 rounded-xl border-2 transition-all duration-200 ${
                  isSelected
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-brand-300 dark:hover:border-brand-600'
                }`}
                title={scheme.label}
              >
                <div
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full shadow-brand-lg flex items-center justify-center ${
                    isLight ? 'border-2 border-gray-300 dark:border-gray-500' : ''
                  }`}
                  style={{ backgroundColor: scheme.themeColor }}
                >
                  {isSelected && (
                    <Check className={`h-4 w-4 sm:h-5 sm:w-5 ${isLight ? 'text-gray-700' : 'text-white'}`} />
                  )}
                </div>
                <span className={`text-[10px] sm:text-xs font-medium text-center leading-tight ${
                  isSelected ? 'text-brand-700 dark:text-brand-300' : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {scheme.label}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Settings Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* EUR Rate Setting */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-start mb-4">
            <div className="w-12 h-12 shrink-0 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-4">
              <Euro className="h-6 w-6 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Kurz EUR
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Nastavte aktuální kurz pro převod Kč na EUR
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
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
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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

            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                Příklad převodu:
              </div>
              <div className="text-sm text-blue-600 dark:text-blue-400">
                100 Kč = {(100 / eurRate).toFixed(2)} EUR
              </div>
              <div className="text-sm text-blue-600 dark:text-blue-400">
                500 Kč = {(500 / eurRate).toFixed(2)} EUR
              </div>
            </div>
          </div>
        </motion.div>

        {/* Payments Settings */}
        <div className="space-y-6">
          {/* SumUp Redirect Setting */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-start mb-4">
              <div className="w-12 h-12 shrink-0 bg-brand-100 dark:bg-brand-900/20 rounded-lg flex items-center justify-center mr-4">
                <CreditCard className="h-6 w-6 text-brand-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Platba kartou
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Nastavení přesměrování na SumUp při platbě kartou
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Přesměrovat na SumUp
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {redirectToSumUp ? 
                      'Platba kartou přesměruje na SumUp aplikaci' : 
                      'Platba kartou se pouze zaznamená do dokladu'
                    }
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={redirectToSumUp}
                    onChange={(e) => setRedirectToSumUp(e.target.checked)}
                    aria-label="Přepnout přesměrování na SumUp"
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-brand-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
              </div>

              <div className="p-4 bg-brand-50 dark:bg-brand-900/20 rounded-lg">
                <div className="text-sm text-brand-700 dark:text-brand-300 mb-2">
                  Jak to funguje:
                </div>
                <div className="text-xs text-brand-600 dark:text-brand-400 space-y-1">
                  {redirectToSumUp ? (
                    <>
                      <div>• Kliknutím na "Zaplatit kartou" se otevře SumUp app</div>
                      <div>• Zákazník dokončí platbu v SumUp aplikaci</div>
                      <div>• Po úspěšné platbě se vrátí zpět do systému</div>
                    </>
                  ) : (
                    <>
                      <div>• Kliknutím na "Zaplatit kartou" se pouze zaznamená prodej</div>
                      <div>• Žádné přesměrování na SumUp aplikaci</div>
                      <div>• Ideální pro offline režim nebo testování</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-start mb-4">
              <div className="w-12 h-12 shrink-0 bg-amber-100 dark:bg-amber-900/20 rounded-lg flex items-center justify-center mr-4">
                <Banknote className="h-6 w-6 text-amber-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Spropitné
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Umožní v pokladně zadat spropitné, které se přičte k úhradě a zobrazí u dokladu.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                  Spropitné v dokladu
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {tipsEnabled
                    ? 'V checkoutu se zobrazí pole pro částku spropitného.'
                    : 'Checkout zůstane bez pole pro spropitné.'}
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={tipsEnabled}
                  onChange={(e) => setTipsEnabled(e.target.checked)}
                  aria-label="Zapnout spropitné v pokladně"
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-brand-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>
          </motion.div>

          {/* QR Payment Setting */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-start mb-4">
              <div className="w-12 h-12 shrink-0 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-4">
                <QrCode className="h-6 w-6 text-blue-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Platba QR kódem
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Po zadání IBAN se volba automaticky zobrazí v checkoutu.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label htmlFor="iban" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                IBAN
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Bankovní účet pro platby QR kódem (SPAYD).
              </p>
              <input
                id="iban"
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="CZ6508000000192000145399"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
              />
            </div>
          </motion.div>
        </div>

        {/* Company Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-start mb-4">
            <div className="w-12 h-12 shrink-0 bg-brand-100 dark:bg-brand-900/20 rounded-lg flex items-center justify-center mr-4">
              <Settings className="h-6 w-6 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Fakturační údaje
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Údaje pro tisk dokladů
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label htmlFor="companyName" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                Název firmy / Jméno
              </label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Např. Jan Novák"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
              />
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label htmlFor="ico" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                IČO
              </label>
              <input
                id="ico"
                type="text"
                value={ico}
                onChange={(e) => setIco(e.target.value)}
                placeholder="Např. 12345678"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
              />
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label htmlFor="companyAddress" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                Sídlo / Adresa
              </label>
              <textarea
                id="companyAddress"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="Např. Hlavní 123, 110 00 Praha"
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200 resize-y"
              />
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
