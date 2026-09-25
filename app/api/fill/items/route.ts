// Creates new products (called in small batches so the page can show progress).
// Duplicate-SKU protection, in order:
//  1. lock each SKU for 2 minutes, so two people/tabs can never create the same SKU at the same moment
//  2. re-read ALL QuickBooks products (active + inactive) right before creating
//  3. if the SKU now exists -> reuse it (active) or stop (inactive); only create when truly absent
import { handler } from "@/lib/route";
import { createItem, defaultAccounts, listItems, status } from "@/lib/qb";
import { cleanName } from "@/lib/match";
import { normSku } from "@/lib/sku";
import { kvDel, kvLock } from "@/lib/store";
export const maxDuration = 60;

export const POST = handler(async (req: Request) => {
  const { items, asOf } = (await req.json()) as { items: { sku: string; name: string }[]; asOf: string };
  const st = await status();
  const results: { sku: string; id?: string; error?: string }[] = [];
  const locks: string[] = [];
  try {
    const mine: { sku: string; name: string }[] = [];
    for (const it of items) {
      const key = `lock:sku:${st.realmId}:${normSku(it.sku)}`;
      if (await kvLock(key)) { locks.push(key); mine.push(it); }
      else results.push({ sku: it.sku, error: "This SKU is being created by someone else right now. Wait a minute and click Try again." });
    }
    if (!mine.length) return { results };

    const accounts = await defaultAccounts(st.realmId);
    const existing = await listItems();
    const bySku = new Map<string, { id: string; active: boolean; name: string }>();
    for (const i of existing.filter((i) => i.sku).sort((a, b) => Number(b.active) - Number(a.active) || Number(a.id) - Number(b.id)))
      if (!bySku.has(normSku(i.sku))) bySku.set(normSku(i.sku), i);

    for (const it of mine) {
      const k = normSku(it.sku);
      const found = bySku.get(k);
      if (found?.active) { results.push({ sku: it.sku, id: found.id }); continue; }
      if (found) { results.push({ sku: it.sku, error: `SKU already exists as INACTIVE product “${found.name}”. Make it active in QuickBooks, then Try again.` }); continue; }
      try {
        const created = await createItem({ name: cleanName(it.name), sku: it.sku.trim(), asOf, accounts });
        bySku.set(k, { id: created.id, active: true, name: created.name });
        results.push({ sku: it.sku, id: created.id });
      } catch (e) {
        results.push({ sku: it.sku, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results };
  } finally {
    for (const k of locks) await kvDel(k).catch(() => {});
  }
});
