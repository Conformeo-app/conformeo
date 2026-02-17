export const colors = {
  // Official DS-CORE-01 functional colors
  primary: '#0E7C86',
  primaryPressed: '#0B626A',
  primarySoft: '#E6F4F6',

  success: '#2E7D32',
  warning: '#ED6C02',
  danger: '#D32F2F',
  info: '#1976D2',

  // Neutrals
  bg: '#F7F9FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F4',
  border: '#E0E3E7',

  textPrimary: '#1F2933',
  textSecondary: '#52606D',
  textMuted: '#9AA5B1',

  // Common semantic aliases used by the codebase
  text: '#1F2933',
  mutedText: '#52606D',
  onPrimary: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.35)',

  // Soft backgrounds (used for badges/states)
  successBg: '#E8F5E9',
  warningBg: '#FFF3E0',
  dangerBg: '#FFEBEE',
  infoBg: '#E3F2FD',
  warningText: '#ED6C02',

  // Legacy palette keys kept for compatibility across the codebase
  ink: '#1F2933',
  slate: '#52606D',
  teal: '#0E7C86',
  tealDark: '#0B626A',
  amber: '#ED6C02',
  sand: '#F7F9FA',
  fog: '#E0E3E7',
  mint: '#E6F4F6',
  rose: '#D32F2F',
  white: '#FFFFFF'
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  // Legacy alias (avoid in new code; prefer `xxl`)
  '2xl': 48
};

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  // "pill" is used for fully-rounded controls (IconButton/FAB). Badges should use `xl`.
  pill: 999
};

export const typography = {
  // Official DS-CORE-01 typography
  h1: { fontSize: 24, fontWeight: '700' as const },
  h2: { fontSize: 20, fontWeight: '600' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  bodySmall: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  // Legacy alias used in headers (avoid in new code; prefer h1/h2/h3)
  display: { fontSize: 24, fontWeight: '700' as const }
};

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2
  }
};

export const shadows = {
  // Minimal (DS-CORE-01): only 2 levels.
  sm: elevation.card,
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6
  }
};

export const layout = {
  sideMenuWidth: 260,
  topBarHeight: 64,
  maxContentWidth: 1400
};

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  elevation,
  shadows,
  layout
};

export type Theme = typeof theme;
