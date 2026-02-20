import React, { useMemo } from 'react';
import { View } from 'react-native';
import type { BillingLineItemDraft } from '../../../data/billing';
import { Button } from '../../../ui/components/Button';
import { Card } from '../../../ui/components/Card';
import { Text } from '../../../ui/components/Text';
import { TextField } from '../../../ui/components/TextField';
import { useTheme } from '../../../ui/theme/ThemeProvider';

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function parseNumber(value: string, fallback = 0) {
  const cleaned = normalizeText(value).replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function money(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
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

export function LineItemEditor({
  items,
  onChangeItems,
  disabled
}: {
  items: BillingLineItemDraft[];
  onChangeItems: (next: BillingLineItemDraft[]) => void;
  disabled?: boolean;
}) {
  const { spacing, colors } = useTheme();
  const totals = useMemo(() => computeTotals(items), [items]);

  const updateItem = (index: number, patch: Partial<BillingLineItemDraft>) => {
    onChangeItems(
      items.map((item, idx) => {
        if (idx !== index) return item;
        return { ...item, ...patch };
      })
    );
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    onChangeItems(items.filter((_, idx) => idx !== index));
  };

  const addItem = () => {
    onChangeItems([...items, { label: 'Ligne', quantity: 1, unit_price: 0, tax_rate: 20 }]);
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
        <Text variant="bodyStrong">Lignes</Text>
        <Button label="+ Ligne" kind="ghost" onPress={addItem} disabled={disabled} />
      </View>

      {items.map((item, idx) => (
        <Card key={item.id ?? `new-${idx}`} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt }}>
          <TextField label="Libellé" value={String(item.label ?? '')} onChangeText={(v) => updateItem(idx, { label: v })} />

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
              Total ligne:{' '}
              {money(
                computeTotals([
                  {
                    ...item,
                    quantity: parseNumber(String(item.quantity), 0),
                    unit_price: parseNumber(String(item.unit_price), 0),
                    tax_rate: parseNumber(String(item.tax_rate), 0)
                  }
                ]).total
              )}
            </Text>
            <Button
              label="Supprimer"
              variant="danger"
              onPress={() => removeItem(idx)}
              disabled={disabled || items.length <= 1}
            />
          </View>
        </Card>
      ))}

      <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderColor: colors.fog, paddingTop: spacing.md }}>
        <Text variant="caption" style={{ color: colors.slate }}>
          Sous-total: {money(totals.subtotal)} · TVA: {money(totals.taxTotal)} · Total: {money(totals.total)}
        </Text>
      </View>
    </View>
  );
}

