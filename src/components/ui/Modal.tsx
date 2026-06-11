'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { scaleFadeIn, springPresets } from '@/lib/motion';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Šířka obsahu — výchozí max-w-lg */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Skrýt tlačítko zavřít */
  hideCloseButton?: boolean;
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  className,
  size = 'md',
  hideCloseButton = false,
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

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'modal-title' : undefined}
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
            {...scaleFadeIn}
            className={cn(
              'relative z-10 w-full overflow-hidden rounded-3xl bg-surface-elevated shadow-elevated',
              'border border-border',
              sizeStyles[size],
              className
            )}
          >
            {(title || !hideCloseButton) && (
              <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2
                      id="modal-title"
                      className="text-lg font-semibold tracking-tight text-ink-primary"
                    >
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="mt-1 text-sm text-ink-secondary">
                      {description}
                    </p>
                  )}
                </div>
                {!hideCloseButton && (
                  <motion.button
                    type="button"
                    aria-label="Zavřít dialog"
                    onClick={onClose}
                    whileTap={{ scale: 0.92 }}
                    transition={springPresets.snappy}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink-primary"
                  >
                    <X className="h-5 w-5" />
                  </motion.button>
                )}
              </div>
            )}

            <div className="max-h-[min(80vh,720px)] overflow-y-auto px-6 py-5">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

Modal.displayName = 'Modal';
