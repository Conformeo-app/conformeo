export const colors = {
  ink: '#0D1B2A',
  slate: '#1B263B',
  teal: '#1B9AAA',
  tealDark: '#147A85',
  amber: '#F4A259',
  sand: '#F6F2EA',
  fog: '#EAE7E0',
  mint: '#D9F2E6',
  rose: '#D64550',
  white: '#FFFFFF'
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999
};

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  h1: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 }
};

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4
  }
};

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  elevation
};

export type Theme = typeof theme;
