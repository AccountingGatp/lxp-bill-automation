import { handler } from "@/lib/route";
import { billExists, createBill, status } from "@/lib/qb";
import { kvDel, kvLock, kvSet } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const { vendorId, date, billNo, storeId, lines } = await req.json();
  if (lines.some((l: { itemId?: string }) => !l.itemId)) throw new Error("Some lines could not be linked to a product. Nothing was added. Click “Back to check” and try again.");
  const st = await status();
  const lock = `lock:bill:${st.realmId}:${String(billNo).toLowerCase()}`;
  if (!(await kvLock(lock))) throw new Error(`Bill ${billNo} is being created right now by someone else (or another tab). Nothing was added. Wait a minute and check QuickBooks.`);
  try {
    if (await billExists(billNo, vendorId)) throw new Error(`Bill ${billNo} already exists in QuickBooks for this vendor, so it was not added again.`);
    const bill = await createBill({ vendorId, date, docNumber: billNo, storeId: storeId || undefined, lines });
    if (storeId) await kvSet(`laststore:${st.realmId}`, storeId);
    return bill;
  } finally {
    await kvDel(lock).catch(() => {});
  }
});
