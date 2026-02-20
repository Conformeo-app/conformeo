import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingInvoice, type BillingInvoiceListItem, type BillingInvoiceStatus, type BillingPayment } from '../../data/billing';
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

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingInvoices'>;

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

function statusLabel(status: BillingInvoiceStatus) {
  if (status === 'draft') return 'Brouillon';
  if (status === 'issued') return 'Émise';
  if (status === 'sent') return 'Envoyée';
  if (status === 'paid') return 'Payée';
  if (status === 'overdue') return 'En retard';
  return 'Annulée';
}

function statusTone(status: BillingInvoiceStatus) {
  if (status === 'paid') return 'success' as const;
  if (status === 'sent' || status === 'issued') return 'info' as const;
  if (status === 'overdue') return 'danger' as const;
  if (status === 'cancelled') return 'warning' as const;
  return 'neutral' as const;
}

function InvoicePreview({
  invoice,
  canWrite,
  canWritePayments,
  canExport,
  onEdit,
  onAddPayment,
  onExportPdf
}: {
  invoice: BillingInvoice;
  canWrite: boolean;
  canWritePayments: boolean;
  canExport: boolean;
  onEdit: () => void;
  onAddPayment: () => void;
  onExportPdf: () => void;
}) {
  const { spacing, colors } = useTheme();
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      try {
        const next = await billing.invoices.listPayments(invoice.id);
        if (!cancelled) setPayments(next);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  const dueLabel = invoice.due_date ? `Échéance ${invoice.due_date}` : 'Échéance —';
  const remaining = Math.max(0, Math.round((invoice.total - invoice.paid_total) * 100) / 100);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text variant="h2">{invoice.number}</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Statut: {statusLabel(invoice.status)} · {dueLabel}
        </Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Total {money(invoice.total)} · Payé {money(invoice.paid_total)} · Reste {money(remaining)}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <Text variant="bodyStrong">Paiements</Text>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose, marginTop: spacing.xs }}>
              {error}
            </Text>
          ) : null}
          {payments.length ? (
            payments.map((p) => (
              <View key={p.id} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderColor: colors.fog, paddingTop: spacing.sm }}>
                <Text variant="bodyStrong">
                  {money(p.amount)} · {p.method}
                </Text>
                <Text variant="caption" style={{ color: colors.slate }}>
                  {p.paid_at} {p.reference ? `· ${p.reference}` : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
              Aucun paiement.
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
          {canWrite ? <Button label="Modifier" kind="ghost" onPress={onEdit} /> : null}
          {canWritePayments ? <Button label="Ajouter paiement" onPress={onAddPayment} /> : null}
          {canExport ? <Button label="Exporter PDF" kind="ghost" onPress={onExportPdf} /> : null}
          {!canWrite && !canExport && !canWritePayments ? (
            <Text variant="caption" style={{ color: colors.slate }}>
              Lecture seule.
            </Text>
          ) : null}
        </View>
      </Card>
    </ScrollView>
  );
}

export function InvoicesListScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const { spacing, colors, radii } = useTheme();
  const { activeOrgId, role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });
  const isWide = width >= MIN_WIDE_LAYOUT_WIDTH;

  const [items, setItems] = useState<BillingInvoiceListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BillingInvoiceStatus | 'ALL'>('ALL');
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
      const next = await billing.invoices.list({ org_id: activeOrgId, q: query, status, limit: 200, offset: 0 });
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

  const selected = useMemo(() => items.find((inv) => inv.id === selectedId) ?? null, [items, selectedId]);

  const list = (
    <Screen style={{ padding: spacing.lg }}>
      <SectionHeader title="Factures" subtitle="Factures (draft/issued/sent/paid/overdue/cancelled)." />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {access.canWrite ? <Button label="Nouvelle facture" onPress={() => navigation.navigate('BillingInvoiceEdit', {})} /> : null}
        <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
      </View>

      <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button label="Toutes" kind={status === 'ALL' ? 'primary' : 'ghost'} onPress={() => setStatus('ALL')} />
        <Button label="Brouillons" kind={status === 'draft' ? 'primary' : 'ghost'} onPress={() => setStatus('draft')} />
        <Button label="Émises" kind={status === 'issued' ? 'primary' : 'ghost'} onPress={() => setStatus('issued')} />
        <Button label="Envoyées" kind={status === 'sent' ? 'primary' : 'ghost'} onPress={() => setStatus('sent')} />
        <Button label="En retard" kind={status === 'overdue' ? 'primary' : 'ghost'} onPress={() => setStatus('overdue')} />
        <Button label="Payées" kind={status === 'paid' ? 'primary' : 'ghost'} onPress={() => setStatus('paid')} />
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
          const remaining = Math.max(0, Math.round((item.total - item.paid_total) * 100) / 100);
          return (
            <Pressable
              onPress={() => {
                if (isWide) {
                  setSelectedId(item.id);
                } else {
                  navigation.navigate('BillingInvoiceDetail', { invoiceId: item.id });
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
                    {item.issue_date} · {money(item.total)} · Reste {money(remaining)}
                  </Text>
                </View>
                <Tag label={statusLabel(item.status)} tone={statusTone(item.status)} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="caption" style={{ color: colors.slate }}>
            {loading ? 'Chargement...' : 'Aucune facture.'}
          </Text>
        }
      />
    </Screen>
  );

  const preview = selected ? (
    <Screen style={{ padding: spacing.lg }}>
      <InvoicePreview
        invoice={selected}
        canWrite={access.canWrite}
        canWritePayments={access.canWritePayments}
        canExport={access.canExport}
        onEdit={() => navigation.navigate('BillingInvoiceEdit', { invoiceId: selected.id })}
        onAddPayment={() => navigation.navigate('BillingPaymentCreate', { invoiceId: selected.id })}
        onExportPdf={() => navigation.navigate('BillingInvoiceDetail', { invoiceId: selected.id })}
      />
    </Screen>
  ) : (
    <Screen style={{ padding: spacing.lg }}>
      <Card>
        <Text variant="h2">Sélection</Text>
        <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
          Sélectionnez une facture pour afficher le détail.
        </Text>
      </Card>
    </Screen>
  );

  if (!isWide) return list;
  return <SplitView sidebar={list} content={preview} breakpoint={MIN_WIDE_LAYOUT_WIDTH} />;
}

(InvoicesListScreen as any).screenKey = 'BILLING_INVOICES';
