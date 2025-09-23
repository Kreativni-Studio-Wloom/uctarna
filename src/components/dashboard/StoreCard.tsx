'use client';

import React, { useState } from 'react';
import { Store } from '@/types';
import { motion } from 'framer-motion';
import { Store as StoreIcon, UtensilsCrossed, ArrowRight, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface StoreCardProps {
  store: Store;
  onDuplicate?: (store: Store) => void;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store, onDuplicate }) => {
  const router = useRouter();
  const [showDuplicateButton, setShowDuplicateButton] = useState(false);

  const handleOpenStore = () => {
    router.push(`/store/${store.id}`);
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDuplicate) {
      onDuplicate(store);
    }
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
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden cursor-pointer transition-all duration-200 relative"
      onClick={handleOpenStore}
      onMouseEnter={() => setShowDuplicateButton(true)}
      onMouseLeave={() => setShowDuplicateButton(false)}
    >
      {/* Duplicate Button */}
      {onDuplicate && showDuplicateButton && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={handleDuplicate}
          className="absolute top-3 right-3 z-10 p-2 bg-white dark:bg-gray-700 rounded-lg shadow-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          title="Duplikovat prodejnu"
        >
          <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </motion.button>
      )}

      <div className="p-6">
        <div className="flex items-center mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center mr-4">
            {store.type === 'bistro' ? (
              <UtensilsCrossed className="h-6 w-6 text-white" />
            ) : (
              <StoreIcon className="h-6 w-6 text-white" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {store.name}
            </h3>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{store.type === 'bistro' ? 'Bistro' : 'Prodejna'}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Vytvořeno {formatDate(store.createdAt)}
            </p>
          </div>
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
