import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingInvoice, type BillingInvoiceStatus, type BillingLineItem, type BillingPayment } from '../../data/billing';
import { billingPdf } from '../../data/billing/pdf';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Tag } from '../../ui/components/Tag';
import { Text } from '../../ui/components/Text';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingInvoiceDetail'>;

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

export function InvoiceDetailScreen({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { invoiceId } = route.params;
  const { role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  const [invoice, setInvoice] = useState<BillingInvoice | null>(null);
  const [lines, setLines] = useState<BillingLineItem[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inv = await billing.invoices.getById(invoiceId);
      setInvoice(inv);
      setLines(inv ? await billing.invoices.listLineItems(inv.id) : []);
      setPayments(inv ? await billing.invoices.listPayments(inv.id) : []);
      if (!inv) setError('Facture introuvable.');
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = async (status: BillingInvoiceStatus) => {
    if (!invoice) return;
    if (!access.canWrite) return;
    setLoading(true);
    setError(null);
    try {
      const next = await billing.invoices.update(invoice.id, { status });
      setInvoice(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    if (!invoice) return;
    if (!access.canExport) return;
    setLoading(true);
    setError(null);
    try {
      const result = await billingPdf.generateInvoicePdf(invoice.id);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.localPath, {
          mimeType: 'application/pdf',
          dialogTitle: 'Partager la facture'
        });
      } else {
        setError(`Partage indisponible. Fichier: ${result.localPath}`);
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const remaining = invoice ? Math.max(0, Math.round((invoice.total - invoice.paid_total) * 100) / 100) : 0;

  return (
    <Screen>
      <SectionHeader title="Facture" subtitle={invoice ? invoice.number : invoiceId} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {invoice ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="h2" numberOfLines={1}>
                    {invoice.number}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    Émis le {invoice.issue_date} · Échéance {invoice.due_date ?? '—'}
                  </Text>
                  <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
                    Total {money(invoice.total)} · Payé {money(invoice.paid_total)} · Reste {money(remaining)}
                  </Text>
                </View>
                <Tag label={statusLabel(invoice.status)} tone={statusTone(invoice.status)} />
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

              <View style={{ marginTop: spacing.md }}>
                <Text variant="bodyStrong">Paiements</Text>
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
                {access.canWrite ? (
                  <>
                    <Button
                      label="Modifier"
                      kind="ghost"
                      onPress={() => navigation.navigate('BillingInvoiceEdit', { invoiceId: invoice.id })}
                      disabled={loading}
                    />
                    <Button
                      label="Émettre"
                      kind="ghost"
                      onPress={() => void setStatus('issued')}
                      disabled={loading || invoice.status !== 'draft'}
                    />
                    <Button
                      label="Envoyer"
                      kind="ghost"
                      onPress={() => void setStatus('sent')}
                      disabled={loading || invoice.status !== 'issued'}
                    />
                  </>
                ) : null}
                {access.canWritePayments ? (
                  <Button
                    label="Ajouter paiement"
                    onPress={() => navigation.navigate('BillingPaymentCreate', { invoiceId: invoice.id })}
                    disabled={loading}
                  />
                ) : null}
                {access.canExport ? (
                  <Button label="Exporter PDF" kind="ghost" onPress={() => void exportPdf()} disabled={loading} />
                ) : null}
                {!access.canWrite && !access.canWritePayments && !access.canExport ? (
                  <Text variant="caption" style={{ color: colors.slate }}>
                    Lecture seule.
                  </Text>
                ) : null}
                <Button label={loading ? '...' : 'Rafraîchir'} kind="ghost" onPress={() => void refresh()} disabled={loading} />
              </View>
            </>
          ) : (
            <Text variant="caption" style={{ color: colors.slate }}>
              {loading ? 'Chargement...' : 'Facture introuvable.'}
            </Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
