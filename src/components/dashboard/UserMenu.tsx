'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut, User as UserIcon, Users, Settings } from 'lucide-react';

interface UserMenuProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onClose, onOpenSettings }) => {
  const { user, signOutUser, switchableAccounts, switchAccount } = useAuth();

  const handleSignOut = async () => {
    await signOutUser();
    onClose();
  };

  // Bezpečné zobrazení displayName
  const displayName = user?.displayName || 'Uživatel';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.1 }}
        className="absolute right-0 top-12 w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-3 z-50"
      >
        {/* User Info */}
        <div className="px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/70 dark:bg-gray-900/20">
          <div className="flex items-center justify-center text-center">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center mr-3">
              <UserIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {displayName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {user?.email}
              </p>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="pt-3 space-y-2">
          <button
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
            className="w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded-xl flex items-center justify-center transition-colors"
          >
            <Settings className="h-4 w-4 mr-3" />
            Nastavení uživatele
          </button>
          {switchableAccounts.filter(a => a.email !== user?.email).length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-center text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                <Users className="h-3 w-3 mr-2" />
                Přepnout účet
              </div>
              <div className="space-y-1">
                {switchableAccounts
                  .filter(a => a.email !== user?.email)
                  .map((acc) => (
                  <button
                    key={acc.email}
                    onClick={async () => {
                      await switchAccount(acc.email);
                      onClose();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-600"
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{acc.displayName || acc.email}</div>
                    {acc.displayName && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{acc.email}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full mt-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl flex items-center justify-center transition-colors"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Přepnout na jiný účet
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
