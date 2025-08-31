'use client';

import React from 'react';
import { Store } from '@/types';
import { motion } from 'framer-motion';
import { Store as StoreIcon, Calendar, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface StoreCardProps {
  store: Store;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store }) => {
  const router = useRouter();

  const handleOpenStore = () => {
    router.push(`/store/${store.id}`);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  };

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden cursor-pointer transition-all duration-200"
      onClick={handleOpenStore}
    >
      <div className="p-6">
        <div className="flex items-center mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center mr-4">
            <StoreIcon className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {store.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Vytvořeno {formatDate(store.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            <Calendar className="h-4 w-4 mr-2" />
            Aktualizováno {formatDate(store.updatedAt)}
          </div>
          <motion.div
            whileHover={{ x: 2 }}
            className="text-purple-600 dark:text-purple-400"
          >
            <ArrowRight className="h-5 w-5" />
          </motion.div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-gray-700 dark:to-gray-600 px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Klikněte pro otevření
          </span>
          <motion.div
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <ArrowRight className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};
