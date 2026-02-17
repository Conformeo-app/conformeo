export type ModuleKey =
  | 'dashboard'
  | 'orgs'
  | 'company'
  | 'tasks'
  | 'equipment'
  | 'planning'
  | 'waste'
  | 'carbon'
  | 'offers'
  | 'documents'
  | 'exports'
  | 'search'
  | 'audit'
  | 'offline'
  | 'media'
  | 'plans'
  | 'security'
  | 'backup'
  | 'governance'
  | 'control'
  | 'accelerators'
  | 'conflicts'
  | 'superadmin';

export const modules: Array<{ key: ModuleKey; label: string; hint: string }> = [
  { key: 'dashboard', label: 'Tableau de bord', hint: 'Synthèse terrain' },
  { key: 'accelerators', label: 'Accélérateurs', hint: 'Quick actions & modèles' },
  { key: 'orgs', label: 'Entreprise', hint: 'Équipe, paramètres, modules' },
  { key: 'company', label: 'Espace entreprise', hint: 'Docs internes, certifs, sécurité' },
  { key: 'tasks', label: 'Tâches', hint: 'Création rapide + preuves' },
  { key: 'equipment', label: 'Équipements', hint: 'Matériel, mouvements, liaisons tâches' },
  { key: 'planning', label: 'Planning', hint: 'Calendrier chantier + affectations' },
  { key: 'waste', label: 'Déchets', hint: 'Volumes, catégories, export CSV' },
  { key: 'carbon', label: 'Carbone', hint: 'Bilan carbone simplifié (MVP)' },
  { key: 'offers', label: 'Offres', hint: 'Plans SaaS + modules + tarification' },
  { key: 'documents', label: 'Documents', hint: 'Dossiers + versions' },
  { key: 'exports', label: 'Exports', hint: 'PDF + ZIP DOE' },
  { key: 'control', label: 'Controle', hint: 'Inspection lecture seule' },
  { key: 'search', label: 'Recherche', hint: 'Globale & modules' },
  { key: 'audit', label: 'Audit', hint: 'Traçabilité conformité' },
  { key: 'offline', label: 'Hors ligne', hint: 'Synchronisation & conflits' },
  { key: 'conflicts', label: 'Conflits', hint: 'Résolution sync' },
  { key: 'media', label: 'Médias', hint: 'Pipeline WebP' },
  { key: 'plans', label: 'Plans', hint: 'Annotations PDF' },
  { key: 'security', label: 'Sécurité', hint: 'RLS & signatures' },
  { key: 'governance', label: 'Gouvernance', hint: 'RGPD, rétention, portabilité' },
  { key: 'backup', label: 'Sauvegarde', hint: 'Export / import local' },
  { key: 'superadmin', label: 'Super-admin', hint: 'Console support (MFA)' }
];
