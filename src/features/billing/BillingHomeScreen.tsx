import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingSummary } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingHome'>;

function money(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

export function BillingHomeScreen({ navigation }: Props) {
  const { spacing, colors } = useTheme();
  const { activeOrgId, loading: authLoading, role, permissions } = useAuth();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const access = computeBillingAccess({ role, permissions });

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setSummary(await billing.getSummary());
      void billing.warmNumbering().catch(() => null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement facturation impossible.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!authLoading && !access.canRead) {
    return (
      <Screen>
        <SectionHeader title="Facturation" subtitle="Accès refusé (permission billing:read manquante)." />
        <Card>
          <Text variant="bodyStrong">Vous n’avez pas accès à la facturation.</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Demandez à un administrateur de vous accorder les permissions.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader title="Facturation" subtitle="Clients, devis, factures, paiements. Offline-first." />

      <View style={{ gap: spacing.md }}>
        <Card>
          <Text variant="h2">Synthèse</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md }}>
            <View style={{ minWidth: 160 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                Clients
              </Text>
              <Text variant="h2">{summary ? summary.clients : '—'}</Text>
            </View>
            <View style={{ minWidth: 160 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                Devis brouillons
              </Text>
              <Text variant="h2">{summary ? summary.quotesDraft : '—'}</Text>
            </View>
            <View style={{ minWidth: 160 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                Factures ouvertes
              </Text>
              <Text variant="h2">{summary ? summary.invoicesOpen : '—'}</Text>
            </View>
            <View style={{ minWidth: 160 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                En retard
              </Text>
              <Text variant="h2" style={{ color: summary && summary.invoicesOverdue > 0 ? colors.rose : colors.ink }}>
                {summary ? summary.invoicesOverdue : '—'}
              </Text>
            </View>
            <View style={{ minWidth: 200 }}>
              <Text variant="caption" style={{ color: colors.slate }}>
                Total dû
              </Text>
              <Text variant="h2">{summary ? money(summary.totalDue) : '—'}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
          </View>

          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
              {error}
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text variant="h2">Accès rapide</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Les données restent disponibles hors ligne. La synchronisation est silencieuse.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Clients" onPress={() => navigation.navigate('BillingClients')} />
            <Button label="Devis" kind="ghost" onPress={() => navigation.navigate('BillingQuotes')} />
            <Button label="Factures" kind="ghost" onPress={() => navigation.navigate('BillingInvoices')} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

(BillingHomeScreen as any).screenKey = 'BILLING_HOME';
