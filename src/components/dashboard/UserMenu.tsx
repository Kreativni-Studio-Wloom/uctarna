'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut, User as UserIcon, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface UserMenuProps {
  onClose: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onClose }) => {
  const { user, signOutUser } = useAuth();
  const router = useRouter();
  let recentAccounts: Array<{ email: string; displayName: string | null }> = [];
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('uctarna_recent_accounts') : null;
    if (raw) recentAccounts = JSON.parse(raw);
  } catch {}

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
        className="absolute right-0 top-12 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50"
      >
        {/* User Info */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center mr-3">
              <UserIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {displayName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {user?.email}
              </p>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="py-1">
          {recentAccounts.length > 1 && (
            <div className="px-4 py-2">
              <div className="flex items-center text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                <Users className="h-3 w-3 mr-2" />
                Nedávné účty
              </div>
              <div className="space-y-1">
                {recentAccounts
                  .filter(a => a.email !== user?.email)
                  .map((acc) => (
                  <button
                    key={acc.email}
                    onClick={async () => {
                      await signOutUser();
                      onClose();
                      const url = new URL(window.location.origin);
                      url.searchParams.set('email', acc.email);
                      router.push(url.pathname + url.search);
                    }}
                    className="w-full px-3 py-2 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
            className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center transition-colors"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Odhlásit se
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
