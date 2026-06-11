'use client';

import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/cn';
import { springPresets } from '@/lib/motion';

const variantStyles = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
} as const;

const sizeStyles = {
  sm: 'min-h-9 px-3 py-2 text-xs rounded-lg',
  md: 'min-h-11 px-4 py-2.5 text-sm rounded-xl',
  lg: 'min-h-12 px-5 py-3 text-base rounded-xl',
  icon: 'min-h-11 min-w-11 p-0 rounded-xl',
} as const;

export type ButtonVariant = keyof typeof variantStyles;
export type ButtonSize = keyof typeof sizeStyles;

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const spinnerColor =
      variant === 'primary' || variant === 'danger'
        ? 'border-white/90 border-t-transparent'
        : 'border-brand border-t-transparent';

    return (
      <motion.button
        ref={ref}
        type="button"
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.97 }}
        transition={springPresets.snappy}
        className={cn(
          variantStyles[variant],
          sizeStyles[size],
          loading && 'relative',
          className
        )}
        {...props}
      >
        {loading && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <span
              className={cn(
                'h-4 w-4 animate-spin rounded-full border-2',
                spinnerColor
              )}
            />
          </span>
        )}
        <span className={cn(loading && 'invisible')}>{children}</span>
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
