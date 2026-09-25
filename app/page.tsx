"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Line = { row: number; fullName: string; shortName: string; sku: string; qty: number; amount: number; markedNew: boolean };
type Po = { vendor: string; date: string; billNo: string; invoiceAmount: number | null; lines: Line[]; total: number; problems: string[]; warnings: string[] };
type Opt = { id: string; name: string };
type ReadRes = { po: Po; vendor?: { matchedId: string | null; how: string | null; suggestions: Opt[]; all: Opt[] }; stores?: Opt[]; storeId?: string | null };
type Sku = { sku: string; shortName: string; fullName: string; status: "exists" | "new" | "flag"; itemId?: string; existingName?: string; proposedName?: string; nameChanged?: boolean };
type CheckRes = { skus: Sku[]; asOf: string; duplicateBill: boolean };
type Status = { connected: boolean; companyName: string; environment: string };
type Stage = "upload" | "vendor" | "check" | "fill" | "done";
type StepState = "wait" | "run" | "ok" | "fail";
type Step = { label: string; state: StepState; note?: string };

const NEW = "__new__";
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usDate = (d: string) => { const [y, m, dd] = d.split("-"); return `${m}/${dd}/${y}`; };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: "Server error" }));
  if (r.status === 401) { location.href = "/login"; throw new Error("Please log in."); }
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j as T;
}
const post = <T,>(url: string, body: unknown) =>
  call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Home() {
  const [st, setSt] = useState<Status | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [read, setRead] = useState<ReadRes | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [newVendor, setNewVendor] = useState("");
  const [storeId, setStoreId] = useState("");
  const [check, setCheck] = useState<CheckRes | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Step[]>([]);
  const [bill, setBill] = useState<{ id: string; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const e = new URLSearchParams(location.search).get("error");
    if (e) { setErr(e); history.replaceState(null, "", "/"); }
    call<Status>("/api/qb/status").then(setSt).catch((x) => setErr(x.message));
  }, []);

  function reset() {
    setStage("upload"); setRead(null); setCheck(null); setBill(null); setProgress([]); setErr(null);
    setFileName(""); setVendorId(""); setNewVendor(""); setNames({});
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- Step 1: upload + read
  async function onFile(f: File | undefined) {
    if (!f) return;
    reset(); setFileName(f.name); setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await call<ReadRes>("/api/read", { method: "POST", body: fd });
      setRead(r);
      if (!r.po.problems.length && r.vendor) {
        setVendorId(r.vendor.matchedId || (r.vendor.suggestions[0]?.id ?? ""));
        setNewVendor(r.po.vendor);
        setStoreId(r.storeId || "");
        setStage("vendor");
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  // ---- Step 2 -> 3: check SKUs
  async function runCheck() {
    if (!read) return;
    setBusy(true); setErr(null);
    try {
      const c = await post<CheckRes>("/api/check", { po: read.po, vendorId: vendorId && vendorId !== NEW ? vendorId : null });
      setCheck(c);
      setNames(Object.fromEntries(c.skus.filter((s) => s.status !== "exists").map((s) => [s.sku, s.proposedName || s.shortName])));
      setStage("check");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  // ---- Step 4: fill QuickBooks
  async function fill() {
    if (!read || !check) return;
    const toCreate = check.skus.filter((s) => s.status !== "exists");
    const steps: Step[] = [
      { label: vendorId === NEW ? `Create vendor “${newVendor}”` : "Vendor", state: "wait" },
      { label: `New products (0 of ${toCreate.length})`, state: "wait" },
      { label: "Create bill", state: "wait" },
    ];
    setProgress(steps); setStage("fill"); setErr(null); setBusy(true);
    const upd = (i: number, p: Partial<Step>) =>
      setProgress((old) => old.map((s, j) => (j === i ? { ...s, ...p } : s)));
    let i = 0;
    try {
      upd(0, { state: "run" });
      const v = await post<{ vendorId: string }>("/api/fill/vendor", {
        fileVendor: read.po.vendor, vendorId: vendorId === NEW ? null : vendorId, newName: newVendor,
      });
      upd(0, { state: "ok" });

      i = 1; upd(1, { state: toCreate.length ? "run" : "ok", note: toCreate.length ? undefined : "none needed" });
      const ids: Record<string, string> = Object.fromEntries(check.skus.filter((s) => s.itemId).map((s) => [s.sku.toUpperCase(), s.itemId!]));
      const failed: string[] = [];
      for (let k = 0; k < toCreate.length; k += 8) {
        const batch = toCreate.slice(k, k + 8).map((s) => ({ sku: s.sku, name: names[s.sku] || s.shortName }));
        const r = await post<{ results: { sku: string; id?: string; error?: string }[] }>("/api/fill/items", { items: batch, asOf: check.asOf });
        for (const x of r.results) x.id ? (ids[x.sku.toUpperCase()] = x.id) : failed.push(`${x.sku}: ${x.error}`);
        upd(1, { state: "run", label: `New products (${Math.min(k + 8, toCreate.length)} of ${toCreate.length})` });
      }
      if (failed.length) throw new Error("Some products could not be created:\n" + failed.join("\n"));
      if (toCreate.length) upd(1, { state: "ok" });

      i = 2; upd(2, { state: "run" });
      const lines = read.po.lines.map((l) => ({ itemId: ids[l.sku.toUpperCase()], qty: l.qty, amount: l.amount, description: l.fullName }));
      const b = await post<{ id: string; url: string }>("/api/fill/bill", {
        vendorId: v.vendorId, date: read.po.date, billNo: read.po.billNo, storeId, lines,
      });
      upd(2, { state: "ok" });
      setBill(b); setStage("done");
    } catch (x) {
      upd(i, { state: "fail" });
      setErr((x as Error).message + "\n\nIt is safe to click “Try again”: products already created are reused, and the bill is never added twice.");
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!confirm("Disconnect from this QuickBooks company?")) return;
    await post("/api/qb/disconnect", {}); reset(); setSt(await call<Status>("/api/qb/status"));
  }
  async function logout() { await post("/api/logout", {}); location.href = "/login"; }

  const counts = useMemo(() => {
    const s = check?.skus || [];
    return { exists: s.filter((x) => x.status === "exists").length, new: s.filter((x) => x.status === "new").length, flag: s.filter((x) => x.status === "flag").length };
  }, [check]);

  const po = read?.po;
  const locked = stage === "fill" || stage === "done";
  const vendorName = vendorId === NEW ? newVendor : read?.vendor?.all.find((v) => v.id === vendorId)?.name;
  const blockFill = !!check?.duplicateBill || Object.values(names).some((n) => !n.trim());

  return (
    <main>
      <header>
        <h1>Bill Import</h1>
        <div className="right">
          {st?.connected ? (
            <span className="pill ok">
              ● {st.companyName}
              {st.environment !== "production" && <em>{st.environment === "demo" ? "demo" : "test"}</em>}
              <button className="link" onClick={disconnect}>Disconnect</button>
            </span>
          ) : st ? <span className="pill off">Not connected</span> : null}
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </header>

      {err && <div className="alert">{err}</div>}

      {st && !st.connected && (
        <section className="card center">
          <p>Connect the QuickBooks company where bills should go.</p>
          <a className="btn" href="/api/qb/connect">Connect to QuickBooks</a>
        </section>
      )}

      {st?.connected && (
        <>
          {/* STEP 1 */}
          <section className="card">
            <h2><b>1</b> Upload PO file</h2>
            {!locked ? (
              <label className={`drop ${busy && stage === "upload" ? "busy" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => onFile(e.target.files?.[0])} hidden />
                {busy && stage === "upload" ? "Reading file…" : fileName ? <>📄 {fileName} <u>change</u></> : <>Drop the Excel file here or <u>choose file</u></>}
              </label>
            ) : <p className="muted">📄 {fileName}</p>}
            {po && po.problems.length > 0 && (
              <div className="alert">
                <b>Please fix the file and upload again:</b>
                <ul>{po.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
          </section>

          {/* STEP 2 */}
          {po && read?.vendor && stage !== "upload" && (
            <section className="card">
              <h2><b>2</b> Vendor</h2>
              <div className="kv"><span>In file</span><strong>{po.vendor}</strong></div>
              <div className="kv">
                <span>QuickBooks</span>
                {locked ? <strong>{vendorName}</strong> : (
                  <div className="grow">
                    {read.vendor.matchedId && vendorId === read.vendor.matchedId && (
                      <div className="ok-text">✓ Matched{read.vendor.how === "saved" ? " (saved from last time)" : ""}</div>
                    )}
                    {!read.vendor.matchedId && <div className="warn-text">Not found — pick the vendor or add new</div>}
                    <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={stage !== "vendor"}>
                      <option value="">— Select vendor —</option>
                      <option value={NEW}>+ Add as new vendor</option>
                      {read.vendor.suggestions.length > 0 && (
                        <optgroup label="Likely matches">
                          {read.vendor.suggestions.map((v) => <option key={"s" + v.id} value={v.id}>{v.name}</option>)}
                        </optgroup>
                      )}
                      <optgroup label="All vendors">
                        {read.vendor.all.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </optgroup>
                    </select>
                    {vendorId === NEW && (
                      <input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="New vendor name" disabled={stage !== "vendor"} />
                    )}
                  </div>
                )}
              </div>
              {!!read.stores?.length && (
                <div className="kv">
                  <span>Store</span>
                  {locked ? <strong>{read.stores.find((s) => s.id === storeId)?.name || "—"}</strong> : (
                    <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={stage !== "vendor"}>
                      <option value="">— None —</option>
                      {read.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
              )}
              {stage === "vendor" && (
                <button className="btn" disabled={busy || !vendorId || (vendorId === NEW && !newVendor.trim())} onClick={runCheck}>
                  {busy ? "Checking…" : "Start →"}
                </button>
              )}
              {stage === "check" && <button className="link" onClick={() => setStage("vendor")}>Change vendor</button>}
            </section>
          )}

          {/* STEP 3 */}
          {po && check && stage !== "upload" && stage !== "vendor" && (
            <section className="card">
              <h2><b>3</b> Check</h2>
              <div className="tiles">
                <div><span>Bill no.</span><strong>{po.billNo}</strong></div>
                <div><span>Date</span><strong>{usDate(po.date)}</strong></div>
                <div><span>Items</span><strong>{po.lines.length}</strong></div>
                <div><span>Total</span><strong>{money(po.total)}</strong>{po.invoiceAmount != null && <small className="ok-text">✓ matches file</small>}</div>
              </div>

              {check.duplicateBill && <div className="alert">Bill <b>{po.billNo}</b> is already in QuickBooks. It will not be added again.</div>}
              {po.warnings.map((w, i) => <div key={i} className="note">{w}</div>)}

              <h3>SKU check</h3>
              <div className="skusum">
                <span className="ok-text">✓ {counts.exists} already in QuickBooks</span>
                <span className="new-text">＋ {counts.new} new</span>
                {counts.flag > 0 && <span className="warn-text">⚠ {counts.flag} marked “No” but not found</span>}
              </div>

              {counts.new + counts.flag > 0 && (
                <>
                  <p className="muted small">These will be created with quantity 0, as-of date <b>{usDate(check.asOf)}</b>, non-taxable.</p>
                  <table>
                    <thead><tr><th>SKU</th><th>Product name in QuickBooks</th></tr></thead>
                    <tbody>
                      {check.skus.filter((s) => s.status !== "exists").map((s) => (
                        <tr key={s.sku} className={s.status === "flag" ? "flag" : ""}>
                          <td className="mono">{s.status === "flag" && "⚠ "}{s.sku}</td>
                          <td>
                            {stage === "check" ? (
                              <input value={names[s.sku] ?? ""} onChange={(e) => setNames({ ...names, [s.sku]: e.target.value })} />
                            ) : names[s.sku]}
                            {s.nameChanged && stage === "check" && <small className="warn-text">“{s.shortName}” is already used — changed</small>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {stage === "check" && (
                <button className="btn big" disabled={busy || blockFill} onClick={fill}>Fill data to QuickBooks</button>
              )}
            </section>
          )}

          {/* STEP 4 */}
          {(stage === "fill" || stage === "done") && (
            <section className="card">
              <h2><b>4</b> QuickBooks</h2>
              <ul className="steps">
                {progress.map((p, i) => (
                  <li key={i} className={p.state}>
                    <i>{p.state === "ok" ? "✓" : p.state === "fail" ? "✕" : p.state === "run" ? "…" : "○"}</i>
                    {p.label}{p.note && <span className="muted"> — {p.note}</span>}
                  </li>
                ))}
              </ul>
              {stage === "done" && bill && (
                <div className="done">
                  <strong>✓ Bill {po?.billNo} created — {money(po?.total || 0)}</strong>
                  <div className="row">
                    {bill.url && <a className="btn" href={bill.url} target="_blank" rel="noreferrer">Open bill in QuickBooks</a>}
                    <button className="btn ghost" onClick={reset}>Import another file</button>
                  </div>
                </div>
              )}
              {stage === "fill" && !busy && (
                <div className="row">
                  <button className="btn" onClick={fill}>Try again</button>
                  <button className="btn ghost" onClick={reset}>Start over</button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
