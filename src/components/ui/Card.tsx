'use client';

import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/cn';
import { springPresets } from '@/lib/motion';

export interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
} as const;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      interactive = false,
      padding = 'md',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <motion.div
        ref={ref}
        whileTap={interactive ? { scale: 0.985 } : undefined}
        transition={springPresets.snappy}
        className={cn(
          interactive ? 'card-interactive cursor-pointer' : 'card-elevated',
          paddingStyles[padding],
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  description,
  action,
  className,
  ...props
}) => (
  <div
    className={cn('mb-4 flex items-start justify-between gap-4', className)}
    {...props}
  >
    <div>
      <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-sm text-ink-secondary">{description}</p>
      )}
    </div>
    {action}
  </div>
);

CardHeader.displayName = 'CardHeader';
