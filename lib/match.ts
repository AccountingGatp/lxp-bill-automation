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

export type SkuResult = {
  sku: string;
  shortName: string;
  fullName: string;
  status: "exists" | "new" | "flag"; // flag = file says "No" but not found in QuickBooks
  itemId?: string;
  existingName?: string;
  proposedName?: string; // for new ones
  nameChanged?: boolean; // short name already taken -> we suggest another
};

export function checkSkus(lines: PoLine[], items: Item[]): SkuResult[] {
  const bySku = new Map<string, Item>();
  for (const i of items) if (i.sku) bySku.set(i.sku.trim().toUpperCase(), i);
  const taken = new Set(items.map((i) => i.name.toLowerCase()));
  const seen = new Map<string, SkuResult>();

  for (const l of lines) {
    const k = l.sku.toUpperCase();
    if (seen.has(k)) continue;
    const found = bySku.get(k);
    if (found) {
      seen.set(k, { sku: l.sku, shortName: l.shortName, fullName: l.fullName, status: "exists", itemId: found.id, existingName: found.name });
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
