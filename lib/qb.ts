// QuickBooks Online connection + the few API calls this tool needs.
// QB_MOCK=1 swaps in a fake QuickBooks (stored locally) so the screens can be tried without keys.
import { kvDel, kvGet, kvSet } from "./store";

export const MOCK = process.env.QB_MOCK === "1";
export const ENV: "sandbox" | "production" =
  process.env.QB_ENVIRONMENT === "production" ? "production" : "sandbox";
const API_BASE =
  ENV === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
const APP_BASE = ENV === "production" ? "https://app.qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const MINOR = "75";
const CONN_KEY = `qb:conn:${MOCK ? "mock" : ENV}`;

type Conn = {
  realmId: string;
  companyName: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export type Vendor = { id: string; name: string };
export type Store = { id: string; name: string };
export type Item = { id: string; name: string; sku: string; type: string };
export type Accounts = { income: string; expense: string; asset: string };

// ---------------------------------------------------------------- OAuth
function basicAuth() {
  const id = process.env.QB_CLIENT_ID, secret = process.env.QB_CLIENT_SECRET;
  if (!id || !secret) throw new Error("QB_CLIENT_ID / QB_CLIENT_SECRET are not set.");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID || "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: process.env.QB_REDIRECT_URI || "",
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`QuickBooks login failed: ${j.error_description || j.error || r.status}`);
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

export async function finishConnect(code: string, realmId: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: process.env.QB_REDIRECT_URI || "" });
  const conn: Conn = {
    realmId, companyName: "", access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  await kvSet(CONN_KEY, conn);
  const info = await api(`companyinfo/${realmId}`);
  conn.companyName = info.CompanyInfo?.CompanyName || "QuickBooks company";
  await kvSet(CONN_KEY, conn);
}

export async function disconnect() {
  if (!MOCK) {
    const conn = await kvGet<Conn>(CONN_KEY);
    if (conn)
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { Authorization: basicAuth(), Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ token: conn.refresh_token }),
      }).catch(() => {});
  }
  await kvDel(CONN_KEY);
}

export async function status() {
  const conn = await kvGet<Conn>(CONN_KEY);
  return {
    connected: !!conn,
    companyName: conn?.companyName || "",
    realmId: conn?.realmId || "",
    environment: MOCK ? "demo" : ENV,
  };
}

export async function mockConnect() {
  await kvSet(CONN_KEY, { realmId: "mock", companyName: "Demo Company (fake data)", access_token: "", refresh_token: "", expires_at: 0 });
}

async function conn(): Promise<Conn> {
  const c = await kvGet<Conn>(CONN_KEY);
  if (!c) throw new Error("QuickBooks is not connected. Click “Connect to QuickBooks”.");
  if (!MOCK && c.expires_at - 60_000 < Date.now()) {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refresh_token }).catch(async (e) => {
      await kvDel(CONN_KEY);
      throw new Error("QuickBooks connection expired. Please connect again. (" + e.message + ")");
    });
    c.access_token = t.access_token;
    c.refresh_token = t.refresh_token; // Intuit rotates refresh tokens: always keep the newest
    c.expires_at = Date.now() + t.expires_in * 1000;
    await kvSet(CONN_KEY, c);
  }
  return c;
}

// ---------------------------------------------------------------- raw API
async function api(path: string, body?: unknown): Promise<any> {
  const c = await conn();
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${API_BASE}/v3/company/${c.realmId}/${path}${sep}minorversion=${MINOR}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${c.access_token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.Fault) {
    const e = j.Fault?.Error?.[0];
    throw new Error(e ? `${e.Message}${e.Detail ? ": " + e.Detail : ""}` : `QuickBooks error ${r.status}`);
  }
  return j;
}

