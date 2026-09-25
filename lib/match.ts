// Vendor matching + SKU check logic (pure functions, no QuickBooks calls).
import type { Item, Vendor } from "./qb";
import type { PoLine } from "./po";

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(key(s).split(" ").filter((w) => w.length > 1));

/** Exact (ignoring case/punctuation) match, else null. Plus a ranked list of likely vendors for the dropdown. */
export function matchVendor(fileVendor: string, vendors: Vendor[]) {
  const exact = vendors.find((v) => key(v.name) === key(fileVendor)) || null;
  const fw = words(fileVendor);
  const scored = vendors
    .map((v) => ({ v, s: [...words(v.name)].filter((w) => fw.has(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.v);
  return { exact, suggestions: scored };
}

// QuickBooks product names: max 100 chars, no ":" (it means sub-item).
export const cleanName = (s: string) => s.replace(/:/g, "-").replace(/\s+/g, " ").trim().slice(0, 100);

import { normSku } from "./sku";
export { normSku };

export type SkuResult = {
  sku: string;
  shortName: string;
  fullName: string;
  // exists = use it · new/flag = will be created (flag: file said "No") · inactive = blocked, must be reactivated in QuickBooks
  status: "exists" | "new" | "flag" | "inactive";
  itemId?: string;
  existingName?: string;
  dupInQb?: number; // how many QuickBooks products already share this SKU (>1 = existing duplicate)
  existingType?: string; // QuickBooks type of the matched product (Inventory, NonInventory, Service)
  proposedName?: string;
  nameChanged?: boolean;
};

export function checkSkus(lines: PoLine[], items: Item[]): SkuResult[] {
  // Group ALL QuickBooks products (active + inactive) by SKU.
  const bySku = new Map<string, Item[]>();
  for (const i of items) {
    if (!i.sku) continue;
    const k = normSku(i.sku);
    bySku.set(k, [...(bySku.get(k) || []), i]);
  }
  const taken = new Set(items.map((i) => i.name.toLowerCase()));
  const seen = new Map<string, SkuResult>();

  for (const l of lines) {
    const k = normSku(l.sku);
    if (seen.has(k)) continue;
    const found = bySku.get(k);
    if (found?.length) {
      const active = found.filter((i) => i.active).sort((a, b) => Number(a.id) - Number(b.id));
      const base = { sku: l.sku, shortName: l.shortName, fullName: l.fullName, dupInQb: found.length };
      if (active.length) seen.set(k, { ...base, status: "exists", itemId: active[0].id, existingName: active[0].name, existingType: active[0].type });
      else seen.set(k, { ...base, status: "inactive", existingName: found[0].name });
      continue;
    }
    // New product: use the full name ("Gun Metal Z | Fidel's | Flower | 7g"), like existing QuickBooks items.
    // If that exact name is already used by another product, add the SKU so it stays unique.
    const base = cleanName(l.fullName || l.shortName);
    const candidates = [base, cleanName(`${base} - ${l.sku}`)];
    const name = candidates.find((c) => !taken.has(c.toLowerCase())) || cleanName(`${base} - ${l.sku} - 2`);
    taken.add(name.toLowerCase());
    seen.set(k, {
      sku: l.sku, shortName: l.shortName, fullName: l.fullName,
      status: l.markedNew ? "new" : "flag",
      proposedName: name, nameChanged: name !== base,
    });
  }
  return [...seen.values()];
}
