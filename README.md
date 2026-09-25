# Bill Import (PO file → QuickBooks Online bill)

Upload a client PO Excel file → map the vendor → check SKUs → **Fill data to QuickBooks**.
The tool creates the vendor (if chosen), any new SKUs (qty 0, as-of date = 1st of the bill's month, non-taxable), then the bill.

## What it does
| Step | What happens |
|---|---|
| 1 Upload | Reads Vendor, Date, Ref # (bill no.), Invoice Amount, and the lines. Only rows with Status = **Approved**. Qty = **Act. Qty**. Columns are found by header name. Stops if the line total ≠ Invoice Amount. |
| 2 Vendor | Uses a saved mapping, else an exact name match, else the user picks from a dropdown or adds a new vendor. Choice is remembered. Store dropdown remembers the last store. |
| 3 Check | Looks up **every** SKU in QuickBooks (even ones marked "No"). New products are named with the short name (e.g. "Gun Metal Z"); if that name is taken, it suggests "Gun Metal Z 7g" (editable). Blocks if the bill number already exists. |
| 4 Fill | Creates vendor → new products (re-checked right before creating, so no duplicate SKUs) → bill (due date = bill date, lines under Item details). Safe to retry. |

## Deploy on Vercel
1. Import this GitHub repo in Vercel.
2. **Storage** tab → add **Upstash (Redis)** → connect to the project (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. **Settings → Environment Variables** (see `.env.example`):
   - `APP_PASSWORD` – the team password for this site
   - `SESSION_SECRET` – any long random text (32+ characters)
   - `QB_CLIENT_ID`, `QB_CLIENT_SECRET` – Intuit app → Keys & credentials (**Development** for testing)
   - `QB_ENVIRONMENT` – `sandbox` for the test company, `production` for real companies
   - `QB_REDIRECT_URI` – `https://<your-app>.vercel.app/api/qb/callback`
4. In the Intuit app → Redirect URIs → add exactly the same `QB_REDIRECT_URI`.
5. Redeploy, open the site, log in, click **Connect to QuickBooks**, pick the test company.

## Going live (LXP)
1. Intuit app → Production tab → finish the checklist. Privacy policy: `https://<your-app>.vercel.app/privacy`, Terms: `/terms`, Host domain / Launch URL: `https://<your-app>.vercel.app`, Disconnect URL: `https://<your-app>.vercel.app`.
2. Add the same Redirect URI under **Production**.
3. In Vercel: replace `QB_CLIENT_ID` / `QB_CLIENT_SECRET` with the production keys, set `QB_ENVIRONMENT=production`, redeploy.
4. On the site: **Connect to QuickBooks** → log in with the login that has LXP → pick **LXP Enterprises, LLC**.
To switch company later: **Disconnect** → **Connect** → pick the other company.

## Run locally
```
npm install
cp .env.example .env.local   # fill values; or set QB_MOCK=1 to try with fake data
npm run dev                  # http://localhost:8000
```
