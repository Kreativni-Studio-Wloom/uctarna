'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Settings, Euro, Save, Check, CreditCard, QrCode } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';

interface SettingsViewProps {
  storeId: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ storeId }) => {
  const { user } = useAuth();
  const [eurRate, setEurRate] = useState(25.0);
  const [redirectToSumUp, setRedirectToSumUp] = useState(true);
  const [iban, setIban] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');
  const [ico, setIco] = useState<string>('');
  const [companyAddress, setCompanyAddress] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Načtení kurzu pro konkrétní prodejnu
  useEffect(() => {
    if (!user || !storeId) return;
    const storeRef = doc(db, 'users', user.uid, 'stores', storeId);
    const unsubscribe = onSnapshot(storeRef, (snap) => {
      const data: any = snap.data() || {};
      if (typeof data.eurRate === 'number') {
        setEurRate(data.eurRate);
      }
      if (typeof data.redirectToSumUp === 'boolean') {
        setRedirectToSumUp(data.redirectToSumUp);
      }
      if (typeof data.iban === 'string') {
        setIban(data.iban);
      }
      setCompanyName(typeof data.companyName === 'string' ? data.companyName : '');
      setIco(typeof data.ico === 'string' ? data.ico : '');
      setCompanyAddress(typeof data.companyAddress === 'string' ? data.companyAddress : '');
    });
    return unsubscribe;
  }, [user, storeId]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
        eurRate,
        redirectToSumUp,
        iban: iban.trim(),
        companyName: companyName.trim(),
        ico: ico.trim(),
        companyAddress: companyAddress.trim(),
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-4">
                <CreditCard className="h-6 w-6 text-purple-600" />
              </div>
              <div>
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
                  <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-purple-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
              </div>

              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="text-sm text-purple-700 dark:text-purple-300 mb-2">
                  Jak to funguje:
                </div>
                <div className="text-xs text-purple-600 dark:text-purple-400 space-y-1">
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

          {/* QR Payment Setting */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-4">
                <QrCode className="h-6 w-6 text-blue-600" />
              </div>
              <div>
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
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
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
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-4">
              <Settings className="h-6 w-6 text-purple-600" />
            </div>
            <div>
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
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
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
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
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
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200 resize-y"
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
