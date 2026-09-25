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
    // New product: prefer the short name ("Gun Metal Z"); if taken, add size, then brand, then full name.
    const parts = l.fullName.split("|").map((p) => p.trim()).filter(Boolean);
    const size = parts.length > 1 ? parts[parts.length - 1] : "";
    const brand = parts.length > 2 ? parts[1] : "";
    const candidates = [l.shortName, `${l.shortName} ${size}`, `${l.shortName} ${brand} ${size}`, l.fullName, `${l.shortName} ${l.sku}`]
      .map(cleanName)
      .filter(Boolean);
    const name = candidates.find((c) => !taken.has(c.toLowerCase())) || cleanName(`${l.shortName} ${l.sku}`);
    taken.add(name.toLowerCase());
    seen.set(k, {
      sku: l.sku, shortName: l.shortName, fullName: l.fullName,
      status: l.markedNew ? "new" : "flag",
      proposedName: name, nameChanged: name !== cleanName(l.shortName),
    });
  }
  return [...seen.values()];
}
