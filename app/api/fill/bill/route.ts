import { handler } from "@/lib/route";
import { billExists, createBill, status } from "@/lib/qb";
import { kvSet } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const { vendorId, date, billNo, storeId, lines } = await req.json();
  if (await billExists(billNo, vendorId)) throw new Error(`Bill ${billNo} already exists in QuickBooks. Nothing was added.`);
  const bill = await createBill({ vendorId, date, docNumber: billNo, storeId: storeId || undefined, lines });
  const st = await status();
  if (storeId) await kvSet(`laststore:${st.realmId}`, storeId);
  return bill;
});
