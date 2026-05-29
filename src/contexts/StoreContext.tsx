'use client';

import React, { createContext, useContext } from 'react';
import { Store } from '@/types';

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ store, children }: { store: Store; children: React.ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
