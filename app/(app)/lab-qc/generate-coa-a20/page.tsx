"use client";

// =============================================================================
// Generate COA - Factory A-20 (product based).
//
// The chemist picks a product and types the batch number. Everything measured
// in Product QC (zinc/sulphur/boron/calcium content, pH, suspensibility, wet
// sieve, density, ...) is pulled from the saved QC record and cannot be edited
// here. Parameters QC does not measure (persistent foam, heavy metals,
// pourability, ...) are typed in. Out-of-spec values block issuing.
//
// On submit: number claimed -> snapshot saved -> PDF emailed -> success screen
// with Download. On email failure the number is kept and Retry send re-sends.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import { useEffectiveRole } from "@/lib/use-effective-role";

interface ProductOption { code: string; name: string; coaTitle: string }

interface PreviewRow {
  key: string;
  label: string;
  unit: string;
  source: "qc" | "manual" | "appearance";
  editable: boolean;
  optional: boolean;
  qcValue: number | string | null;
  specMin: number | null;
  specMax: number | null;
  specText: string;
  decimals: number | null;
}

interface Preview {
  ok: boolean;
  found: boolean;
  message?: string;
  productName: string;
  coaTitle: string;
  docStyle: string;
  qtyLabel: string;
  showExpiry: boolean;
  mfgDate: string | null;
  expiryDate: string | null;
  rows: PreviewRow[];
  rejected: boolean;
}

interface CoaListRow {
  id: string;
  test_report_no: number;
  product_name: string;
  batch_no: string;
  invoice_no: string | null;
  generated_at: string;
  email_status: string | null;
}

type Success = { id: string; testReportNo: number; emailStatus: "sent" | "failed"; emailError?: string; product: string };

const RED = "#c0392b";
const GREEN = "var(--ok)";
const th: React.CSSProperties = { padding: "6px 8px", textAlign: "center", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 8px", textAlign: "center" };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function api<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/coa/a20", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as T;
}

