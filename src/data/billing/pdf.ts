import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { audit } from '../audit-compliance';
import { billing } from './billing';
import type { BillingClient, BillingInvoice, BillingLineItem, BillingPayment, BillingQuote } from './types';

type PdfResult = { localPath: string; sizeBytes: number };

function nowIso() {
  return new Date().toISOString();
}

function htmlEscape(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(amount: number, currency = 'EUR') {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency });
}

function requireDocumentDirectory() {
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return dir;
}

function exportsRootDir() {
  return `${requireDocumentDirectory()}billing_exports/`;
}

function sanitizeFileToken(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized.length > 0 ? normalized : 'doc';
}

async function ensureDir() {
  await FileSystem.makeDirectoryAsync(exportsRootDir(), { intermediates: true });
}

function clientBlock(client: BillingClient) {
  const parts = [
    client.name,
    client.address_line1,
    client.address_line2,
    [client.address_zip, client.address_city].filter(Boolean).join(' '),
    client.address_country
  ].filter(Boolean);

  return `
    <div class="block">
      <div class="label">Client</div>
      <div class="value">${parts.map((p) => htmlEscape(String(p))).join('<br/>')}</div>
      <div class="muted">${htmlEscape(client.email ?? '—')} · ${htmlEscape(client.phone ?? '—')}</div>
      ${client.vat_number ? `<div class="muted">TVA: ${htmlEscape(client.vat_number)}</div>` : ''}
    </div>
  `;
}

