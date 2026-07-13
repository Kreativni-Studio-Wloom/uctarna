'use client';

import { useEffect } from 'react';
import { applyBrandColor, applyStoreBrandColor, DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE } from '@/lib/colorScheme';
import { Store } from '@/types';

interface BrandColorProviderProps {
  store: Pick<Store, 'brandHue' | 'brandShade' | 'colorScheme'>;
  children: React.ReactNode;
}

export function BrandColorProvider({ store, children }: BrandColorProviderProps) {
  useEffect(() => {
    applyStoreBrandColor(store);
    return () => {
      applyBrandColor(DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE);
    };
  }, [store.brandHue, store.brandShade, store.colorScheme]);

  return <>{children}</>;
}
