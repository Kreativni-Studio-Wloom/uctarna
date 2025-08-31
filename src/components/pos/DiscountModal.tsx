'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Percent, DollarSign } from 'lucide-react';

interface DiscountModalProps {
  onClose: () => void;
  onApply: (discount: { type: 'percentage' | 'amount'; value: number }) => void;
}

export const DiscountModal: React.FC<DiscountModalProps> = ({ onClose, onApply }) => {
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);

  const handleApply = () => {
    if (discountValue > 0) {
      onApply({ type: discountType, value: discountValue });
      onClose();
    }
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Percent className="h-6 w-6 text-white mr-3" />
                <h2 className="text-xl font-semibold text-white">
                  Nastavit slevu
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-white hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-white hover:bg-opacity-20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Discount Type Selection */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Typ slevy
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setDiscountType('percentage')}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                    discountType === 'percentage'
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <Percent className="h-5 w-5 mr-2 text-green-600" />
                  <span className="font-medium">Procenta</span>
                </button>
                <button
                  onClick={() => setDiscountType('amount')}
                  className={`p-4 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                    discountType === 'amount'
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  <DollarSign className="h-5 w-5 mr-2 text-green-600" />
                  <span className="font-medium">Částka</span>
                </button>
              </div>
            </div>

            {/* Discount Value Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {discountType === 'percentage' ? 'Procenta slevy' : 'Částka slevy'}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max={discountType === 'percentage' ? 100 : undefined}
                  step={discountType === 'percentage' ? 1 : 0.01}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder={discountType === 'percentage' ? '0' : '0.00'}
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">
                  {discountType === 'percentage' ? '%' : 'Kč'}
                </div>
              </div>
              {discountType === 'percentage' && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Zadejte hodnotu od 0 do 100
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={handleCancel}
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200"
              >
                Zrušit
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleApply}
                disabled={discountValue <= 0}
                className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-3 rounded-lg font-medium hover:from-green-700 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                Aplikovat slevu
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
