import { handler } from "@/lib/route";
import { createVendor, findVendorByName, status } from "@/lib/qb";
import { kvSet } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const { fileVendor, vendorId, newName } = await req.json();
  const st = await status();
  let id = vendorId as string | null;
  if (!id) {
    const name = String(newName || "").trim();
    if (!name) throw new Error("Enter a name for the new vendor.");
    const existing = await findVendorByName(name);
    if (existing && !existing.active)
      throw new Error(`Vendor “${existing.name}” already exists in QuickBooks but is INACTIVE. Make it active (Expenses → Vendors → filter Inactive → Make active), then click Try again.`);
    id = existing ? existing.id : (await createVendor(name)).id;
  }
  await kvSet(`vendormap:${st.realmId}:${String(fileVendor).toLowerCase()}`, id); // remember for next time
  return { vendorId: id };
});
