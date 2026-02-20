import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../core/auth';
import { billing, type BillingClient, type BillingLineItem, type BillingLineItemDraft, type BillingQuote } from '../../data/billing';
import type { EnterpriseStackParamList } from '../../navigation/types';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Text } from '../../ui/components/Text';
import { TextField } from '../../ui/components/TextField';
import { Screen } from '../../ui/layout/Screen';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { SectionHeader } from '../common/SectionHeader';
import { computeBillingAccess } from './access';

type Props = NativeStackScreenProps<EnterpriseStackParamList, 'BillingQuoteEdit'>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inconnue.';
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function money(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function parseNumber(value: string, fallback = 0) {
  const cleaned = normalizeText(value).replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function computeTotals(items: BillingLineItemDraft[]) {
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const qty = Math.max(0, parseNumber(String(item.quantity), 0));
    const unit = Math.max(0, parseNumber(String(item.unit_price), 0));
    const rate = Math.max(0, parseNumber(String(item.tax_rate), 0));
    const base = Math.round(qty * unit * 100) / 100;
    const tax = Math.round(((base * rate) / 100) * 100) / 100;
    subtotal = Math.round((subtotal + base) * 100) / 100;
    taxTotal = Math.round((taxTotal + tax) * 100) / 100;
  }

  const total = Math.round((subtotal + taxTotal) * 100) / 100;
  return { subtotal, taxTotal, total };
}

function ClientPickerModal({
  visible,
  orgId,
  onClose,
  onPick
}: {
  visible: boolean;
  orgId: string;
  onClose: () => void;
  onPick: (client: BillingClient) => void;
}) {
  const { spacing, colors, radii } = useTheme();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<BillingClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await billing.clients.list({ org_id: orgId, q: normalizeText(query), limit: 200, offset: 0 });
      setItems(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, query]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [load, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <Card style={{ flex: 1, minHeight: 0 }}>
          <Text variant="h2">Choisir un client</Text>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher (nom/email)"
            autoCapitalize="none"
            style={{ marginTop: spacing.md }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Rechercher" onPress={() => void load()} disabled={loading} />
            <Button label="Fermer" kind="ghost" onPress={onClose} disabled={loading} />
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
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                style={{
                  borderWidth: 1,
                  borderColor: colors.fog,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  backgroundColor: colors.white,
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
            )}
            ListEmptyComponent={
              <Text variant="caption" style={{ color: colors.slate }}>
                {loading ? 'Chargement...' : 'Aucun client.'}
              </Text>
            }
          />
        </Card>
      </Screen>
    </Modal>
  );
}

export function QuoteEditScreen({ navigation, route }: Props) {
  const { spacing, colors } = useTheme();
  const { activeOrgId, role, permissions } = useAuth();
  const access = computeBillingAccess({ role, permissions });

  const quoteId = route.params?.quoteId;
  const presetClientId = route.params?.clientId;
  const isEdit = Boolean(quoteId);

  if (!access.canWrite) {
    return (
      <Screen>
        <SectionHeader title={isEdit ? 'Modifier devis' : 'Nouveau devis'} subtitle="Accès refusé (lecture seule)." />
        <Card>
          <Text variant="bodyStrong">Vous n’avez pas la permission de modifier la facturation.</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            Rôle requis : manager/admin (billing:write).
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button label="Retour" kind="ghost" onPress={() => navigation.goBack()} />
          </View>
        </Card>
      </Screen>
    );
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [existingLineItems, setExistingLineItems] = useState<BillingLineItem[]>([]);

  const [clientId, setClientId] = useState(presetClientId ?? '');
  const [clientName, setClientName] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  const [draftItems, setDraftItems] = useState<BillingLineItemDraft[]>([
    { label: 'Prestation', quantity: 1, unit_price: 0, tax_rate: 20 }
  ]);

  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const refreshClientName = useCallback(async (nextClientId: string) => {
    if (!activeOrgId) return;
    const clean = normalizeText(nextClientId);
    if (!clean) {
      setClientName(null);
      return;
    }
    try {
      const c = await billing.clients.getById(clean);
      setClientName(c?.name ?? clean);
    } catch {
      setClientName(clean);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void refreshClientName(clientId);
  }, [clientId, refreshClientName]);

  useEffect(() => {
    if (!quoteId) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const q = await billing.quotes.getById(quoteId);
        if (!q) {
          throw new Error('Devis introuvable.');
        }
        const lines = await billing.quotes.listLineItems(q.id);
        if (cancelled) return;

        setQuote(q);
        setExistingLineItems(lines);
        setClientId(q.client_id);
        setIssueDate(q.issue_date);
        setValidUntil(q.valid_until ?? '');
        setNotes(q.notes ?? '');
        setDraftItems(
          lines.length
            ? lines.map((item) => ({
                id: item.id,
                label: item.label,
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: item.tax_rate,
                position: item.position
              }))
            : [{ label: 'Prestation', quantity: 1, unit_price: 0, tax_rate: 20 }]
        );
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  const totals = useMemo(() => computeTotals(draftItems), [draftItems]);

  const updateItem = (index: number, patch: Partial<BillingLineItemDraft>) => {
    setDraftItems((current) => {
      const next = [...current];
      const prev = next[index];
      if (!prev) return current;
      next[index] = { ...prev, ...patch };
      return next;
    });
  };

  const removeItem = (index: number) => {
    setDraftItems((current) => current.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setDraftItems((current) => [...current, { label: 'Ligne', quantity: 1, unit_price: 0, tax_rate: 20 }]);
  };

  const save = async () => {
    if (!activeOrgId) {
      setError('Aucune organisation active.');
      return;
    }

    const cleanClientId = normalizeText(clientId);
    if (!cleanClientId) {
      setError('Client requis.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (!quoteId) {
        const created = await billing.quotes.create({
          client_id: cleanClientId,
          issue_date: normalizeText(issueDate) || undefined,
          valid_until: normalizeText(validUntil) || undefined,
          notes: normalizeText(notes) || undefined,
          line_items: draftItems.map((item, idx) => ({
            id: item.id,
            label: normalizeText(item.label) || `Ligne ${idx + 1}`,
            quantity: parseNumber(String(item.quantity), 1),
            unit_price: parseNumber(String(item.unit_price), 0),
            tax_rate: parseNumber(String(item.tax_rate), 20),
            position: idx
          }))
        });
        navigation.replace('BillingQuoteDetail', { quoteId: created.id });
        return;
      }

      await billing.quotes.update(quoteId, {
        client_id: cleanClientId,
        issue_date: normalizeText(issueDate),
        valid_until: normalizeText(validUntil) || null,
        notes: normalizeText(notes) || null
      });

      const nextIds = new Set<string>();
      for (let idx = 0; idx < draftItems.length; idx += 1) {
        const item = draftItems[idx]!;
        const payload: BillingLineItemDraft = {
          label: normalizeText(item.label) || `Ligne ${idx + 1}`,
          quantity: parseNumber(String(item.quantity), 1),
          unit_price: parseNumber(String(item.unit_price), 0),
          tax_rate: parseNumber(String(item.tax_rate), 20),
          position: idx
        };

        if (item.id) {
          nextIds.add(item.id);
          await billing.lineItems.update(item.id, payload);
        } else {
          const createdLine = await billing.lineItems.create('quote', quoteId, payload);
          nextIds.add(createdLine.id);
        }
      }

      for (const existing of existingLineItems) {
        if (!nextIds.has(existing.id)) {
          await billing.lineItems.softDelete(existing.id);
        }
      }

      navigation.replace('BillingQuoteDetail', { quoteId });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <SectionHeader title={isEdit ? 'Modifier devis' : 'Nouveau devis'} subtitle={quote ? quote.number : 'Devis offline-first.'} />

      <ClientPickerModal
        visible={clientPickerOpen}
        orgId={activeOrgId ?? ''}
        onClose={() => setClientPickerOpen(false)}
        onPick={(client) => {
          setClientPickerOpen(false);
          setClientId(client.id);
          setClientName(client.name);
        }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Card>
          {error ? (
            <Text variant="caption" style={{ color: colors.rose }}>
              {error}
            </Text>
          ) : null}

          <Text variant="bodyStrong">Client</Text>
          <Text variant="caption" style={{ color: colors.slate, marginTop: spacing.xs }}>
            {clientName ?? (clientId ? clientId : '—')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Choisir un client" kind="ghost" onPress={() => setClientPickerOpen(true)} disabled={!activeOrgId || loading} />
            <Button label="Créer un client" kind="ghost" onPress={() => navigation.navigate('BillingClientEdit', {})} disabled={loading} />
          </View>

          <View style={{ height: spacing.md }} />
          <TextField label="Date d'émission (YYYY-MM-DD)" value={issueDate} onChangeText={setIssueDate} placeholder="2026-02-17" />
          <TextField label="Valide jusqu’au (option)" value={validUntil} onChangeText={setValidUntil} placeholder="2026-03-17" style={{ marginTop: spacing.sm }} />
          <TextField label="Notes (option)" value={notes} onChangeText={setNotes} multiline style={{ marginTop: spacing.sm }} />

          <View style={{ height: spacing.md }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
            <Text variant="bodyStrong">Lignes</Text>
            <Button label="+ Ligne" kind="ghost" onPress={addItem} disabled={loading} />
          </View>

          {draftItems.map((item, idx) => (
            <Card key={item.id ?? `new-${idx}`} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt }}>
              <TextField
                label="Libellé"
                value={String(item.label ?? '')}
                onChangeText={(v) => updateItem(idx, { label: v })}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label="Qté"
                    value={String(item.quantity ?? '')}
                    onChangeText={(v) => updateItem(idx, { quantity: parseNumber(v, 1) })}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label="PU"
                    value={String(item.unit_price ?? '')}
                    onChangeText={(v) => updateItem(idx, { unit_price: parseNumber(v, 0) })}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label="TVA %"
                    value={String(item.tax_rate ?? '')}
                    onChangeText={(v) => updateItem(idx, { tax_rate: parseNumber(v, 20) })}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                <Text variant="caption" style={{ color: colors.slate }}>
                  Total ligne: {money(computeTotals([{ ...item, quantity: parseNumber(String(item.quantity), 0), unit_price: parseNumber(String(item.unit_price), 0), tax_rate: parseNumber(String(item.tax_rate), 0) }]).total)}
                </Text>
                <Button label="Supprimer" variant="danger" onPress={() => removeItem(idx)} disabled={loading || draftItems.length <= 1} />
              </View>
            </Card>
          ))}

          <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderColor: colors.fog, paddingTop: spacing.md }}>
            <Text variant="caption" style={{ color: colors.slate }}>
              Sous-total: {money(totals.subtotal)} · TVA: {money(totals.taxTotal)} · Total: {money(totals.total)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <Button label="Enregistrer" onPress={() => void save()} disabled={loading} />
            <Button label="Annuler" kind="ghost" onPress={() => navigation.goBack()} disabled={loading} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
