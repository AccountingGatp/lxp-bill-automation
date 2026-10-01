// Reads a client Purchase Order workbook.
// Columns are found by their HEADER TEXT, not by letter, because the sheets differ
// (e.g. "New Item" is column M in one file and column L in another).
import * as XLSX from "xlsx";
import { normSku } from "./sku";

export type PoLine = {
  row: number;
  fullName: string; // "Gun Metal Z | Fidel's | Flower | 7g"
  shortName: string; // "Gun Metal Z"  (name used for NEW products in QuickBooks)
  sku: string;
  qty: number;
  amount: number;
  markedNew: boolean;
};

export type Po = {
  vendor: string;
  date: string; // YYYY-MM-DD
  billNo: string;
  invoiceAmount: number | null;
  lines: PoLine[];
  total: number;
  skippedNotApproved: number;
  problems: string[]; // stop: must be fixed in the file
  warnings: string[]; // shown, but can continue
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;
const PLACEHOLDER = /^[-—–.\s]*$/;

const LABEL: Record<string, string> = { name: "Product Name", sku: "SKU #", isNew: "New Item", qty: "Act. Qty", amount: "Received Amount" };
const COLS: Record<string, string[]> = {
  name: ["product name"],
  sku: ["sku #", "sku", "sku#"],
  strain: ["strain"],
  isNew: ["new item"],
  status: ["status"],
  qty: ["act. qty", "act qty", "actual qty", "act.qty"],
  rate: ["cost/unit", "cost / unit"],
  amount: ["received amount", "receive amount"],
};

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // US m/d/y
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parsePo(buf: ArrayBuffer): Po {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  let rows: unknown[][] = [];
  let headerRow = -1;
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    const h = r.slice(0, 25).findIndex((row) => row?.some((c) => COLS.sku.includes(norm(c))));
    if (h >= 0) { rows = r; headerRow = h; break; }
  }
  if (headerRow < 0) throw new Error("This file does not look like a purchase order: no column titled “SKU #” was found. Check that you uploaded the right file.");

  // Top block: "Vendor:", "Date:", "Ref #:", "Invoice Amount:" with the value to the right.
  const top: Record<string, unknown> = {};
  for (const row of rows.slice(0, headerRow)) {
    if (!row) continue;
    const label = norm(row[0]).replace(/:$/, "");
    const value = row.slice(1).find((c) => c != null && String(c).trim() !== "");
    if (label) top[label] = value;
  }

  const header = rows[headerRow].map(norm);
  const col: Record<string, number> = {};
  for (const [k, alts] of Object.entries(COLS)) col[k] = header.findIndex((h) => alts.includes(h));

  const problems: string[] = [];
  const warnings: string[] = [];
  for (const k of ["name", "sku", "isNew", "qty", "amount"])
    if (col[k] < 0) problems.push(`The file has no “${LABEL[k]}” column. Check the column titles in the header row (row ${headerRow + 1}).`);

  const vendor = String(top["vendor"] ?? "").trim();
  const date = toDate(top["date"]);
  const billNo = String(top["ref #"] ?? top["ref#"] ?? top["ref"] ?? "").trim();
  const invoiceAmount = toNum(top["invoice amount"]);
  if (!vendor) problems.push("Vendor name is empty. Fill in the cell next to “Vendor:” at the top of the file.");
  if (!date) problems.push("Bill date is missing or not a valid date. Fill in the cell next to “Date:” at the top of the file.");
  if (!billNo) problems.push("Bill number is empty. Fill in the cell next to “Ref #:” at the top of the file.");
  if (invoiceAmount == null)
    problems.push("Invoice Amount is missing at the top of the file (cell next to “Invoice Amount:”). Add it and upload the file again.");

  const lines: PoLine[] = [];
  let skipped = 0;
  let skippedAmount = 0;
  if (!problems.length) {
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const sku = String(row[col.sku] ?? "").trim();
      if (!sku || PLACEHOLDER.test(sku)) continue;
      const fullName = String(row[col.name] ?? "").trim();
      const strain = col.strain >= 0 ? String(row[col.strain] ?? "").trim() : "";
      const shortName = strain || fullName.split("|")[0].trim();
      const qty = toNum(row[col.qty]);
      const rate = col.rate >= 0 ? toNum(row[col.rate]) : null;
      let amount = toNum(row[col.amount]);
      if (amount == null && qty != null && rate != null) amount = qty * rate;
      const excelRow = r + 1;
      if (!qty || qty <= 0) { problems.push(`Row ${excelRow} (SKU ${sku}): “Act. Qty” is empty or 0. Enter the received quantity.`); continue; }
      if (amount == null || amount === 0) { warnings.push(`Row ${excelRow} (SKU ${sku}) has no cost / amount, so it is not added to the bill.`); continue; }
      if (!shortName) { problems.push(`Row ${excelRow} (SKU ${sku}): “Product Name” is empty.`); continue; }
      lines.push({ row: excelRow, fullName, shortName, sku, qty, amount: round2(amount), markedNew: norm(row[col.isNew]) === "yes" });
    }
    if (!lines.length) problems.push("No product lines found. Each line needs a SKU, a quantity and an amount.");
  }

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  // Bill is only allowed when the lines add up exactly to the Invoice Amount at the top of the file.
  if (lines.length && invoiceAmount != null && Math.abs(total - invoiceAmount) >= 0.01) {
    const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    problems.push(
      `Amounts do not match: the lines add up to ${usd(total)}, but Invoice Amount is ${usd(invoiceAmount)} ` +
      `(difference ${usd(Math.abs(total - invoiceAmount))}). Nothing was added to QuickBooks. Correct the file and upload it again.`
    );
  }
  const dup = lines.map((l) => normSku(l.sku)).filter((s, i, a) => a.indexOf(s) !== i);
  if (dup.length) warnings.push(`The same SKU appears on more than one line: ${[...new Set(dup)].join(", ")}. Each line will be added to the bill; check this is correct.`);

  return { vendor, date: date || "", billNo, invoiceAmount, lines, total, skippedNotApproved: skipped, problems, warnings };
}

// As-of date for new products: 1st of the bill's month.
// If the bill is dated ON the 1st, use the last day of the previous month (must be before the bill date).
export function asOfDate(billDate: string) {
  const [y, m, d] = billDate.split("-").map(Number);
  if (d > 1) return `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m - 1, 0));
  return last.toISOString().slice(0, 10);
}
