// Renames existing QuickBooks products when the user chose "Change the QuickBooks name".
import { handler } from "@/lib/route";
import { renameItem } from "@/lib/qb";
import { cleanName } from "@/lib/match";

export const POST = handler(async (req: Request) => {
  const { items } = (await req.json()) as { items: { itemId: string; sku: string; name: string }[] };
  const results: { sku: string; ok?: boolean; error?: string }[] = [];
  for (const it of items) {
    const name = cleanName(it.name);
    try {
      if (!name) throw new Error("The new name is empty.");
      await renameItem(it.itemId, name);
      results.push({ sku: it.sku, ok: true });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      results.push({
        sku: it.sku,
        error: /duplicate name/i.test(m)
          ? `The name “${name}” is already used by another product in QuickBooks. Choose a different name, or keep the QuickBooks name.`
          : m,
      });
    }
  }
  return { results };
});
