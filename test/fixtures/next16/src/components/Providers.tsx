'use client';

import { createContext, useContext, type ReactNode } from 'react';

const ThemeContext = createContext<'light' | 'dark'>('light');
export const useTheme = () => useContext(ThemeContext);

export function Providers({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value="light">{children}</ThemeContext.Provider>;
}
