'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Settings, Euro, Save, Check, CreditCard, QrCode, Mail, Lock } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  ActionCodeSettings,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  updateEmail,
} from 'firebase/auth';

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
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    setNewEmail(user?.email || '');
  }, [user?.email]);

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

  const getEmailErrorMessage = (code?: string) => {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Tento e-mail už je používán jiným účtem.';
      case 'auth/invalid-email':
        return 'Zadaný e-mail není ve správném formátu.';
      case 'auth/too-many-requests':
        return 'Příliš mnoho pokusů. Zkuste to prosím za chvíli.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Zadané heslo není správně.';
      default:
        return 'Nepodařilo se změnit e-mail. Zkuste to prosím znovu.';
    }
  };

  const actionCodeSettings: ActionCodeSettings = {
    url: 'https://uctarna.fun/login?verified=true',
    handleCodeInApp: true,
  };

  const updateUserEmail = async (emailToUpdate: string) => {
    const normalizedEmail = emailToUpdate.trim().toLowerCase();
    if (!normalizedEmail) {
      setEmailError('Zadejte prosím nový e-mail.');
      setEmailSuccess(null);
      return;
    }
    if (!auth.currentUser) {
      setEmailError('Uživatel není přihlášen.');
      setEmailSuccess(null);
      return;
    }

    setEmailSaving(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      await updateEmail(auth.currentUser, normalizedEmail);
      await sendEmailVerification(auth.currentUser, actionCodeSettings);
      setEmailSuccess('Email changed! Please check your inbox for verification.');
      setPendingEmail(null);
      setShowReauthModal(false);
      setReauthPassword('');
    } catch (error: any) {
      if (error?.code === 'auth/requires-recent-login') {
        setPendingEmail(normalizedEmail);
        setShowReauthModal(true);
      } else {
        setEmailError(getEmailErrorMessage(error?.code));
      }
    } finally {
      setEmailSaving(false);
    }
  };

  const handleReauthenticateAndRetry = async () => {
    if (!auth.currentUser || !auth.currentUser.email || !pendingEmail) return;
    if (!reauthPassword) {
      setEmailError('Pro potvrzení zadejte aktuální heslo.');
      return;
    }
    setReauthLoading(true);
    setEmailError(null);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, reauthPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setShowReauthModal(false);
      await updateUserEmail(pendingEmail);
    } catch (error: any) {
      setEmailError(getEmailErrorMessage(error?.code));
    } finally {
      setReauthLoading(false);
    }
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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

        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center mb-3">
            <Mail className="h-5 w-5 text-purple-600 mr-2" />
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Změna e-mailu</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            Po změně odešleme ověřovací e-mail. Změnu potvrďte kliknutím na odkaz v doručené poště.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="novy@email.cz"
              className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
            />
            <button
              onClick={() => updateUserEmail(newEmail)}
              disabled={emailSaving || !newEmail.trim()}
              className="bg-purple-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 inline-flex items-center justify-center min-w-[120px]"
            >
              {emailSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Ukládání...
                </>
              ) : (
                'Uložit'
              )}
            </button>
          </div>
          {emailSuccess && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">{emailSuccess}</p>
          )}
          {emailError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{emailError}</p>
          )}
        </div>
      </motion.div>

      {showReauthModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center mb-3">
              <Lock className="h-5 w-5 text-red-600 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Potvrzení identity</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Kvůli bezpečnosti zadejte aktuální heslo a změnu e-mailu zopakujeme.
            </p>
            <input
              type="password"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              placeholder="Aktuální heslo"
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200"
            />
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowReauthModal(false);
                  setReauthPassword('');
                  setPendingEmail(null);
                }}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                disabled={reauthLoading}
              >
                Zrušit
              </button>
              <button
                onClick={handleReauthenticateAndRetry}
                disabled={reauthLoading || !reauthPassword}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
              >
                {reauthLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Ověřuji...
                  </>
                ) : (
                  'Potvrdit'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
