// Step 3: check every SKU against QuickBooks + make sure this bill isn't already entered.
import { handler } from "@/lib/route";
import { checkSkus } from "@/lib/match";
import { asOfDate, type Po } from "@/lib/po";
import { billExists, listItems } from "@/lib/qb";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const { po, vendorId } = (await req.json()) as { po: Po; vendorId: string | null };
  const [items, dup] = await Promise.all([listItems(), billExists(po.billNo, vendorId || undefined)]);
  return {
    skus: checkSkus(po.lines, items),
    asOf: asOfDate(po.date),
    duplicateBill: dup,
  };
});