async function queryAll(entity: string, where = ""): Promise<any[]> {
  const out: any[] = [];
  for (let start = 1; ; start += 1000) {
    const q = `select * from ${entity} ${where} startposition ${start} maxresults 1000`;
    const j = await api(`query?query=${encodeURIComponent(q)}`);
    const rows = j.QueryResponse?.[entity] || [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// ---------------------------------------------------------------- mock db
type MockDb = { vendors: Vendor[]; items: Item[]; stores: Store[]; bills: { id: string; docNumber: string }[]; n: number };
async function mdb(): Promise<MockDb> {
  const db = await kvGet<MockDb>("mock:db");
  if (db) return db;
  const fresh: MockDb = {
    vendors: [
      { id: "1", name: "GNB, Serge, Fidels" }, { id: "2", name: "Clubhouse Flower" },
      { id: "3", name: "Coldfire Extracts" }, { id: "4", name: "Gas No Brakes" },
    ],
    items: [
      { id: "101", name: "Tzunami", sku: "FID-FLWR-TNM-7G", type: "Inventory" },
      { id: "102", name: "Grape Sunshine", sku: "DBXHSN-6SWH-GSS-1G", type: "Inventory" },
      { id: "103", name: "Lemon Cooler", sku: "SRGXHSN-6SWH-LMNC-1G", type: "Inventory" },
      { id: "104", name: "Mangosteen", sku: "OTHER-MANGOST-14G", type: "Inventory" },
    ],
    stores: [{ id: "1", name: "Clubhouse" }, { id: "2", name: "Main Warehouse" }],
    bills: [], n: 1000,
  };
  await kvSet("mock:db", fresh);
  return fresh;
}

// ---------------------------------------------------------------- operations
export async function listVendors(): Promise<Vendor[]> {
  if (MOCK) return (await mdb()).vendors;
  return (await queryAll("Vendor", "where Active = true")).map((v) => ({ id: v.Id, name: v.DisplayName }));
}

export async function createVendor(name: string): Promise<Vendor> {
  if (MOCK) {
    const db = await mdb();
    const v = { id: String(++db.n), name };
    db.vendors.push(v);
    await kvSet("mock:db", db);
    return v;
  }
  const j = await api("vendor", { DisplayName: name.replace(/:/g, "-").slice(0, 500) });
  return { id: j.Vendor.Id, name: j.Vendor.DisplayName };
}

export async function listStores(): Promise<Store[]> {
  if (MOCK) return (await mdb()).stores;
  // "Store" on the bill = QuickBooks Location, called Department in the API.
  try {
    return (await queryAll("Department", "where Active = true")).map((d) => ({ id: d.Id, name: d.FullyQualifiedName || d.Name }));
  } catch {
    return []; // location tracking turned off
  }
}

export async function listItems(): Promise<Item[]> {
  if (MOCK) return (await mdb()).items;
  return (await queryAll("Item")).map((i) => ({ id: i.Id, name: i.Name, sku: i.Sku || "", type: i.Type }));
}

export async function billExists(docNumber: string, vendorId?: string): Promise<boolean> {
  if (MOCK) return (await mdb()).bills.some((b) => b.docNumber === docNumber);
  const rows = await queryAll("Bill", `where DocNumber = '${esc(docNumber)}'`);
  return rows.some((b) => !vendorId || b.VendorRef?.value === vendorId);
}

// The 3 accounts QuickBooks fills in automatically when you add an item by hand.
// Through the API we must send them, so we copy the most common set used by existing inventory items.
export async function defaultAccounts(realmId: string): Promise<Accounts> {
  if (MOCK) return { income: "1", expense: "2", asset: "3" };
  const key = `qb:accounts:${ENV}:${realmId}`;
  const cached = await kvGet<Accounts>(key);
  if (cached) return cached;
  const inv = await queryAll("Item", "where Type = 'Inventory'");
  const count = new Map<string, number>();
  for (const i of inv) {
    const k = [i.IncomeAccountRef?.value, i.ExpenseAccountRef?.value, i.AssetAccountRef?.value].join("|");
    if (!k.includes("undefined")) count.set(k, (count.get(k) || 0) + 1);
  }
  let best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) {
    const accts = await queryAll("Account", "where Active = true");
    const find = (sub: string) => accts.find((a) => a.AccountSubType === sub)?.Id;
    const a = { income: find("SalesOfProductIncome"), expense: find("SuppliesMaterialsCogs"), asset: find("Inventory") };
    if (!a.income || !a.expense || !a.asset) throw new Error("Could not find the default inventory accounts in QuickBooks.");
    best = [a.income, a.expense, a.asset].join("|");
  }
  const [income, expense, asset] = best.split("|");
  const out = { income, expense, asset };
  await kvSet(key, out);
  return out;
}

export async function createItem(p: { name: string; sku: string; asOf: string; accounts: Accounts }): Promise<Item> {
  if (MOCK) {
    const db = await mdb();
    if (db.items.some((i) => i.name.toLowerCase() === p.name.toLowerCase()))
      throw new Error(`Duplicate Name Exists Error: The name "${p.name}" is already used.`);
    const it = { id: String(++db.n), name: p.name, sku: p.sku, type: "Inventory" };
    db.items.push(it);
    await kvSet("mock:db", db);
    return it;
  }
  const j = await api("item", {
    Name: p.name,
    Sku: p.sku,
    Type: "Inventory",
    TrackQtyOnHand: true,
    QtyOnHand: 0,
    InvStartDate: p.asOf,
    Taxable: false,
    IncomeAccountRef: { value: p.accounts.income },
    ExpenseAccountRef: { value: p.accounts.expense },
    AssetAccountRef: { value: p.accounts.asset },
  });
  return { id: j.Item.Id, name: j.Item.Name, sku: j.Item.Sku || "", type: j.Item.Type };
}

export type BillLine = { itemId: string; qty: number; amount: number; description: string };
export async function createBill(p: {
  vendorId: string; date: string; docNumber: string; storeId?: string; lines: BillLine[];
}): Promise<{ id: string; url: string }> {
  if (MOCK) {
    const db = await mdb();
    const id = String(++db.n);
    db.bills.push({ id, docNumber: p.docNumber });
    await kvSet("mock:db", db);
    return { id, url: "" };
  }
  const j = await api("bill", {
    VendorRef: { value: p.vendorId },
    TxnDate: p.date,
    DueDate: p.date, // rule: due date = bill date
    DocNumber: p.docNumber,
    ...(p.storeId ? { DepartmentRef: { value: p.storeId } } : {}),
    Line: p.lines.map((l) => ({
      DetailType: "ItemBasedExpenseLineDetail",
      Amount: l.amount,
      Description: l.description,
      ItemBasedExpenseLineDetail: {
        ItemRef: { value: l.itemId },
        Qty: l.qty,
        UnitPrice: Math.round((l.amount / l.qty) * 1e5) / 1e5, // QBO works out cost/unit from qty + amount
      },
    })),
  });
  return { id: j.Bill.Id, url: `${APP_BASE}/app/bill?txnId=${j.Bill.Id}` };
}
