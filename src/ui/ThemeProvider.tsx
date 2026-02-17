import React, { createContext, useContext, useMemo } from 'react';
import type { AppTheme } from './theme';
import { theme as defaultTheme } from './theme';

const ThemeContext = createContext<AppTheme>(defaultTheme);

export function ThemeProvider({ children, theme }: { children: React.ReactNode; theme?: AppTheme }) {
  const value = useMemo(() => theme ?? defaultTheme, [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}

