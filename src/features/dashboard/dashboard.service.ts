import * as SQLite from 'expo-sqlite';
import { dashboard } from '../../data/dashboard';
import { media } from '../../data/media';
import { projects, type ProjectIndicators } from '../../data/projects';
import { quotas } from '../../data/quotas-limits';
import { conflicts } from '../../data/sync/conflicts';
import { ux } from '../../data/ux-accelerators';
import { ROUTES } from '../../navigation/routes';

export type DashboardGlobalStats = {
  activeProjects: number;
  openTasks: number; // TODO + DOING (excl. BLOCKED)
  blockedTasks: number;
  pendingUploads: number;
  failedUploads: number;
};

export type DashboardAlert = {
  key: string;
  level: 'INFO' | 'WARN' | 'CRIT';
  title: string;
  ctaLabel: string;
  ctaRoute: { screen: string; params?: any };
};

export type ProjectSummary = {
  projectId: string;
  name: string;
  risk: 'OK' | 'WATCH' | 'RISK';
  openTasks: number;
  blockedTasks: number;
  pendingUploads: number;
};

export type QuotaLevel = 'OK' | 'WARN' | 'CRIT';

export type DashboardCockpit = {
  stats: DashboardGlobalStats;
  quotaLevel: QuotaLevel;
  alerts: DashboardAlert[];
  projects: ProjectSummary[];
  lastProjectId: string | null;
};

const DB_NAME = 'conformeo.db';
const PROJECTS_TABLE = 'projects';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function tableExists(db: SQLite.SQLiteDatabase, tableName: string) {
  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `,
    tableName
  );

  return (row?.count ?? 0) > 0;
}

async function countActiveProjects(orgId: string) {
  const db = await getDb();
  if (!(await tableExists(db, PROJECTS_TABLE))) {
    return 0;
  }

  const row = await db.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM ${PROJECTS_TABLE}
      WHERE org_id = ?
        AND status_manual = 'ACTIVE'
    `,
    orgId
  );

  return row?.count ?? 0;
}

function computeQuotaLevel(storageUsedMb: number, storageMaxMb: number): QuotaLevel {
  if (!Number.isFinite(storageUsedMb) || storageUsedMb <= 0) return 'OK';
  if (!Number.isFinite(storageMaxMb) || storageMaxMb <= 0) return 'OK';

  const ratio = storageUsedMb / storageMaxMb;
  if (ratio >= 0.95) return 'CRIT';
  if (ratio >= 0.8) return 'WARN';
  return 'OK';
}

function levelScore(level: DashboardAlert['level']) {
  if (level === 'CRIT') return 3;
  if (level === 'WARN') return 2;
  return 1;
}

function riskScore(risk: ProjectSummary['risk']) {
  if (risk === 'RISK') return 3;
  if (risk === 'WATCH') return 2;
  return 1;
}

