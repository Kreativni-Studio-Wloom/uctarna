'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { LogIn, ShieldAlert } from 'lucide-react';

interface LoginRequiredModalProps {
  redirectPath?: string;
}

export const LoginRequiredModal: React.FC<LoginRequiredModalProps> = ({ redirectPath }) => {
  const router = useRouter();

  const handleLogin = () => {
    const loginUrl = redirectPath
      ? `/?redirect=${encodeURIComponent(redirectPath)}`
      : '/';
    router.replace(loginUrl);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        >
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
            <div className="flex items-center">
              <ShieldAlert className="h-6 w-6 text-white mr-3" />
              <h2 className="text-xl font-semibold text-white">Přístup vyžaduje přihlášení</h2>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Nejste přihlášeni. Pro přístup k provozovně se musíte přihlásit ke svému účtu.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Cizí provozovnu nelze zobrazit bez ověření identity.
            </p>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleLogin}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 shadow-lg flex items-center justify-center"
            >
              <LogIn className="h-5 w-5 mr-2" />
              Přejít na přihlášení
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};
