import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingInvoice, type BillingPaymentMethod } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { TextField } from '../../ui/components/TextField';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingPaymentCreate'>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inconnue.';
}

function money(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parseNumber(value: string, fallback = 0) {
  const cleaned = normalizeText(value).replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export function PaymentCreateModal({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { invoiceId } = route.params;
  const { role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  if (!access.canWritePayments) {
    return (
      <Screen>
        <SectionHeader title="Ajouter un paiement" subtitle="Accès refusé (lecture seule)." />
        <Card>
          <Text variant="bodyStrong">Vous n’avez pas la permission d’ajouter des paiements.</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Permission requise : billing:payments:write (ou billing:write).
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Retour" kind="ghost" onPress={() => navigation.goBack()} />
          </View>
        </Card>
      </Screen>
    );
  }

  const [invoice, setInvoice] = useState<BillingInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<BillingPaymentMethod>('transfer');
  const [paidAt, setPaidAt] = useState('');
  const [reference, setReference] = useState('');

  const remaining = useMemo(() => {
    if (!invoice) return 0;
    return Math.max(0, Math.round((invoice.total - invoice.paid_total) * 100) / 100);
  }, [invoice]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inv = await billing.invoices.getById(invoiceId);
      setInvoice(inv);
      if (!inv) setError('Facture introuvable.');
      if (inv) {
        setAmount(String(remaining || inv.total));
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [invoiceId, remaining]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const save = async () => {
    if (!invoice) return;

    setLoading(true);
    setError(null);
    try {
      await billing.invoices.addPayment(invoice.id, {
        amount: parseNumber(amount, remaining || invoice.total),
        method,
        paid_at: normalizeText(paidAt) || undefined,
        reference: normalizeText(reference) || undefined
      });
      navigation.replace('BillingInvoiceDetail', { invoiceId: invoice.id });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <SectionHeader title="Ajouter un paiement" subtitle={invoice ? invoice.number : invoiceId} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          {invoice ? (
            <>
              <Text variant="caption" style={{ color: colors.slate }}>
                Total {money(invoice.total)} · Payé {money(invoice.paid_total)} · Reste {money(remaining)}
              </Text>

              <TextField label="Montant" value={amount} onChangeText={setAmount} keyboardType="numeric" style={{ marginTop: spacing.md }} />

              <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.sm }}>
                Méthode
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                {(['transfer', 'card', 'cash', 'check', 'other'] as BillingPaymentMethod[]).map((m) => (
                  <Button key={m} label={m} kind={method === m ? 'primary' : 'ghost'} onPress={() => setMethod(m)} disabled={loading} />
                ))}
              </View>

              <TextField label="Date (YYYY-MM-DD)" value={paidAt} onChangeText={setPaidAt} placeholder="2026-02-17" style={{ marginTop: spacing.md }} />
              <TextField label="Référence (option)" value={reference} onChangeText={setReference} style={{ marginTop: spacing.sm }} />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                <Button label="Enregistrer" onPress={() => void save()} disabled={loading} />
                <Button label="Annuler" kind="ghost" onPress={() => navigation.goBack()} disabled={loading} />
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
