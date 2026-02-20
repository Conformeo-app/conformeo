import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../core/auth';
import { billing, type BillingClient } from '../../../data/billing';

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inconnue.';
}

export function useClients(options: { limit?: number; initialQuery?: string } = {}) {
  const { activeOrgId } = useAuth();
  const [items, setItems] = useState<BillingClient[]>([]);
  const [query, setQuery] = useState(options.initialQuery ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await billing.clients.list({
        org_id: activeOrgId,
        q: normalizeText(query),
        limit: options.limit ?? 200,
        offset: 0
      });
      setItems(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, options.limit, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    orgId: activeOrgId,
    items,
    query,
    setQuery,
    loading,
    error,
    refresh
  };
}

