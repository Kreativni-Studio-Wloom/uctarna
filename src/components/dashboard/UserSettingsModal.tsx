'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { X, Save, Lock, User as UserIcon } from 'lucide-react';

interface UserSettingsModalProps {
  onClose: () => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ onClose }) => {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
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
    </motion.div>
  );
};
