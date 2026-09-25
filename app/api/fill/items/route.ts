// Creates new products (called in small batches so the page can show progress).
import { handler } from "@/lib/route";
import { createItem, defaultAccounts, listItems, status } from "@/lib/qb";
import { cleanName } from "@/lib/match";
export const maxDuration = 60;

export const POST = handler(async (req: Request) => {
  const { items, asOf } = (await req.json()) as { items: { sku: string; name: string }[]; asOf: string };
  const st = await status();
  const accounts = await defaultAccounts(st.realmId);
  const existing = await listItems(); // re-check right before creating: never create a SKU twice
  const bySku = new Map(existing.filter((i) => i.sku).map((i) => [i.sku.toUpperCase(), i.id]));
  const results: { sku: string; id?: string; error?: string }[] = [];
  for (const it of items) {
    const found = bySku.get(it.sku.toUpperCase());
    if (found) { results.push({ sku: it.sku, id: found }); continue; }
    try {
      const created = await createItem({ name: cleanName(it.name), sku: it.sku, asOf, accounts });
      bySku.set(it.sku.toUpperCase(), created.id);
      results.push({ sku: it.sku, id: created.id });
    } catch (e) {
      results.push({ sku: it.sku, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results };
});
