import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../core/auth';
import { ModuleKey, modules as coreModules } from '../core/modules';
import { flags } from '../data/feature-flags';
import { admin } from '../data/super-admin';

const ALL_MODULE_KEYS = coreModules.map((item) => item.key);

type EnabledModulesValue = {
  availableModules: ModuleKey[];
  isSuperAdmin: boolean;
  refresh: () => Promise<void>;
};

const EnabledModulesContext = createContext<EnabledModulesValue | null>(null);

function computeEnabledModules(rows: Array<{ key: string; enabled: boolean }>): ModuleKey[] {
  const rowMap = new Map<string, boolean>(rows.map((item) => [item.key, item.enabled]));

  const enabled = coreModules
    .filter((module) => {
      if (!rowMap.has(module.key)) {
        return true;
      }
      return rowMap.get(module.key) === true;
    })
    .map((module) => module.key);

  return enabled.length > 0 ? enabled : ['dashboard'];
}

export function EnabledModulesProvider({ children }: { children: React.ReactNode }) {
  const { activeOrgId, user } = useAuth();

  const [availableModules, setAvailableModules] = useState<ModuleKey[]>(ALL_MODULE_KEYS);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!user?.id) {
        setIsSuperAdmin(false);
        return;
      }

      try {
        const self = await admin.self();
        if (!cancelled) {
          setIsSuperAdmin(self.is_super_admin === true);
        }
      } catch {
        if (!cancelled) {
          setIsSuperAdmin(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      const filtered = isSuperAdmin ? ALL_MODULE_KEYS : ALL_MODULE_KEYS.filter((key) => key !== 'superadmin');
      setAvailableModules(filtered);
      return;
    }

    const applyFallbackDefaults = () => {
      const computed = coreModules
        .filter((module) => flags.isEnabled(module.key, { orgId: activeOrgId }))
        .map((module) => module.key);
      const nonEmpty = computed.length > 0 ? computed : (['dashboard'] as ModuleKey[]);

      const filtered: ModuleKey[] = isSuperAdmin
        ? nonEmpty.includes('superadmin')
          ? nonEmpty
          : [...nonEmpty, 'superadmin']
        : nonEmpty.filter((key): key is Exclude<ModuleKey, 'superadmin'> => key !== 'superadmin');

      setAvailableModules(filtered);
    };

    const applyRows = (rows: Array<{ key: string; enabled: boolean }>) => {
      const computed = computeEnabledModules(rows);
      const filtered: ModuleKey[] = isSuperAdmin
        ? computed.includes('superadmin')
          ? computed
          : [...computed, 'superadmin']
        : computed.filter((key): key is Exclude<ModuleKey, 'superadmin'> => key !== 'superadmin');
      setAvailableModules(filtered);
    };

    try {
      const cached = await flags.listAll(activeOrgId);
      applyRows(cached);
    } catch {
      applyFallbackDefaults();
    }

    try {
      const refreshed = await flags.refresh(activeOrgId);
      applyRows(refreshed);
    } catch {
      // Keep cached state on refresh failures.
    }
  }, [activeOrgId, isSuperAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<EnabledModulesValue>(
    () => ({
      availableModules,
      isSuperAdmin,
      refresh
    }),
    [availableModules, isSuperAdmin, refresh]
  );

  return <EnabledModulesContext.Provider value={value}>{children}</EnabledModulesContext.Provider>;
}

export function useEnabledModules() {
  const ctx = useContext(EnabledModulesContext);
  if (!ctx) {
    throw new Error('useEnabledModules must be used within EnabledModulesProvider');
  }
  return ctx;
}