function linesTable(lines: BillingLineItem[], currency = 'EUR') {
  if (!lines.length) {
    return `<div class="muted">Aucune ligne.</div>`;
  }

  const rows = lines
    .sort((a, b) => a.position - b.position)
    .map(
      (l) => `
    <tr>
      <td>${htmlEscape(l.label)}</td>
      <td class="num">${l.quantity}</td>
      <td class="num">${htmlEscape(money(l.unit_price, currency))}</td>
      <td class="num">${l.tax_rate}%</td>
      <td class="num">${htmlEscape(money(l.line_total, currency))}</td>
    </tr>
  `
    )
    .join('\n');

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Libellé</th>
          <th class="num">Qté</th>
          <th class="num">PU</th>
          <th class="num">TVA</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function paymentsBlock(payments: BillingPayment[], currency = 'EUR') {
  if (!payments.length) {
    return `<div class="muted">Aucun paiement.</div>`;
  }

  const rows = payments
    .slice()
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    .map((p) => `<li>${htmlEscape(p.paid_at)} — ${htmlEscape(money(p.amount, currency))} (${htmlEscape(p.method)})</li>`)
    .join('\n');

  return `<ul class="list">${rows}</ul>`;
}

function baseHtml(body: string, title: string) {
  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${htmlEscape(title)}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #1F2933; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; }
        .brand { font-size: 18px; font-weight: 700; color: #0E7C86; }
        .muted { color: #52606D; font-size: 12px; margin-top: 4px; }
        .h1 { font-size: 24px; font-weight: 700; margin: 0; }
        .block { border: 1px solid #E0E3E7; border-radius: 10px; padding: 12px; margin-top: 12px; }
        .label { font-size: 12px; color: #52606D; text-transform: uppercase; letter-spacing: 0.04em; }
        .value { font-size: 14px; margin-top: 6px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .table th, .table td { border-bottom: 1px solid #E0E3E7; padding: 8px; font-size: 12px; vertical-align: top; }
        .table th { text-align: left; color: #52606D; }
        .num { text-align: right; white-space: nowrap; }
        .totals { margin-top: 12px; display: flex; justify-content: flex-end; }
        .totals .box { min-width: 240px; border: 1px solid #E0E3E7; border-radius: 10px; padding: 10px; }
        .totals .row { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; }
        .watermark { position: fixed; bottom: 14px; left: 0; right: 0; text-align: center; color: #9AA5B1; font-size: 10px; }
        .list { margin: 8px 0 0 16px; padding: 0; }
      </style>
    </head>
    <body>
      ${body}
      <div class="watermark">Généré par Conforméo — ${htmlEscape(nowIso())}</div>
    </body>
  </html>
  `;
}

function invoiceHtml(invoice: BillingInvoice, client: BillingClient, lines: BillingLineItem[], payments: BillingPayment[]) {
  const remaining = Math.max(0, Math.round((invoice.total - invoice.paid_total) * 100) / 100);
  return baseHtml(
    `
    <div class="header">
      <div>
        <div class="brand">Conforméo</div>
        <div class="muted">Facturation — offline-first</div>
      </div>
      <div style="text-align:right;">
        <div class="h1">Facture</div>
        <div class="muted">${htmlEscape(invoice.number)}</div>
        <div class="muted">Émise le ${htmlEscape(invoice.issue_date)} · Échéance ${htmlEscape(invoice.due_date ?? '—')}</div>
      </div>
    </div>

    ${clientBlock(client)}

    <div class="block">
      <div class="label">Lignes</div>
      ${linesTable(lines, invoice.currency)}
      <div class="totals">
        <div class="box">
          <div class="row"><span>Sous-total</span><span>${htmlEscape(money(invoice.subtotal, invoice.currency))}</span></div>
          <div class="row"><span>TVA</span><span>${htmlEscape(money(invoice.tax_total, invoice.currency))}</span></div>
          <div class="row"><strong>Total</strong><strong>${htmlEscape(money(invoice.total, invoice.currency))}</strong></div>
          <div class="row"><span>Payé</span><span>${htmlEscape(money(invoice.paid_total, invoice.currency))}</span></div>
          <div class="row"><span>Reste</span><span>${htmlEscape(money(remaining, invoice.currency))}</span></div>
        </div>
      </div>
    </div>

    <div class="block">
      <div class="label">Paiements</div>
      ${paymentsBlock(payments, invoice.currency)}
    </div>

    ${invoice.notes ? `<div class="block"><div class="label">Notes</div><div class="value">${htmlEscape(invoice.notes)}</div></div>` : ''}
    `,
    `Facture ${invoice.number}`
  );
}

function quoteHtml(quote: BillingQuote, client: BillingClient, lines: BillingLineItem[]) {
  return baseHtml(
    `
    <div class="header">
      <div>
        <div class="brand">Conforméo</div>
        <div class="muted">Facturation — offline-first</div>
      </div>
      <div style="text-align:right;">
        <div class="h1">Devis</div>
        <div class="muted">${htmlEscape(quote.number)}</div>
        <div class="muted">Émis le ${htmlEscape(quote.issue_date)} · Valide jusqu’au ${htmlEscape(quote.valid_until ?? '—')}</div>
      </div>
    </div>

    ${clientBlock(client)}

    <div class="block">
      <div class="label">Lignes</div>
      ${linesTable(lines, 'EUR')}
      <div class="totals">
        <div class="box">
          <div class="row"><span>Sous-total</span><span>${htmlEscape(money(quote.subtotal))}</span></div>
          <div class="row"><span>TVA</span><span>${htmlEscape(money(quote.tax_total))}</span></div>
          <div class="row"><strong>Total</strong><strong>${htmlEscape(money(quote.total))}</strong></div>
        </div>
      </div>
    </div>

    ${quote.notes ? `<div class="block"><div class="label">Notes</div><div class="value">${htmlEscape(quote.notes)}</div></div>` : ''}
    `,
    `Devis ${quote.number}`
  );
}

async function printToPdfFile(html: string, fileName: string): Promise<PdfResult> {
  await ensureDir();

  const tmp = await Print.printToFileAsync({ html, base64: false });
  const targetPath = `${exportsRootDir()}${sanitizeFileToken(fileName)}.pdf`;

  try {
    await FileSystem.deleteAsync(targetPath, { idempotent: true });
  } catch {
    // ignore
  }

  await FileSystem.moveAsync({ from: tmp.uri, to: targetPath });
  const info = await FileSystem.getInfoAsync(targetPath);
  return { localPath: targetPath, sizeBytes: info.exists ? info.size : 0 };
}

export const billingPdf = {
  async generateInvoicePdf(invoiceId: string): Promise<PdfResult> {
    const inv = await billing.invoices.getById(invoiceId);
    if (!inv) {
      throw new Error('Facture introuvable.');
    }
    const client = await billing.clients.getById(inv.client_id);
    if (!client) {
      throw new Error('Client introuvable.');
    }

    const [lines, payments] = await Promise.all([
      billing.invoices.listLineItems(inv.id),
      billing.invoices.listPayments(inv.id)
    ]);

    const html = invoiceHtml(inv, client, lines, payments);
    const fileName = `FACTURE_${inv.number}_${inv.issue_date}_${inv.id}`;
    const result = await printToPdfFile(html, fileName);

    await audit.log('billing.invoice.export_pdf', 'BILLING_INVOICE', inv.id, {
      number: inv.number,
      local_path: result.localPath,
      size_bytes: result.sizeBytes
    });

    return result;
  },

  async generateQuotePdf(quoteId: string): Promise<PdfResult> {
    const quote = await billing.quotes.getById(quoteId);
    if (!quote) {
      throw new Error('Devis introuvable.');
    }
    const client = await billing.clients.getById(quote.client_id);
    if (!client) {
      throw new Error('Client introuvable.');
    }

    const lines = await billing.quotes.listLineItems(quote.id);
    const html = quoteHtml(quote, client, lines);
    const fileName = `DEVIS_${quote.number}_${quote.issue_date}_${quote.id}`;
    const result = await printToPdfFile(html, fileName);

    await audit.log('billing.quote.export_pdf', 'BILLING_QUOTE', quote.id, {
      number: quote.number,
      local_path: result.localPath,
      size_bytes: result.sizeBytes
    });

    return result;
  }
};
