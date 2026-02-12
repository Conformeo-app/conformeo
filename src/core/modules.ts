export type ModuleKey =
  | 'dashboard'
  | 'orgs'
  | 'tasks'
  | 'documents'
  | 'exports'
  | 'search'
  | 'offline'
  | 'media'
  | 'plans'
  | 'security'
  | 'control'
  | 'accelerators'
  | 'conflicts';

export const modules: Array<{ key: ModuleKey; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Dashboard', hint: 'Synthèse terrain' },
  { key: 'accelerators', label: 'Accélérateurs', hint: 'Quick actions & modèles' },
  { key: 'orgs', label: 'Entreprise', hint: 'Équipe, paramètres, modules' },
  { key: 'tasks', label: 'Tâches', hint: 'Création rapide + preuves' },
  { key: 'documents', label: 'Documents', hint: 'Dossiers + versions' },
  { key: 'exports', label: 'Exports', hint: 'PDF + ZIP DOE' },
  { key: 'control', label: 'Controle', hint: 'Inspection lecture seule' },
  { key: 'search', label: 'Recherche', hint: 'Globale & modules' },
  { key: 'offline', label: 'Offline', hint: 'Sync & conflits' },
  { key: 'conflicts', label: 'Conflits', hint: 'Résolution sync' },
  { key: 'media', label: 'Médias', hint: 'Pipeline WebP' },
  { key: 'plans', label: 'Plans', hint: 'Annotations PDF' },
  { key: 'security', label: 'Sécurité', hint: 'RLS & signatures' }
];
