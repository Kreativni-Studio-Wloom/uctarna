'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
  ActionCodeSettings,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { X, Save, Lock, User as UserIcon, Mail } from 'lucide-react';

interface UserSettingsModalProps {
  onClose: () => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ onClose }) => {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const actionCodeSettings: ActionCodeSettings = {
    url: 'https://uctarna.fun/login?verified=true',
    handleCodeInApp: true,
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
      case 'auth/operation-not-allowed':
        return 'Změna e-mailu není aktuálně povolená pro tento účet.';
      case 'auth/invalid-continue-uri':
      case 'auth/unauthorized-continue-uri':
        return 'Redirect URL pro ověřovací e-mail není správně nastavená ve Firebase.';
      case 'auth/network-request-failed':
        return 'Síť je dočasně nedostupná. Zkuste to prosím za chvíli znovu.';
      default:
        return 'Nepodařilo se změnit e-mail. Zkuste to prosím znovu.';
    }
  };

  const isRecentLoginError = (error: any) => {
    const code = error?.code || '';
    const message = String(error?.message || '');
    return (
      code === 'auth/requires-recent-login' ||
      message.includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN')
    );
  };

  const isTemporaryOobError = (error: any) => {
    const code = error?.code || '';
    const message = String(error?.message || '').toLowerCase();
    return (
      code === 'auth/network-request-failed' ||
      message.includes('503') ||
      message.includes('service unavailable') ||
      message.includes('sendoobcode')
    );
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const saveDisplayName = async () => {
    if (!user || !auth.currentUser) return;
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setNameError('Jméno nesmí být prázdné.');
      setNameMessage(null);
      return;
    }

    setSavingName(true);
    setNameError(null);
    setNameMessage(null);
    try {
      await updateProfile(auth.currentUser, { displayName: trimmedName });
      await setDoc(
        doc(db, 'users', user.uid),
        {
          displayName: trimmedName,
        },
        { merge: true }
      );
      setNameMessage('Jméno bylo úspěšně změněno.');
    } catch (error: any) {
      console.error('Chyba při změně jména:', error);
      setNameError('Nepodařilo se změnit jméno. Zkuste to prosím znovu.');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    if (!user || !auth.currentUser || !auth.currentUser.email) return;
    setPasswordError(null);
    setPasswordMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Vyplňte všechna pole pro změnu hesla.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Nové heslo musí mít alespoň 6 znaků.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Nové heslo a potvrzení hesla se neshodují.');
      return;
    }

    setSavingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      setPasswordMessage('Heslo bylo úspěšně změněno.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Chyba při změně hesla:', error);
      if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
        setPasswordError('Aktuální heslo není správně.');
      } else {
        setPasswordError('Nepodařilo se změnit heslo. Zkuste to prosím znovu.');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const updateUserEmail = async (emailToUpdate: string) => {
    const normalizedEmail = emailToUpdate.trim().toLowerCase();
    if (!normalizedEmail) {
      setEmailError('Zadejte prosím nový e-mail.');
      setEmailMessage(null);
      return;
    }
    if (!auth.currentUser) {
      setEmailError('Uživatel není přihlášen.');
      setEmailMessage(null);
      return;
    }
    if ((auth.currentUser.email || '').toLowerCase() === normalizedEmail) {
      setEmailError('Zadaný e-mail je stejný jako současný.');
      setEmailMessage(null);
      return;
    }

    setEmailSaving(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      // Obnov token před změnou e-mailu - snižuje počet 400 chyb.
      await auth.currentUser.getIdToken(true);
      // Primární a doporučený flow: nejdřív poslat ověřovací odkaz na nový e-mail,
      // samotná změna proběhne až po kliknutí uživatele na odkaz.
      const sendVerificationLink = async () => {
        try {
          await verifyBeforeUpdateEmail(auth.currentUser!, normalizedEmail, actionCodeSettings);
        } catch (verifyError: any) {
          // Pokud není redirect URL ve Firebase povolená, zkus fallback bez ActionCodeSettings.
          if (
            verifyError?.code === 'auth/invalid-continue-uri' ||
            verifyError?.code === 'auth/unauthorized-continue-uri'
          ) {
            await verifyBeforeUpdateEmail(auth.currentUser!, normalizedEmail);
          } else {
            throw verifyError;
          }
        }
      };

      let lastError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await sendVerificationLink();
          lastError = null;
          break;
        } catch (attemptError: any) {
          lastError = attemptError;
          if (!isTemporaryOobError(attemptError) || attempt === 3) {
            throw attemptError;
          }
          await sleep(attempt * 700);
        }
      }
      if (lastError) {
        throw lastError;
      }

      setEmailMessage('Ověřovací e-mail jsme odeslali. Zkontrolujte prosím doručenou poštu i spam.');
      setPendingEmail(null);
      setShowReauthModal(false);
      setReauthPassword('');
    } catch (error: any) {
      if (isRecentLoginError(error)) {
        setPendingEmail(normalizedEmail);
        setShowReauthModal(true);
      } else if (isTemporaryOobError(error)) {
        setEmailError('Firebase je dočasně nedostupný (503). Zkuste to prosím za chvíli znovu.');
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={() => {
        if (!showReauthModal) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nastavení uživatele</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
              <UserIcon className="w-4 h-4 mr-2 text-purple-600 dark:text-purple-400" />
              Změna jména
            </div>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Vaše jméno"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {nameError && <p className="text-sm text-red-600 dark:text-red-400">{nameError}</p>}
            {nameMessage && <p className="text-sm text-green-600 dark:text-green-400">{nameMessage}</p>}
            <button
              onClick={saveDisplayName}
              disabled={savingName}
              className="w-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 py-2 px-3 rounded-lg font-medium hover:bg-purple-100 dark:hover:bg-purple-900/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              {savingName ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600 dark:border-purple-400"></div>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Uložit jméno
                </>
              )}
            </button>
          </div>

          <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
              <Mail className="w-4 h-4 mr-2 text-purple-600 dark:text-purple-400" />
              Změna e-mailu
            </div>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="novy@email.cz"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {emailError && <p className="text-sm text-red-600 dark:text-red-400">{emailError}</p>}
            {emailMessage && <p className="text-sm text-green-600 dark:text-green-400">{emailMessage}</p>}
            <button
              onClick={() => updateUserEmail(newEmail)}
              disabled={emailSaving || !newEmail.trim()}
              className="w-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 py-2 px-3 rounded-lg font-medium hover:bg-purple-100 dark:hover:bg-purple-900/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              {emailSaving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600 dark:border-purple-400"></div>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Uložit e-mail
                </>
              )}
            </button>
          </div>

          <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300">
              <Lock className="w-4 h-4 mr-2 text-red-600 dark:text-red-400" />
              Změna hesla
            </div>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Aktuální heslo"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nové heslo"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Potvrzení nového hesla"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {passwordError && <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
            {passwordMessage && <p className="text-sm text-green-600 dark:text-green-400">{passwordMessage}</p>}
            <button
              onClick={savePassword}
              disabled={savingPassword}
              className="w-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 py-2 px-3 rounded-lg font-medium hover:bg-red-100 dark:hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              {savingPassword ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 dark:border-red-400"></div>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Změnit heslo
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {showReauthModal && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setShowReauthModal(false);
            setReauthPassword('');
            setPendingEmail(null);
          }}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-5"
            onClick={(e) => e.stopPropagation()}
          >
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
    </motion.div>
  );
};
