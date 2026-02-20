import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingLineItem, type BillingQuote, type BillingQuoteStatus } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Tag } from '../../ui/components/Tag';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingQuoteDetail'>;

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

export function QuoteDetailScreen({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { quoteId } = route.params;
  const { role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [lines, setLines] = useState<BillingLineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = await billing.quotes.getById(quoteId);
      setQuote(q);
      setLines(q ? await billing.quotes.listLineItems(q.id) : []);
      if (!q) setError('Devis introuvable.');
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = async (status: BillingQuoteStatus) => {
    if (!quote) return;
    if (!access.canWrite) return;
    setLoading(true);
    setError(null);
    try {
      const next = await billing.quotes.update(quote.id, { status });
      setQuote(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <SectionHeader title="Devis" subtitle={quote ? quote.number : quoteId} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {quote ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="h2" numberOfLines={1}>
                    {quote.number}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    Émis le {quote.issue_date} · Total {money(quote.total)}
                  </Text>
                </View>
                <Tag label={statusLabel(quote.status)} tone={statusTone(quote.status)} />
              </View>

              <View style={{ marginTop: spacing.md }}>
                <Text variant="bodyStrong">Lignes</Text>
                {lines.length ? (
                  lines.map((item) => (
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
                {access.canWrite ? (
                  <>
                    <Button
                      label="Modifier"
                      kind="ghost"
                      onPress={() => navigation.navigate('BillingQuoteEdit', { quoteId: quote.id })}
                      disabled={loading}
                    />
                    <Button
                      label="Envoyé"
                      kind="ghost"
                      onPress={() => void setStatus('sent')}
                      disabled={loading || quote.status !== 'draft'}
                    />
                    <Button
                      label="Convertir en facture"
                      onPress={() => navigation.navigate('BillingInvoiceEdit', { quoteId: quote.id, clientId: quote.client_id })}
                      disabled={loading}
                    />
                  </>
                ) : (
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Lecture seule.
                  </Text>
                )}
                <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
              </View>
            </>
          ) : (
            <Text variant="caption" style={{ color: colors.slate }}>
              {loading ? 'Chargement...' : 'Devis introuvable.'}
            </Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
