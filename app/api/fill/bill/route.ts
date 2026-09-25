import { handler } from "@/lib/route";
import { billExists, createBill, status } from "@/lib/qb";
import { kvDel, kvLock, kvSet } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const { vendorId, date, billNo, storeId, lines } = await req.json();
  if (lines.some((l: { itemId?: string }) => !l.itemId)) throw new Error("Some lines have no product. Nothing was added.");
  const st = await status();
  const lock = `lock:bill:${st.realmId}:${String(billNo).toLowerCase()}`;
  if (!(await kvLock(lock))) throw new Error(`Bill ${billNo} is being created right now (another tab or person). Nothing was added.`);
  try {
    if (await billExists(billNo, vendorId)) throw new Error(`Bill ${billNo} already exists in QuickBooks. Nothing was added.`);
    const bill = await createBill({ vendorId, date, docNumber: billNo, storeId: storeId || undefined, lines });
    if (storeId) await kvSet(`laststore:${st.realmId}`, storeId);
    return bill;
  } finally {
    await kvDel(lock).catch(() => {});
  }
});
