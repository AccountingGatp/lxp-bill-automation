/** SKU compare key: ignores case, spaces and look-alike dashes (– — ‐), so "fid-flwr-tnm-7g " = "FID–FLWR–TNM–7G". */
export const normSku = (s: string) =>
  String(s ?? "").normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, "").toUpperCase();
