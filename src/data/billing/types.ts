export type BillingCurrency = 'EUR';

export type BillingClient = {
  id: string;
  org_id: string;
  name: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  address_zip?: string;
  address_city?: string;
  address_country?: string;
  vat_number?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type BillingQuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type BillingInvoiceStatus = 'draft' | 'issued' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export type BillingQuote = {
  id: string;
  org_id: string;
  client_id: string;
  number: string;
  status: BillingQuoteStatus;
  issue_date: string;
  valid_until?: string;
  subtotal: number;
  tax_total: number;
  total: number;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type BillingQuoteListItem = BillingQuote & { client_name: string };

export type BillingInvoice = {
  id: string;
  org_id: string;
  client_id: string;
  quote_id?: string;
  number: string;
  status: BillingInvoiceStatus;
  issue_date: string;
  due_date?: string;
  subtotal: number;
  tax_total: number;
  total: number;
  paid_total: number;
  currency: BillingCurrency;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type BillingInvoiceListItem = BillingInvoice & { client_name: string };

export type BillingLineItemParentType = 'quote' | 'invoice';

export type BillingLineItem = {
  id: string;
  org_id: string;
  parent_type: BillingLineItemParentType;
  parent_id: string;
  label: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type BillingPaymentMethod = 'transfer' | 'card' | 'cash' | 'check' | 'other';

export type BillingPayment = {
  id: string;
  org_id: string;
  invoice_id: string;
  amount: number;
  method: BillingPaymentMethod;
  paid_at: string;
  reference?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};

export type BillingClientCreateInput = {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  address_zip?: string;
  address_city?: string;
  address_country?: string;
  vat_number?: string;
};

export type BillingClientUpdatePatch = Partial<BillingClientCreateInput> & {
  deleted_at?: string | null;
};

export type BillingLineItemDraft = {
  id?: string;
  label: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  position?: number;
};

export type BillingQuoteCreateInput = {
  id?: string;
  client_id: string;
  issue_date?: string;
  valid_until?: string;
  notes?: string;
  status?: BillingQuoteStatus;
  line_items?: BillingLineItemDraft[];
};

export type BillingQuoteUpdatePatch = Partial<{
  client_id: string;
  issue_date: string;
  valid_until: string | null;
  notes: string | null;
  status: BillingQuoteStatus;
  subtotal: number;
  tax_total: number;
  total: number;
  deleted_at: string | null;
}>;

export type BillingInvoiceCreateInput = {
  id?: string;
  client_id: string;
  quote_id?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  status?: BillingInvoiceStatus;
  currency?: BillingCurrency;
  line_items?: BillingLineItemDraft[];
};

export type BillingInvoiceUpdatePatch = Partial<{
  client_id: string;
  quote_id: string | null;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  status: BillingInvoiceStatus;
  subtotal: number;
  tax_total: number;
  total: number;
  paid_total: number;
  deleted_at: string | null;
}>;

export type BillingPaymentCreateInput = {
  id?: string;
  amount: number;
  method: BillingPaymentMethod;
  paid_at?: string;
  reference?: string;
};

export type BillingListOptions = {
  org_id: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  q?: string;
};

export type BillingQuotesListOptions = BillingListOptions & {
  status?: BillingQuoteStatus | 'ALL';
  client_id?: string;
};

export type BillingInvoicesListOptions = BillingListOptions & {
  status?: BillingInvoiceStatus | 'ALL';
  client_id?: string;
};

export type BillingSummary = {
  clients: number;
  quotesDraft: number;
  invoicesOpen: number;
  invoicesOverdue: number;
  totalDue: number;
};

export type BillingNumberKind = 'quote' | 'invoice';

export type BillingNumberReservation = {
  org_id: string;
  kind: BillingNumberKind;
  prefix: string;
  start_number: number;
  end_number: number;
  reserved_at: string;
};
