'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Šířka — výchozí plná */
  width?: string | number;
  /** Výška — výchozí h-4 */
  height?: string | number;
  /** Zakulacení */
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Bez shimmer animace */
  static?: boolean;
}

const roundedStyles = {
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  xl: 'rounded-2xl',
  full: 'rounded-full',
} as const;

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  width,
  height,
  rounded = 'lg',
  static: isStatic = false,
  style,
  ...props
}) => (
  <div
    aria-hidden
    className={cn(
      'bg-surface-muted',
      !isStatic && 'skeleton',
      roundedStyles[rounded],
      className
    )}
    style={{
      width: width ?? '100%',
      height: height ?? '1rem',
      ...style,
    }}
    {...props}
  />
);

Skeleton.displayName = 'Skeleton';

/** Předpřipravený skeleton pro produktovou kartu */
export const ProductCardSkeleton: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={cn('space-y-3', className)}>
    <Skeleton height={120} rounded="xl" />
    <Skeleton height={16} width="75%" rounded="md" />
    <Skeleton height={14} width="40%" rounded="md" />
  </div>
);

ProductCardSkeleton.displayName = 'ProductCardSkeleton';

/** Předpřipravený skeleton pro řádek v seznamu */
export const ListRowSkeleton: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={cn('flex items-center gap-4 py-3', className)}>
    <Skeleton width={48} height={48} rounded="xl" />
    <div className="flex-1 space-y-2">
      <Skeleton height={14} width="60%" rounded="md" />
      <Skeleton height={12} width="35%" rounded="md" />
    </div>
    <Skeleton height={14} width={64} rounded="md" />
  </div>
);

ListRowSkeleton.displayName = 'ListRowSkeleton';

/** Předpřipravený skeleton pro kartu prodejny */
export const StoreCardSkeleton: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={cn('card-elevated p-6 space-y-4', className)}>
    <div className="flex items-center gap-4">
      <Skeleton width={48} height={48} rounded="xl" />
      <div className="flex-1 space-y-2">
        <Skeleton height={18} width="55%" rounded="md" />
        <Skeleton height={12} width="35%" rounded="md" />
      </div>
    </div>
    <Skeleton height={12} width="45%" rounded="md" />
  </div>
);

StoreCardSkeleton.displayName = 'StoreCardSkeleton';
