// ============================================================
// Vendor monthly report parsing (server-side).
// TS port of scripts/import-vendor-report.mjs — used by api/import-vendor-report.ts
// so uploads from the Commission page parse identically to the CLI importer.
// ============================================================
import * as XLSX from 'xlsx';

export type VendorCode = 'virgin' | 'jashanmal' | 'hamleys';

export interface VendorLine {
  vendor: VendorCode;
  report_month: string | null;
  date: string;
  vendor_store_id: string;
  store_code: string | null;
  item_description: string;
  item_code: string;
  sku: string | null;
  upc: string | null;
  quantity: number;
  selling_price: number;
  total_value: number;
  trans_type: 'sale' | 'return';
  receipt_no: string | null;
  sales_rep?: string | null;
  vendor_commission_pct?: number | null;
  vendor_commission_amt?: number | null;
  raw_data: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const COLOUR_MAP: Record<string, string> = {
  BLACK: 'BK', SILVER: 'SLV', PINK: 'PK', BLUE: 'BLU',
  WHITE: 'WH', RED: 'RD', GREEN: 'GN', GREY: 'GRY', GRAY: 'GRY',
};
const MODELS = ['SE3SL', 'SE3MINIT', 'SE3S', 'SQ3S', 'SQ3', 'SR5', 'SR6', 'SE3T'];

export function normalizeSku(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const upper = String(desc).toUpperCase();
  let model: string | null = null;
  for (const m of MODELS) { if (upper.includes(m)) { model = m; break; } }
  if (!model) return null;
  let colour: string | null = null;
  for (const [c, abbr] of Object.entries(COLOUR_MAP)) { if (upper.includes(c)) { colour = abbr; break; } }
  return model + (colour ? '_' + colour : '');
}

export function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const s = String(val).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

const reportMonth = (dateStr: string | null) => (dateStr ? dateStr.slice(0, 7) : null);

function parseVirgin(wb: XLSX.WorkBook, storeMap: Record<string, string>): VendorLine[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet);
  const lines: VendorLine[] = [];
  for (const row of rows) {
    const date = parseDate(row['SalesDate']);
    if (!date) continue;
    const vendorStoreId = String(row['Store'] || '').trim();
    const qty = Number(row['Qty'] || 0);
    const price = Number(row['Virgin Selling Price Value'] || 0);
    lines.push({
      vendor: 'virgin', report_month: reportMonth(date), date,
      vendor_store_id: vendorStoreId, store_code: storeMap[vendorStoreId] || null,
      item_description: String(row['Item Description'] || ''), item_code: String(row['UPC'] || ''),
      sku: normalizeSku(String(row['Item Description'] || '')), upc: String(row['UPC'] || ''),
      quantity: qty, selling_price: qty !== 0 ? Math.abs(price / qty) : price, total_value: price,
      trans_type: qty < 0 ? 'return' : 'sale', receipt_no: null, raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

function parseJashanmal(wb: XLSX.WorkBook, storeMap: Record<string, string>): VendorLine[] {
  const sheet = wb.Sheets['Item Wise Sale'];
  if (!sheet) throw new Error('Sheet "Item Wise Sale" not found');
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { range: 1 });
  const lines: VendorLine[] = [];
  for (const row of rows) {
    const date = parseDate(row['Transaction Date']);
    if (!date) continue;
    const storeName = String(row['Store Name'] || '').trim();
    const qty = Number(row['Qty'] || 0);
    const saleValue = Number(row['Sale Value'] || 0);
    const transType = String(row['Trans Type'] || '').toUpperCase();
    lines.push({
      vendor: 'jashanmal', report_month: reportMonth(date), date,
      vendor_store_id: storeName, store_code: storeMap[storeName] || null,
      item_description: String(row['Item Desc'] || ''), item_code: String(row['Item Code/Line'] || ''),
      sku: normalizeSku(String(row['Item Desc'] || '')), upc: String(row['Barcode'] || row['User Barcode'] || ''),
      quantity: qty, selling_price: qty !== 0 ? Math.abs(saleValue / qty) : Math.abs(saleValue), total_value: saleValue,
      trans_type: transType === 'RETURN' ? 'return' : 'sale',
      sales_rep: String(row['Sales Rep '] || row['Sales Rep'] || '').trim() || null,
      receipt_no: String(row['Transaction No'] || '').trim() || null, raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

function parseHamleys(wb: XLSX.WorkBook, storeMap: Record<string, string>): VendorLine[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet);
  const lines: VendorLine[] = [];
  for (const row of rows) {
    const date = parseDate(row['Date']);
    if (!date) continue;
    const vendorStoreId = String(row['Store No_'] || '').trim();
    const qty = Number(row['Quantity'] || 0);
    const price = Number(row['Vendor Retail Price Ex_ VAT'] || row['Vendor Retail Price Ex. VAT'] || 0);
    const commPct = Number(row['Commission %'] || 0);
    const commAmt = Number(row['Commission'] || 0);
    lines.push({
      vendor: 'hamleys', report_month: reportMonth(date), date,
      vendor_store_id: vendorStoreId, store_code: storeMap[vendorStoreId] || null,
      item_description: String(row['Item Description'] || ''), item_code: String(row['Item No_'] || ''),
      sku: normalizeSku(String(row['Item Description'] || '')), upc: null,
      quantity: qty, selling_price: price, total_value: qty * price,
      trans_type: qty < 0 ? 'return' : 'sale', receipt_no: String(row['Receipt No_'] || '').trim() || null,
      vendor_commission_pct: commPct || null, vendor_commission_amt: commAmt || null, raw_data: JSON.stringify(row),
    });
  }
  return lines;
}

const PARSERS: Record<VendorCode, (wb: XLSX.WorkBook, m: Record<string, string>) => VendorLine[]> = {
  virgin: parseVirgin, jashanmal: parseJashanmal, hamleys: parseHamleys,
};

export function isVendor(v: string): v is VendorCode {
  return v === 'virgin' || v === 'jashanmal' || v === 'hamleys';
}

/** Parse an uploaded vendor report file buffer into normalized lines. */
export function parseVendorReport(buffer: Buffer, vendor: VendorCode, storeMap: Record<string, string>): VendorLine[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return PARSERS[vendor](wb, storeMap);
}
