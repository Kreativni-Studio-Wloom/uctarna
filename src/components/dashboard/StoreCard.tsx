'use client';

import React, { useState } from 'react';
import { Store } from '@/types';
import { motion } from 'framer-motion';
import { Store as StoreIcon, UtensilsCrossed, ArrowRight, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getBrandGradientStyle, getBrandRgb, resolveBrandColor } from '@/lib/colorScheme';
// use pointer events instead of custom touch hook

interface StoreCardProps {
  store: Store;
  onDuplicate?: (store: Store) => void;
}

export const StoreCard: React.FC<StoreCardProps> = ({ store, onDuplicate }) => {
  const router = useRouter();
  const brand = resolveBrandColor(store);
  const [showDuplicateButton, setShowDuplicateButton] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const handleOpenStore = () => {
    if (isOpening) return;
    // Okamžitá vizuální odezva – načtení stránky prodejny chvíli trvá
    setIsOpening(true);
    router.push(`/store/${store.id}`);
  };

  const handlePointerUp = () => handleOpenStore();

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
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden cursor-pointer transition-all duration-200 relative touch-target"
      onPointerUp={handlePointerUp}
      onMouseEnter={() => setShowDuplicateButton(true)}
      onMouseLeave={() => setShowDuplicateButton(false)}
    >
      {/* Overlay s loaderem po kliknutí – okamžitá odezva během načítání prodejny */}
      {isOpening && (
        <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center rounded-xl">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/30 border-t-white"></div>
        </div>
      )}

      {/* Duplicate Button */}
      {onDuplicate && showDuplicateButton && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={handleDuplicate}
          onPointerUp={(e) => e.stopPropagation()}
          className="absolute top-3 right-3 z-10 w-9 h-9 bg-white dark:bg-gray-700 rounded-lg shadow-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center justify-center"
          title="Duplikovat prodejnu"
        >
          <Copy className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </motion.button>
      )}

      <div className="p-6">
        <div className="flex items-center mb-4">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center mr-4"
            style={getBrandGradientStyle(brand.hue, brand.shade)}
          >
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

      <div className="mx-3 mb-3 bg-gradient-to-r from-brand-50 to-brand-100 dark:from-gray-700 dark:to-gray-600 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Klikněte pro otevření
          </span>
          <motion.div
            animate={{ x: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <ArrowRight className="h-4 w-4" style={{ color: `rgb(${getBrandRgb(brand.hue, 600, brand.shade)})` }} />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};
