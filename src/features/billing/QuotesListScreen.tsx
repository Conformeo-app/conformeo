import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingLineItem, type BillingQuote, type BillingQuoteListItem, type BillingQuoteStatus } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { SearchInput } from '../../ui/components/SearchInput';
import { Tag } from '../../ui/components/Tag';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { SplitView } from '../../ui/layout/SplitView';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingQuotes'>;

const MIN_WIDE_LAYOUT_WIDTH = 1024;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inconnue.';
}

function money(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function statusLabel(status: BillingQuoteStatus) {
  if (status === 'draft') return 'Brouillon';
  if (status === 'sent') return 'Envoyé';
  if (status === 'accepted') return 'Accepté';
  if (status === 'rejected') return 'Refusé';
  return 'Expiré';
}

function statusTone(status: BillingQuoteStatus) {
  if (status === 'accepted') return 'success' as const;
  if (status === 'sent') return 'info' as const;
  if (status === 'rejected') return 'danger' as const;
  if (status === 'expired') return 'warning' as const;
  return 'neutral' as const;
}

function QuotePreview({
  quote,
  canWrite,
  onEdit,
  onConvertToInvoice
}: {
  quote: BillingQuote;
  canWrite: boolean;
  onEdit: () => void;
  onConvertToInvoice: () => void;
}) {
  const { spacing, colors } = useTheme();
  const [items, setItems] = useState<BillingLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      try {
        const next = await billing.quotes.listLineItems(quote.id);
        if (!cancelled) setItems(next);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [quote.id]);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text variant="h2">{quote.number}</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Statut: {statusLabel(quote.status)}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Émis le {quote.issue_date} · Total {money(quote.total)}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">Lignes</Text>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
              {error}
            </Text>
          ) : null}
          {items.length ? (
            items.map((item) => (
              <View key={item.id} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderColor: colors.fog, paddingTop: spacing.sm }}>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {item.label}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {item.quantity} × {money(item.unit_price)} · TVA {item.tax_rate}% · {money(item.line_total)}
                </Text>
              </View>
            ))
          ) : (
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Aucune ligne.
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          {canWrite ? (
            <>
              <Button label="Modifier" kind="ghost" onPress={onEdit} />
              <Button label="Convertir en facture" onPress={onConvertToInvoice} />
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

export function QuotesListScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const { spacing, colors, radii } = useTheme();
  const { activeOrgId, role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });
  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const [items, setItems] = useState<BillingQuoteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BillingQuoteStatus | 'ALL'>('ALL');
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
      const next = await billing.quotes.list({ org_id: activeOrgId, q: query, status, limit: 200, offset: 0 });
      setItems(next);
      if (isWide && next.length && !selectedId) {
        setSelectedId(next[0]!.id);
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeOrgId, isWide, query, selectedId, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(() => items.find((q) => q.id === selectedId) ?? null, [items, selectedId]);

  const list = (
    <Screen style={{ padding: spacing.lg }}>
      <SectionHeader title="Devis" subtitle="Devis (draft/sent/accepted/rejected/expired)." />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {access.canWrite ? <Button label="Nouveau devis" onPress={() => navigation.navigate('BillingQuoteEdit', {})} /> : null}
        <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
      </View>

      <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button label="Tous" kind={status === 'ALL' ? 'primary' : 'ghost'} onPress={() => setStatus('ALL')} />
        <Button label="Brouillons" kind={status === 'draft' ? 'primary' : 'ghost'} onPress={() => setStatus('draft')} />
        <Button label="Envoyés" kind={status === 'sent' ? 'primary' : 'ghost'} onPress={() => setStatus('sent')} />
        <Button label="Acceptés" kind={status === 'accepted' ? 'primary' : 'ghost'} onPress={() => setStatus('accepted')} />
      </View>

      <View style={{ marginTop: spacing.md }}>
        <SearchInput value={queryDraft} onChangeText={setQueryDraft} placeholder="Rechercher (numéro, client…)" />
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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        renderItem={({ item }) => {
          const isActive = item.id === selectedId;
          return (
            <Pressable
              onPress={() => {
                if (isWide) {
                  setSelectedId(item.id);
                } else {
                  navigation.navigate('BillingQuoteDetail', { quoteId: item.id });
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {item.number} · {item.client_name}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }} numberOfLines={1}>
                    {item.issue_date} · {money(item.total)}
                  </Text>
                </View>
                <Tag label={statusLabel(item.status)} tone={statusTone(item.status)} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="caption" style={{ color: colors.slate }}>
            {loading ? 'Chargement...' : 'Aucun devis.'}
          </Text>
        }
      />
    </Screen>
  );

  const preview = selected ? (
    <Screen style={{ padding: spacing.lg }}>
      <QuotePreview
        quote={selected}
        canWrite={access.canWrite}
        onEdit={() => navigation.navigate('BillingQuoteEdit', { quoteId: selected.id })}
        onConvertToInvoice={() => navigation.navigate('BillingInvoiceEdit', { quoteId: selected.id, clientId: selected.client_id })}
      />
    </Screen>
  ) : (
    <Screen style={{ padding: spacing.lg }}>
      <Card>
        <Text variant="h2">Sélection</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Sélectionnez un devis pour afficher le détail.
        </Text>
      </Card>
    </Screen>
  );

  if (!isWide) return list;
  return <SplitView sidebar={list} content={preview} breakpoint={MIN_WIDE_LAYOUT_WIDTH} />;
}

(QuotesListScreen as any).screenKey = 'BILLING_QUOTES';
