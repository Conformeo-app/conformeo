import type { BillingLineItemDraft } from './types';

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function isTempBillingNumber(value: string) {
  const cleaned = value.trim().toUpperCase();
  return cleaned.startsWith('TEMP-') || cleaned.startsWith('TMP-');
}

export function makeTempBillingNumber(id: string) {
  const token = id.trim();
  return `TEMP-${token.length > 0 ? token : 'UNKNOWN'}`;
}

export function computeBillingTotals(items: BillingLineItemDraft[]) {
  let subtotal = 0;
  let tax_total = 0;

  for (const item of items) {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unit = Math.max(0, Number(item.unit_price) || 0);
    const rate = Math.max(0, Number(item.tax_rate) || 0);

    const lineSubtotal = roundMoney(qty * unit);
    const lineTax = roundMoney((lineSubtotal * rate) / 100);
    subtotal = roundMoney(subtotal + lineSubtotal);
    tax_total = roundMoney(tax_total + lineTax);
  }

  const total = roundMoney(subtotal + tax_total);
  return { subtotal, tax_total, total };
}

