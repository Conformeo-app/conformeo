import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingClient } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { SearchInput } from '../../ui/components/SearchInput';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { SplitView } from '../../ui/layout/SplitView';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingClients'>;

const MIN_WIDE_LAYOUT_WIDTH = 1024;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Erreur inconnue.';
}

function ClientPreview({
  client,
  canWrite,
  onEdit,
  onCreateQuote,
  onCreateInvoice
}: {
  client: BillingClient;
  canWrite: boolean;
  onEdit: () => void;
  onCreateQuote: () => void;
  onCreateInvoice: () => void;
}) {
  const { spacing, colors } = useTheme();

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text variant="h2" numberOfLines={2}>
          {client.name}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          {client.email ?? '—'} · {client.phone ?? '—'}
        </Text>
        {client.vat_number ? (
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            TVA: {client.vat_number}
          </Text>
        ) : null}
        {client.address_line1 || client.address_city ? (
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            {[
              client.address_line1,
              client.address_line2,
              [client.address_zip, client.address_city].filter(Boolean).join(' '),
              client.address_country
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          {canWrite ? (
            <>
              <Button label="Modifier" kind="ghost" onPress={onEdit} />
              <Button label="Nouveau devis" onPress={onCreateQuote} />
              <Button label="Nouvelle facture" kind="ghost" onPress={onCreateInvoice} />
            </>
          ) : (
            <Text variant="caption" style={{ color: colors.slate }}>
              Lecture seule.
            </Text>
          )}
        </View>
      </Card>
    </ScrollView>
  );
}

export function ClientsListScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const { colors, spacing, radii } = useTheme();
  const { activeOrgId, role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const [items, setItems] = useState<BillingClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery((prev) => {
        const next = normalizeText(queryDraft);
        return prev === next ? prev : next;
      });
    }, 220);

    return () => clearTimeout(handle);
  }, [queryDraft]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await billing.clients.list({ org_id: activeOrgId, q: query, limit: 200, offset: 0 });
      setItems(next);
      if (isWide && next.length && !selectedId) {
        setSelectedId(next[0]!.id);
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, isWide, query, selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(() => items.find((c) => c.id === selectedId) ?? null, [items, selectedId]);

  const list = (
    <Screen style={{ padding: spacing.lg }}>
      <SectionHeader title="Clients" subtitle="Gestion clients (offline-first)." />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {access.canWrite ? <Button label="Nouveau client" onPress={() => navigation.navigate('BillingClientEdit', {})} /> : null}
        <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
      </View>

      <View style={{ marginTop: spacing.md }}>
        <SearchInput value={queryDraft} onChangeText={setQueryDraft} placeholder="Rechercher (nom/email)" />
      </View>

      {error ? (
        <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.sm }}>
          {error}
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isActive = item.id === selectedId;
          return (
            <Pressable
              onPress={() => {
                if (isWide) {
                  setSelectedId(item.id);
                } else {
                  navigation.navigate('BillingClientDetail', { clientId: item.id });
                }
              }}
              style={{
                borderWidth: 1,
                borderColor: colors.fog,
                borderRadius: radii.md,
                padding: spacing.md,
                backgroundColor: isActive ? colors.primarySoft : colors.white,
                marginBottom: spacing.sm
              }}
            >
              <Text variant="bodyStrong" numberOfLines={1}>
                {item.name}
              </Text>
              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                {item.email ?? '—'} · {item.phone ?? '—'}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="caption" style={{ color: colors.slate }}>
            {loading ? 'Chargement...' : 'Aucun client.'}
          </Text>
        }
      />
    </Screen>
  );

  const preview = selected ? (
    <Screen style={{ padding: spacing.lg }}>
      <ClientPreview
        client={selected}
        canWrite={access.canWrite}
        onEdit={() => navigation.navigate('BillingClientEdit', { clientId: selected.id })}
        onCreateQuote={() => navigation.navigate('BillingQuoteEdit', { clientId: selected.id })}
        onCreateInvoice={() => navigation.navigate('BillingInvoiceEdit', { clientId: selected.id })}
      />
    </Screen>
  ) : (
    <Screen style={{ padding: spacing.lg }}>
      <Card>
        <Text variant="h2">Sélection</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Sélectionnez un client pour afficher le détail.
        </Text>
      </Card>
    </Screen>
  );

  if (!isWide) {
    return list;
  }

  return <SplitView sidebar={list} content={preview} breakpoint={MIN_WIDE_LAYOUT_WIDTH} />;
}

(ClientsListScreen as any).screenKey = 'BILLING_CLIENTS';