export async function getDashboardCockpit(input: {
  orgId: string;
  userId?: string;
}): Promise<DashboardCockpit> {
  const orgId = normalizeText(input.orgId);
  if (!orgId) {
    throw new Error('orgId requis.');
  }

  const userId = normalizeText(input.userId);

  dashboard.setContext({ org_id: orgId, user_id: userId || undefined, project_id: undefined });
  quotas.setContext({ org_id: orgId, user_id: userId || undefined });
  projects.setContext({ org_id: orgId });
  conflicts.setContext({ org_id: orgId, user_id: userId || undefined });
  ux.setContext({ org_id: orgId, user_id: userId || undefined });

  const [recents, summary, pendingUploads, failedUploads, activeProjects, quotaRow, usageRow] = await Promise.all([
    ux.listRecents(20).catch(() => []),
    dashboard.getSummary({ orgId }),
    media.countPendingUploads(orgId).catch(() => 0),
    media.countFailedUploads(orgId).catch(() => 0),
    countActiveProjects(orgId).catch(() => 0),
    quotas.get().catch(() => null),
    quotas.getUsage().catch(() => null)
  ]);

  const lastProjectId =
    recents.find((item) => item.entity === 'PROJECT')?.entity_id ??
    null;

  const openTasks = Math.max(0, summary.openTasks - summary.blockedTasks);
  const blockedTasks = summary.blockedTasks;

  const quotaLevel = computeQuotaLevel(usageRow?.storage_used_mb ?? 0, quotaRow?.storage_mb ?? 0);

  const stats: DashboardGlobalStats = {
    activeProjects,
    openTasks,
    blockedTasks,
    pendingUploads,
    failedUploads
  };

  // Project list (top 8): risk first, then recents.
  const projectRows = await projects
    .list({ org_id: orgId, include_archived: false, limit: 50, offset: 0 })
    .catch(() => []);

  const projectIds = projectRows.map((p) => p.id);
  const indicatorsById: Record<string, ProjectIndicators> =
    projectIds.length > 0
      ? await projects.getIndicators(orgId, projectIds).catch(() => ({} as Record<string, ProjectIndicators>))
      : {};

  const recentRank = new Map<string, number>();
  for (let i = 0; i < recents.length; i += 1) {
    const item = recents[i];
    if (item.entity === 'PROJECT') {
      recentRank.set(item.entity_id, i);
    }
  }

  const projectSummaries: ProjectSummary[] = projectRows.map((p) => {
    const ind = indicatorsById[p.id];
    return {
      projectId: p.id,
      name: p.name,
      risk: ind?.riskLevel ?? 'OK',
      openTasks: ind?.openTasks ?? 0,
      blockedTasks: ind?.blockedTasks ?? 0,
      pendingUploads: ind?.pendingUploads ?? 0
    };
  });

  projectSummaries.sort((a, b) => {
    const riskDiff = riskScore(b.risk) - riskScore(a.risk);
    if (riskDiff !== 0) return riskDiff;

    const rankA = recentRank.get(a.projectId) ?? Number.POSITIVE_INFINITY;
    const rankB = recentRank.get(b.projectId) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;

    return a.name.localeCompare(b.name);
  });

  const topProjects = projectSummaries.slice(0, 8);

  const conflictsCount = await conflicts.getOpenCount(orgId).catch(() => 0);
  const riskProjectsCount = projectSummaries.filter((p) => p.risk === 'RISK').length;
  const safetyProjects = projectIds
    .map((id) => ({ id, safety: indicatorsById[id]?.safetyOpenTasks ?? 0 }))
    .filter((row) => row.safety > 0)
    .sort((a, b) => b.safety - a.safety);
  const firstSafetyProjectId = safetyProjects[0]?.id ?? null;

  const alerts: DashboardAlert[] = [];

  if (conflictsCount > 0) {
    alerts.push({
      key: 'SYNC_CONFLICTS',
      level: 'CRIT',
      title: `${conflictsCount} conflit(s) de synchronisation`,
      ctaLabel: 'Résoudre',
      ctaRoute: { screen: ROUTES.SECURITY, params: { screen: 'Conflicts' } }
    });
  }

  if (failedUploads > 0) {
    alerts.push({
      key: 'UPLOADS_FAILED',
      level: failedUploads >= 10 ? 'CRIT' : 'WARN',
      title: `${failedUploads} upload(s) en échec`,
      ctaLabel: 'Voir',
      ctaRoute: lastProjectId
        ? { screen: 'ProjectDetail', params: { projectId: lastProjectId, tab: 'Media', mediaUploadStatus: 'FAILED' } }
        : { screen: ROUTES.PROJECTS }
    });
  }

  if (quotaLevel !== 'OK') {
    const used = usageRow?.storage_used_mb ?? 0;
    const max = quotaRow?.storage_mb ?? 0;
    const pct = max > 0 ? Math.round((used / max) * 100) : 0;
    alerts.push({
      key: 'STORAGE_QUOTA',
      level: quotaLevel === 'CRIT' ? 'CRIT' : 'WARN',
      title: `Stockage à ${pct}%`,
      ctaLabel: 'Quotas',
      ctaRoute: { screen: ROUTES.ENTERPRISE, params: { screen: 'OrgAdmin' } }
    });
  }

  if (riskProjectsCount > 0) {
    alerts.push({
      key: 'PROJECTS_RISK',
      level: 'WARN',
      title: `${riskProjectsCount} chantier(s) à risque`,
      ctaLabel: 'Voir',
      ctaRoute: { screen: ROUTES.PROJECTS }
    });
  }

  if (summary.safetyOpenTasks > 0) {
    alerts.push({
      key: 'SAFETY_TASKS',
      level: 'WARN',
      title: `${summary.safetyOpenTasks} tâche(s) sécurité ouvertes`,
      ctaLabel: 'Voir',
      ctaRoute: firstSafetyProjectId
        ? { screen: 'ProjectDetail', params: { projectId: firstSafetyProjectId, tab: 'Tasks' } }
        : { screen: ROUTES.PROJECTS }
    });
  }

  alerts.sort((a, b) => levelScore(b.level) - levelScore(a.level));

  return {
    stats,
    quotaLevel,
    alerts: alerts.slice(0, 3),
    projects: topProjects,
    lastProjectId
  };
}
