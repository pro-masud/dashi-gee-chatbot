/**
 * Printable order documents — pure, browser-safe. Every dynamic value is HTML-escaped, so a customer
 * name or address can never inject markup into a printed page.
 */

export type OrderDocKind = 'invoice' | 'packing_slip' | 'label';

export interface DocOrder {
  orderNumber: string;
  customerName: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  note?: string;
  itemsSummary?: string;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  paymentMethod: string;
  courierPartner?: string;
  consignmentId?: string;
  createdAt?: unknown;
}

export interface DocStore {
  name: string;
  phone: string;
  address: string;
}

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const bdt = (n: number) => `৳${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

function lines(o: DocOrder): { name: string; qty: number }[] {
  const out: { name: string; qty: number }[] = [];
  if (o.qty250g) out.push({ name: '250g jar', qty: o.qty250g });
  if (o.qty500g) out.push({ name: '500g jar', qty: o.qty500g });
  if (o.qty1kg) out.push({ name: '1kg jar', qty: o.qty1kg });
  if (out.length === 0 && o.itemsSummary) out.push({ name: o.itemsSummary, qty: 1 });
  return out;
}

function dateText(createdAt: unknown): string {
  const ms =
    typeof createdAt === 'string'
      ? Date.parse(createdAt)
      : createdAt && typeof (createdAt as { toDate?: () => Date }).toDate === 'function'
        ? (createdAt as { toDate: () => Date }).toDate().getTime()
        : NaN;
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' }).format(new Date(ms));
}

const BASE_CSS = `
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;font-size:13px}
  h1{font-size:20px;margin:0 0 4px}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:left}
  th{font-size:11px;text-transform:uppercase;color:#555}
  td.num,th.num{text-align:right}
  .muted{color:#666}
  .total{font-size:16px;font-weight:700}
  .box{border:1px solid #bbb;border-radius:6px;padding:10px 12px;margin-top:12px}
  @media print{body{padding:0}}
`;

const LABEL_CSS = `
  @page{size:80mm auto;margin:3mm}
  body{width:74mm;padding:0;font-size:12px}
  .big{font-size:16px;font-weight:700}
  .cod{border:2px solid #000;padding:6px;margin-top:8px;text-align:center;font-size:18px;font-weight:700}
  hr{border:0;border-top:1px dashed #000;margin:8px 0}
`;

export function buildOrderDocument(kind: OrderDocKind, o: DocOrder, store: DocStore): string {
  const e = escapeHtml;
  const items = lines(o);
  const cod = o.paymentMethod === 'cod';
  const address = [o.address, o.area, o.district].filter(Boolean).join(', ');

  let body = '';
  if (kind === 'label') {
    body = `
      <div class="big">${e(store.name)}</div>
      <div class="muted">${e(store.phone)}</div>
      <hr/>
      <div class="muted">TO</div>
      <div class="big">${e(o.customerName)}</div>
      <div class="big">${e(o.phone)}</div>
      <div>${e(address)}</div>
      <hr/>
      <div>Order <strong>${e(o.orderNumber)}</strong></div>
      <div>${items.map((i) => `${e(i.qty)} × ${e(i.name)}`).join('<br/>')}</div>
      ${o.consignmentId ? `<div>${e((o.courierPartner || 'Courier').toUpperCase())}: ${e(o.consignmentId)}</div>` : ''}
      ${o.note ? `<div class="muted">Note: ${e(o.note)}</div>` : ''}
      ${cod ? `<div class="cod">COD ${e(bdt(o.totalBdt))}</div>` : '<div class="cod">PREPAID</div>'}
    `;
  } else if (kind === 'packing_slip') {
    body = `
      <h1>Packing slip</h1>
      <div class="muted">${e(store.name)} · Order ${e(o.orderNumber)} · ${e(dateText(o.createdAt))}</div>
      <div class="box"><strong>${e(o.customerName)}</strong> · ${e(o.phone)}<br/>${e(address)}</div>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th>Packed</th></tr></thead>
        <tbody>${items.map((i) => `<tr><td>${e(i.name)}</td><td class="num">${e(i.qty)}</td><td>☐</td></tr>`).join('')}</tbody>
      </table>
      ${o.note ? `<div class="box">Customer note: ${e(o.note)}</div>` : ''}
      ${cod ? `<div class="box total">Collect on delivery: ${e(bdt(o.totalBdt))}</div>` : ''}
    `;
  } else {
    body = `
      <h1>Invoice</h1>
      <div class="muted">${e(store.name)} · ${e(store.phone)}<br/>${e(store.address)}</div>
      <div class="box">
        Invoice for order <strong>${e(o.orderNumber)}</strong> · ${e(dateText(o.createdAt))}<br/>
        <strong>${e(o.customerName)}</strong> · ${e(o.phone)}<br/>${e(address)}
      </div>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th></tr></thead>
        <tbody>${items.map((i) => `<tr><td>${e(i.name)}</td><td class="num">${e(i.qty)}</td></tr>`).join('')}</tbody>
      </table>
      <table>
        <tbody>
          <tr><td>Subtotal</td><td class="num">${e(bdt(o.subtotalBdt))}</td></tr>
          ${o.discountBdt > 0 ? `<tr><td>Discount</td><td class="num">−${e(bdt(o.discountBdt))}</td></tr>` : ''}
          <tr><td>Delivery</td><td class="num">${o.deliveryFeeBdt > 0 ? e(bdt(o.deliveryFeeBdt)) : 'Free'}</td></tr>
          <tr><td class="total">${cod ? 'Total (cash on delivery)' : 'Total'}</td><td class="num total">${e(bdt(o.totalBdt))}</td></tr>
        </tbody>
      </table>
      <p class="muted">${cod ? 'Please pay the amount in cash to the delivery person.' : ''} Thank you for choosing ${e(store.name)}.</p>
    `;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${e(kind)} ${e(o.orderNumber)}</title><style>${BASE_CSS}${kind === 'label' ? LABEL_CSS : ''}</style></head><body>${body}</body></html>`;
}

/** Open a print window with the document. Returns false if the browser blocked the pop-up. */
export function printOrderDocument(html: string): boolean {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.setTimeout(() => w.print(), 300);
  return true;
}
