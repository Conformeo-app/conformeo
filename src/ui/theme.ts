// Conformeo Design System v1.0 (DS-CORE-01)
// Single source of truth for tokens + small helper functions.

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const theme = {
  colors: {
    // Brand / functional
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

    // Utility
    overlay: 'rgba(0,0,0,0.35)',
    white: '#FFFFFF',
    black: '#000000',

    // Soft backgrounds for states/badges
    successBg: '#E8F5E9',
    warningBg: '#FFF3E0',
    dangerBg: '#FFEBEE',
    infoBg: '#E3F2FD',
    warningText: '#ED6C02',

    // Compatibility aliases (avoid using in new code)
    text: '#1F2933',
    mutedText: '#52606D',
    onPrimary: '#FFFFFF',
    ink: '#1F2933',
    slate: '#52606D',
    teal: '#0E7C86',
    tealDark: '#0B626A',
    amber: '#ED6C02',
    sand: '#F7F9FA',
    fog: '#E0E3E7',
    mint: '#E6F4F6',
    rose: '#D32F2F'
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    // Legacy alias (avoid in new code; prefer `xxl`)
    '2xl': 48
  },

  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    xl: 24,
    pill: 999
  },
  // Backwards compatibility (older code uses `radii`)
  radii: {
    sm: 6,
    md: 10,
    lg: 16,
    xl: 24,
    pill: 999
  },

  typography: {
    h1: { fontSize: 24, fontWeight: '700' as const, lineHeight: 30 },
    h2: { fontSize: 20, fontWeight: '600' as const, lineHeight: 26 },
    h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
    body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
    bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
    bodySmall: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
    caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
    // Legacy alias used in some headers (avoid in new code)
    display: { fontSize: 24, fontWeight: '700' as const, lineHeight: 30 }
  },

  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2
    },
    md: {
      shadowColor: '#000',
      shadowOpacity: 0.14,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4
    }
  },

  layout: {
    sideMenuWidth: 260,
    topBarHeight: 64,
    maxContentWidth: 1400,
    drawerWidth: 420
  }
} as const;

export type AppTheme = typeof theme;

export const toneToColor = (t: Tone, th: AppTheme = theme) => {
  switch (t) {
    case 'primary':
      return th.colors.primary;
    case 'success':
      return th.colors.success;
    case 'warning':
      return th.colors.warning;
    case 'danger':
      return th.colors.danger;
    case 'info':
      return th.colors.info;
    default:
      return th.colors.textSecondary;
  }
};

export const toneSoftBg = (t: Tone, th: AppTheme = theme) => {
  // soft backgrounds (keep readable, no random pastel)
  switch (t) {
    case 'primary':
      return th.colors.primarySoft;
    case 'success':
      return '#EAF6EC';
    case 'warning':
      return '#FFF1E6';
    case 'danger':
      return '#FDECEC';
    case 'info':
      return '#E8F1FB';
    default:
      return th.colors.surfaceAlt;
  }
};
