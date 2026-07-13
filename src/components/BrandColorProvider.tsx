'use client';

import { useEffect } from 'react';
import { applyColorScheme, ColorSchemeId, DEFAULT_COLOR_SCHEME } from '@/lib/colorScheme';

interface BrandColorProviderProps {
  colorScheme?: ColorSchemeId | null;
  children: React.ReactNode;
}

export function BrandColorProvider({ colorScheme, children }: BrandColorProviderProps) {
  useEffect(() => {
    applyColorScheme(colorScheme ?? DEFAULT_COLOR_SCHEME);
    return () => {
      applyColorScheme(DEFAULT_COLOR_SCHEME);
    };
  }, [colorScheme]);

  return <>{children}</>;
}
