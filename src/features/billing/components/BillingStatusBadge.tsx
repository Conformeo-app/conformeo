import React from 'react';
import type { BillingInvoiceStatus, BillingQuoteStatus } from '../../../data/billing';
import { Tag } from '../../../ui/components/Tag';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Props =
  | { kind: 'quote'; status: BillingQuoteStatus }
  | { kind: 'invoice'; status: BillingInvoiceStatus };

function quoteLabel(status: BillingQuoteStatus) {
  if (status === 'draft') return 'Brouillon';
  if (status === 'sent') return 'Envoyé';
  if (status === 'accepted') return 'Accepté';
  if (status === 'rejected') return 'Refusé';
  return 'Expiré';
}

function quoteTone(status: BillingQuoteStatus): Tone {
  if (status === 'accepted') return 'success';
  if (status === 'sent') return 'info';
  if (status === 'rejected') return 'danger';
  if (status === 'expired') return 'warning';
  return 'neutral';
}

function invoiceLabel(status: BillingInvoiceStatus) {
  if (status === 'draft') return 'Brouillon';
  if (status === 'issued') return 'Émise';
  if (status === 'sent') return 'Envoyée';
  if (status === 'paid') return 'Payée';
  if (status === 'overdue') return 'En retard';
  return 'Annulée';
}

function invoiceTone(status: BillingInvoiceStatus): Tone {
  if (status === 'paid') return 'success';
  if (status === 'issued' || status === 'sent') return 'info';
  if (status === 'overdue') return 'danger';
  if (status === 'cancelled') return 'warning';
  return 'neutral';
}

export function BillingStatusBadge(props: Props) {
  if (props.kind === 'quote') {
    return <Tag label={quoteLabel(props.status)} tone={quoteTone(props.status)} />;
  }

  return <Tag label={invoiceLabel(props.status)} tone={invoiceTone(props.status)} />;
}

