export type ModuleKey =
  | 'dashboard'
  | 'tasks'
  | 'search'
  | 'offline'
  | 'media'
  | 'plans'
  | 'security';

export const modules: Array<{ key: ModuleKey; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Dashboard', hint: 'Synthèse terrain' },
  { key: 'tasks', label: 'Tâches', hint: 'Création rapide + preuves' },
  { key: 'search', label: 'Recherche', hint: 'Globale & modules' },
  { key: 'offline', label: 'Offline', hint: 'Sync & conflits' },
  { key: 'media', label: 'Médias', hint: 'Pipeline WebP' },
  { key: 'plans', label: 'Plans', hint: 'Annotations PDF' },
  { key: 'security', label: 'Sécurité', hint: 'RLS & signatures' }
];
