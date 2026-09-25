// Step 1: read the uploaded PO file + find the vendor in QuickBooks.
import { handler } from "@/lib/route";
import { parsePo } from "@/lib/po";
import { matchVendor } from "@/lib/match";
import { listStores, listVendors, status } from "@/lib/qb";
import { kvGet } from "@/lib/store";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("No file received.");
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw new Error("Please upload an Excel file (.xlsx).");
  const po = parsePo(await file.arrayBuffer());
  if (po.problems.length) return { po };

  const st = await status();
  if (!st.connected) throw new Error("QuickBooks is not connected.");
  const [vendors, stores] = await Promise.all([listVendors(), listStores()]);

  // 1) a mapping saved earlier wins, 2) else exact name match, 3) else user picks.
  const saved = await kvGet<string>(`vendormap:${st.realmId}:${po.vendor.toLowerCase()}`);
  const savedVendor = saved ? vendors.find((v) => v.id === saved) : undefined;
  const { exact, suggestions } = matchVendor(po.vendor, vendors);
  const matched = savedVendor || exact;
  const lastStore = await kvGet<string>(`laststore:${st.realmId}`);

  return {
    po,
    vendor: { matchedId: matched?.id || null, how: savedVendor ? "saved" : exact ? "name" : null, suggestions, all: vendors },
    stores,
    storeId: stores.find((s) => s.id === lastStore)?.id || stores[0]?.id || null,
  };
});