export default function GenerateCoaA20Page() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const { activeFactory, activeModule, loading: moduleLoading } = useModule();
  const { effectiveRole } = useEffectiveRole();
  const { showToast } = useToast();

  const allowed = effectiveRole === "chemist" || effectiveRole === "factory_admin" || effectiveRole === "company_admin";
  useEffect(() => {
    if (authLoading || moduleLoading) return;
    if (!allowed) { router.replace("/lab-qc"); return; }
    if (activeModule && activeModule !== "lab_qc") router.replace("/select-module");
  }, [allowed, authLoading, moduleLoading, activeModule, router]);

  // ── form state ────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productCode, setProductCode] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [coaTitle, setCoaTitle] = useState("");
  const [coaDate, setCoaDate] = useState(todayIso());
  const [mfgDate, setMfgDate] = useState("");
  const [qty, setQty] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [lorryNo, setLorryNo] = useState("");
  const [reportNoInput, setReportNoInput] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [nextNo, setNextNo] = useState<number | null>(null);
  const [coaList, setCoaList] = useState<CoaListRow[]>([]);
  const [showList, setShowList] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);

  const product = products.find((p) => p.code === productCode);

  // products with a COA template
  useEffect(() => {
    api<{ products?: ProductOption[] }>({ action: "products" })
      .then((j) => setProducts(j.products ?? []))
      .catch(() => setProducts([]));
  }, []);

  const refreshNumbers = useCallback(async () => {
    if (!activeFactory) return;
    try {
      const [n, l] = await Promise.all([
        api<{ nextNo?: number | null }>({ action: "next_no" }),
        api<{ rows?: CoaListRow[] }>({ action: "list", factoryId: activeFactory.id }),
      ]);
      setNextNo(typeof n.nextNo === "number" ? n.nextNo : null);
      setCoaList(Array.isArray(l.rows) ? l.rows : []);
    } catch { /* hint only */ }
  }, [activeFactory]);
  useEffect(() => { void refreshNumbers(); }, [refreshNumbers]);

  // product change -> default title, clear typed values
  useEffect(() => {
    setCoaTitle(product?.coaTitle ?? "");
    setValues({});
    setDraftUrl(null);
  }, [productCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // live preview (debounced) from the saved Product QC record
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeFactory || !productCode || !batchNo.trim()) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const j = await api<Preview>({ action: "preview", factoryId: activeFactory.id, productCode, batchNumber: batchNo.trim() });
        setPreview(j);
        setMfgDate(j.mfgDate ?? "");
        setDraftUrl(null);
      } catch {
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [activeFactory, productCode, batchNo]);

  // ── live checks (mirror of the server guards) ─────────────────────────────
  const rowChecks = useMemo(() => {
    const problems: string[] = [];
    const status: Record<string, "pass" | "fail" | "none"> = {};
    for (const r of preview?.rows ?? []) {
      let n: number | null = null;
      if (r.source === "qc") {
        if (r.qcValue == null) { problems.push(`${r.label}: no value in the saved Product QC record.`); status[r.key] = "none"; continue; }
        n = r.qcValue as number;
      } else if (r.source === "appearance") {
        const t = (values[r.key] ?? (typeof r.qcValue === "string" ? r.qcValue : "")).trim();
        if (!t) problems.push(`${r.label}: enter the appearance.`);
        status[r.key] = "none";
        continue;
      } else {
        const t = (values[r.key] ?? "").trim();
        if (!t) { if (!r.optional) problems.push(`${r.label}: enter the result.`); status[r.key] = "none"; continue; }
        n = Number(t);
        if (!Number.isFinite(n)) { problems.push(`${r.label}: "${t}" is not a number.`); status[r.key] = "fail"; continue; }
      }
      const bad = (r.specMin != null && n < r.specMin) || (r.specMax != null && n > r.specMax);
      if (bad) problems.push(`${r.label}: ${n} is outside the spec (${r.specText}).`);
      status[r.key] = bad ? "fail" : "pass";
    }
    return { problems, status };
  }, [preview, values]);

  const blockingReason = useMemo(() => {
    if (!preview) return "Select a product and enter the batch number to preview.";
    if (!preview.ok) return preview.message ?? "Could not load this product.";
    if (!preview.found) return preview.message ?? "No saved Product QC for this batch.";
    if (preview.rejected) return `Batch ${batchNo.trim()} was Rejected in Product QC. A COA cannot certify rejected material.`;
    if (rowChecks.problems.length) return rowChecks.problems.join(" ");
    return null;
  }, [preview, rowChecks, batchNo]);

  const formValid = !!activeFactory && !!productCode && batchNo.trim() !== "" && coaTitle.trim() !== "";
  const canSubmit = formValid && !blockingReason && !submitting;

  const body = (action: "generate" | "preview_pdf") => ({
    action,
    factoryId: activeFactory!.id,
    productCode,
    batchNumber: batchNo.trim(),
    coaTitle: coaTitle.trim(),
    coaDate,
    mfgDate,
    qty: qty.trim(),
    invoiceNo: invoiceNo.trim(),
    invoiceDate: invoiceDate.trim(),
    lorryNo: lorryNo.trim(),
    values,
    testReportNo: reportNoInput.trim() === "" ? undefined : Number(reportNoInput),
    checkedBy: profile?.full_name ?? "",
  });

  const handlePreviewPdf = async () => {
    if (!activeFactory || !formValid) { showToast("Fill the form first.", true); return; }
    setDraftLoading(true);
    try {
      const j = await api<{ ok: boolean; message?: string; problems?: string[]; pdfBase64?: string }>(body("preview_pdf"));
      if (!j.ok || !j.pdfBase64) { showToast(j.problems?.join(" ") || j.message || "Could not build the preview.", true); return; }
      const bytes = Uint8Array.from(atob(j.pdfBase64), (c) => c.charCodeAt(0));
      setDraftUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error.", true);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !activeFactory) return;
    setSubmitting(true);
    try {
      const j = await api<{ ok: boolean; id?: string; testReportNo?: number; emailStatus?: "sent" | "failed"; emailError?: string; message?: string; problems?: string[] }>(body("generate"));
      if (!j.ok || !j.id) {
        showToast(j.problems?.join(" ") || j.message || "COA generation failed.", true);
        setSubmitting(false);
        return;
      }
      void refreshNumbers();
      setSuccess({
        id: j.id, testReportNo: j.testReportNo!, emailStatus: j.emailStatus ?? "failed",
        emailError: j.emailError, product: coaTitle.trim(),
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error.", true);
      setSubmitting(false);
    }
  };

  const download = async (id: string, no: number) => {
    if (!activeFactory) return;
    const res = await fetch("/api/coa/a20", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "download", coaId: id, factoryId: activeFactory.id }),
    });
    if (!res.ok) { showToast("Download failed.", true); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `COA-${no}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const handleRetry = async () => {
    if (!success || !activeFactory) return;
    const j = await api<{ ok: boolean; emailError?: string }>({ action: "retry", coaId: success.id, factoryId: activeFactory.id });
    if (j.ok) { setSuccess({ ...success, emailStatus: "sent", emailError: undefined }); showToast("COA email re-sent.", false); }
    else { setSuccess({ ...success, emailStatus: "failed", emailError: j.emailError }); showToast(j.emailError || "Retry failed.", true); }
  };

  const resetForm = (keepProduct: boolean) => {
    setBatchNo(""); setQty(""); setInvoiceNo(""); setInvoiceDate(""); setLorryNo("");
    setReportNoInput(""); setValues({}); setPreview(null); setDraftUrl(null); setMfgDate("");
    setCoaDate(todayIso());
    if (!keepProduct) { setProductCode(""); setCoaTitle(""); }
  };

  const startNew = (keepProduct: boolean) => {
    setSuccess(null); setSubmitting(false); resetForm(keepProduct);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── render guards ─────────────────────────────────────────────────────────
  if (authLoading || moduleLoading || !activeFactory) {
    return <div className="module-wrap"><div className="empty">Loading…</div></div>;
  }
  if (!allowed) return <div className="module-wrap"><div className="empty">Redirecting…</div></div>;

  if (success) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{success.emailStatus === "sent" ? "✅" : "⚠️"}</div>
          <h3 style={{ textTransform: "none" }}>COA generated - Test Report No. {success.testReportNo}</h3>
          <p className="field-hint">{success.product}</p>
          {success.emailStatus === "sent" ? (
            <p style={{ color: GREEN, marginTop: 12 }}>Emailed to the Lab mailboxes.</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: RED }}>Email failed: {success.emailError || "unknown error"}</p>
              <p className="field-hint">The COA is saved and the number is kept. No new number is used on retry.</p>
              <button className="btn" style={{ marginTop: 8 }} onClick={handleRetry}>Retry send</button>
            </div>
          )}
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <button className="btn btn-primary" style={{ minWidth: 260, padding: "12px 20px", fontSize: 15 }} onClick={() => startNew(false)}>＋ New COA</button>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button className="btn" onClick={() => download(success.id, success.testReportNo)}>Download PDF</button>
              <button className="btn" onClick={() => startNew(true)}>New COA · same product</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="module-wrap">
      <div className="module-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="title">📄 Generate COA</div>
          <div className="sub">{activeFactory.name} · Certificate of Analysis</div>
        </div>
        {(batchNo || productCode) && (
          <button className="btn" type="button" onClick={() => startNew(false)}>＋ New COA (clear form)</button>
        )}
      </div>

      <div className="module-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label>Product</label>
            <select value={productCode} onChange={(e) => setProductCode(e.target.value)}>
              <option value="">— select —</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Batch Number/Lot Number</label>
            <input type="text" value={batchNo} placeholder="e.g. JS-04020" onChange={(e) => setBatchNo(e.target.value)} />
          </div>

          <div>
            <label>Product name on certificate</label>
            <input type="text" value={coaTitle} onChange={(e) => setCoaTitle(e.target.value)} />
          </div>
          <div>
            <label>Test Report No. {nextNo != null && <span className="field-hint">(next due: {nextNo})</span>}</label>
            <input type="text" inputMode="numeric" value={reportNoInput}
              placeholder={nextNo != null ? String(nextNo) : "auto"}
              onChange={(e) => setReportNoInput(e.target.value.replace(/[^\d]/g, ""))} />
          </div>

          <div>
            <label>Date</label>
            <input type="date" value={coaDate} onChange={(e) => setCoaDate(e.target.value)} />
          </div>
          <div>
            <label>Date of Manufacture {preview?.showExpiry && preview.expiryDate && <span className="field-hint">(expiry: {preview.expiryDate.split("-").reverse().join("-")})</span>}</label>
            <input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
          </div>

          <div>
            <label>{preview?.qtyLabel ?? "Quantity"} <span className="field-hint">(optional)</span></label>
            <input type="text" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <label>Lorry No. <span className="field-hint">(optional)</span></label>
            <input type="text" value={lorryNo} onChange={(e) => setLorryNo(e.target.value)} />
          </div>

          <div>
            <label>Invoice No. <span className="field-hint">(optional)</span></label>
            <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div>
            <label>Invoice Date <span className="field-hint">(optional)</span></label>
            <input type="text" value={invoiceDate} placeholder="dd-mm-yyyy" onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
        </div>

        {blockingReason && productCode && batchNo.trim() && !previewing && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: "#fdecea", color: RED, fontSize: 13 }}>
            ⛔ {blockingReason}
          </div>
        )}

        {previewing && <div className="field-hint" style={{ marginTop: 12 }}>Looking up Product QC…</div>}

        {preview && preview.found && preview.rows.length > 0 && (
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line, #ccc)" }}>
                  <th style={th}>Sr</th>
                  <th style={{ ...th, textAlign: "left" }}>Parameter</th>
                  <th style={th}>Units</th>
                  <th style={th}>Specification</th>
                  <th style={th}>Actual Report</th>
                  <th style={th}>Source</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => {
                  const st = rowChecks.status[r.key] ?? "none";
                  const color = st === "fail" ? RED : st === "pass" ? GREEN : undefined;
                  return (
                    <tr key={r.key} style={{ borderBottom: "1px solid var(--line, #eee)" }}>
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, textAlign: "left" }}>{r.label}{r.optional && <span className="field-hint"> (optional)</span>}</td>
                      <td style={td}>{r.unit}</td>
                      <td style={td}>{r.specText}</td>
                      <td style={{ ...td, color, fontWeight: 600 }}>
                        {r.source === "qc" ? (
                          r.qcValue == null ? "—" : r.decimals != null ? (r.qcValue as number).toFixed(r.decimals) : String(r.qcValue)
                        ) : (
                          <input
                            type="text"
                            inputMode={r.source === "manual" ? "decimal" : "text"}
                            style={{ width: 140, fontSize: 13, padding: "3px 6px", textAlign: "center" }}
                            value={values[r.key] ?? (r.source === "appearance" && typeof r.qcValue === "string" ? r.qcValue : "")}
                            placeholder={r.optional ? "skip" : ""}
                            onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 11, color: "var(--ink-soft)" }}>
                        {r.source === "qc" ? "Product QC" : r.source === "appearance" ? "QC (editable)" : "Typed"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={!formValid || !preview?.found || draftLoading} onClick={handlePreviewPdf}>
            {draftLoading ? "Building…" : "Preview PDF"}
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? "Generating…" : "Generate COA & Email"}
          </button>
        </div>

        {draftUrl && (
          <div style={{ marginTop: 16 }}>
            <iframe src={draftUrl} title="COA draft preview" style={{ width: "100%", height: 760, border: "1px solid var(--line, #ccc)" }} />
          </div>
        )}
      </div>

      <div className="module-card" style={{ maxWidth: 980, margin: "16px auto 0" }}>
        <button type="button" className="btn" onClick={() => setShowList((s) => !s)}>
          {showList ? "Hide" : "Show"} issued COAs ({coaList.length})
        </button>
        {showList && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line, #ccc)" }}>
                  <th style={th}>No.</th><th style={{ ...th, textAlign: "left" }}>Product</th>
                  <th style={th}>Batch</th><th style={th}>Invoice</th><th style={th}>Date</th>
                  <th style={th}>Email</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {coaList.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--line, #eee)" }}>
                    <td style={td}>{c.test_report_no}</td>
                    <td style={{ ...td, textAlign: "left" }}>{c.product_name}</td>
                    <td style={td}>{c.batch_no}</td>
                    <td style={td}>{c.invoice_no ?? "-"}</td>
                    <td style={td}>{new Date(c.generated_at).toLocaleDateString("en-IN")}</td>
                    <td style={{ ...td, color: c.email_status === "sent" ? GREEN : RED }}>{c.email_status ?? "pending"}</td>
                    <td style={td}><button className="btn" type="button" onClick={() => download(c.id, c.test_report_no)}>PDF</button></td>
                  </tr>
                ))}
                {coaList.length === 0 && <tr><td colSpan={7} style={td}>No COAs issued yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
