'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { springPresets } from '@/lib/motion';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Výška sheetu — výchozí auto s max-height */
  snapHeight?: 'auto' | 'half' | 'full';
  /** Povolit tažení dolů pro zavření */
  dismissible?: boolean;
}

const snapHeightStyles = {
  auto: 'max-h-[min(85vh,720px)]',
  half: 'h-[50vh]',
  full: 'h-[92vh]',
} as const;

const DISMISS_THRESHOLD = 120;

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  children,
  className,
  snapHeight = 'auto',
  dismissible = true,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (!dismissible) return;
    if (info.offset.y > DISMISS_THRESHOLD || info.velocity.y > 500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'sheet-title' : undefined}
        >
          <motion.button
            type="button"
            aria-label="Zavřít"
            className="absolute inset-0 bg-[var(--backdrop-overlay)] backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springPresets.sheet}
            drag={dismissible ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={handleDragEnd}
            className={cn(
              'relative z-10 w-full overflow-hidden rounded-t-3xl',
              'bg-surface-elevated shadow-elevated border-t border-border',
              snapHeightStyles[snapHeight],
              className
            )}
          >
            <div className="safe-top px-4 pb-2 pt-3">
              {dismissible && <div className="sheet-handle" aria-hidden />}

              {title && (
                <div className="mb-3 flex items-center justify-between gap-3 px-2">
                  <h2
                    id="sheet-title"
                    className="text-lg font-semibold tracking-tight text-ink-primary"
                  >
                    {title}
                  </h2>
                  <motion.button
                    type="button"
                    aria-label="Zavřít"
                    onClick={onClose}
                    whileTap={{ scale: 0.92 }}
                    transition={springPresets.snappy}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
                  >
                    <X className="h-5 w-5" />
                  </motion.button>
                </div>
              )}
            </div>

            <div
              className={cn(
                'overflow-y-auto px-4 safe-bottom',
                title ? 'pb-6' : 'py-4 pb-6'
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

BottomSheet.displayName = 'BottomSheet';
