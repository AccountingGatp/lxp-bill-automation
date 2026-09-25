import { handler } from "@/lib/route";
import { createVendor, listVendors, status } from "@/lib/qb";
import { kvSet } from "@/lib/store";

export const POST = handler(async (req: Request) => {
  const { fileVendor, vendorId, newName } = await req.json();
  const st = await status();
  let id = vendorId as string | null;
  if (!id) {
    const name = String(newName || "").trim();
    if (!name) throw new Error("Enter a name for the new vendor.");
    const existing = (await listVendors()).find((v) => v.name.toLowerCase() === name.toLowerCase());
    id = existing ? existing.id : (await createVendor(name)).id;
  }
  await kvSet(`vendormap:${st.realmId}:${String(fileVendor).toLowerCase()}`, id); // remember for next time
  return { vendorId: id };
});
