export default function Privacy() {
  return (
    <main className="narrow doc">
      <h1>Privacy Policy</h1>
      <p>This Bill Import tool is an internal tool operated by GATP Solutions for its own bookkeeping staff. It is not offered to the public.</p>
      <p><b>What it accesses.</b> With the permission of an authorized QuickBooks user, the tool reads vendor, product, location and bill records and creates vendors, products and bills in the connected QuickBooks Online company.</p>
      <p><b>What it stores.</b> The QuickBooks connection tokens, the connected company name and ID, vendor name mappings, and the last selected store. Uploaded purchase order files are processed in memory and are not stored.</p>
      <p><b>Sharing.</b> Data is not sold or shared with third parties. It is used only to record bills in the connected company.</p>
      <p><b>Disconnecting.</b> A user can disconnect at any time from the tool or from QuickBooks (Settings → Apps), which deletes the stored connection.</p>
      <p><b>Contact.</b> accounting@gatpsolutions.com</p>
    </main>
  );
}
