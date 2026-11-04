"use client";

// =============================================================================
// Generate COA (JSCI/QC/17) — Lab (chemist) only, Factory A-20/1.
//
// Manual inputs: Invoice/Challan No. (toggle), Vehicle No., Batch No(s) (1–4),
// Quantity (MT). Everything else auto-populates from existing QC data via the
// server preview endpoint. On submit: a COA record is saved, a PDF is generated
// from the immutable snapshot, and it is emailed (To + Cc) — then a success
// screen offers a one-time Download PDF. On email failure: the record + number
// are kept and a single "Retry send" button re-sends from the snapshot.
//
// Access: route guard (effective role must be chemist/admin) + the API route's
// own 403 + RLS. Hidden from Production/Stores/Operator via AppNav.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import { useEffectiveRole } from "@/lib/use-effective-role";
import { useFieldAudit } from "@/lib/use-field-audit";
import NumericInput from "@/components/NumericInput";
import { MAX_BATCHES_PER_COA, BATCH_WARN_THRESHOLD } from "@/lib/coa/catalog";

interface PartyOption { party_code: string; customer_name: string | null }

interface PreviewRow {
  sr: number;
  sub?: "a" | "b" | "c";
  label: string;
  min: number | null;
  max: number | null;
  method: string | null;
  remarks: string | null;
  hasSpec: boolean;
  needsVerification: boolean;
  decimals?: number;
  rowStatus: "pass" | "fail" | "none";
  actuals: Array<{ batchNumber: string; value: number | null; status: "pass" | "fail" | "none" }>;
}

interface CoaListRow {
  id: string;
  test_report_no: number;
  customer_name: string;
  doc_label: string | null;
  invoice_no: string | null;
  batch_no: string | null;
  qty: string | null;
  generated_at: string;
  email_status: string | null;
}

interface RowEdit { label?: string; method?: string; remarks?: string }

interface PreviewResult {
  ok: boolean;
  rows: PreviewRow[];
  batchNumbers: string[];
  customerName: string;
  defaultShipTo: string | null;
  defaultCodeNumber: string | null;
  shipToOptions: Array<{ label: string; address: string }>;
  lotNos: string[];
  mfgDates: string[];
  expiryDate: string | null;
  missingBatches: string[];
  gaps: Array<{ label: string; field: string }>;
  outOfSpec: Array<{ label: string; batchNumber: string; value: number }>;
  noSpecRows: boolean;
  anyMissing: boolean;
  anyGap: boolean;
  anyOutOfSpec: boolean;
  canGenerate: boolean;
  batchPartyCodes: Array<{ batchNumber: string; partyCode: string | null }>;
}

type SuccessState = {
  id: string;
  testReportNo: number;
  emailStatus: "sent" | "failed";
  emailError?: string;
  customerName: string;
};

const RED = "#c0392b";
const GREEN = "var(--ok)";

export default function GenerateCoaPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();
  const { activeFactory, activeModule, loading: moduleLoading } = useModule();
  const { effectiveRole } = useEffectiveRole();
  const { showToast } = useToast();
  const audit = useFieldAudit();

  // ── route guard: chemist + admins only ───────────────────────────────────
  const allowed = effectiveRole === "chemist" || effectiveRole === "factory_admin" || effectiveRole === "company_admin";
  useEffect(() => {
    if (authLoading || moduleLoading) return;
    if (!allowed) { router.replace("/lab-qc"); return; }
    if (activeModule && activeModule !== "lab_qc") { router.replace("/select-module"); }
  }, [allowed, authLoading, moduleLoading, activeModule, router]);

  // ── form state ─────────────────────────────────────────────────────────
  const [docKind, setDocKind] = useState<"Invoice No." | "Challan No.">("Invoice No.");
  const [docValue, setDocValue] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [batches, setBatches] = useState<string[]>([]);
  const [quantityMt, setQuantityMt] = useState("");

  const [parties, setParties] = useState<PartyOption[]>([]);
  const [partyCode, setPartyCode] = useState("");
  const [shipToSel, setShipToSel] = useState<string>("");    // dropdown label or "__manual__"
  const [shipToManual, setShipToManual] = useState("");

  // C7: Code No. (above the table). C8: typed report number + next due + list.
  const [codeNumber, setCodeNumber] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [reportNoInput, setReportNoInput] = useState("");
  const [nextNo, setNextNo] = useState<number | null>(null);
  const [coaList, setCoaList] = useState<CoaListRow[]>([]);
  const [showList, setShowList] = useState(false);
  // C9: editable review (label / method / remarks only) + draft PDF preview.
  const [rowEdits, setRowEdits] = useState<Record<number, RowEdit>>({});
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [dupInvoice, setDupInvoice] = useState(false);

  // ── load parties ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("parties")
      .select("party_code, customer_name")
      .eq("is_active", true)
      .not("party_code", "in", '("SULPHUR_A_GRADE","SULPHUR_B_GRADE")')
      .order("party_code")
      .then(({ data }) => setParties((data ?? []) as PartyOption[]));
  }, [supabase]);

  // Default the party from the first resolved batch (chemist can override).
  useEffect(() => {
    if (!partyCode && preview?.batchPartyCodes?.length) {
      const first = preview.batchPartyCodes.find((b) => b.partyCode)?.partyCode;
      if (first) setPartyCode(first);
    }
  }, [preview, partyCode]);

  // ── batch add / remove ─────────────────────────────────────────────────
  const addBatch = useCallback(() => {
    const bn = batchInput.trim();
    if (!bn) return;
    if (batches.includes(bn)) { showToast(`Batch ${bn} already added.`, true); return; }
    if (batches.length >= MAX_BATCHES_PER_COA) { showToast(`Max ${MAX_BATCHES_PER_COA} batches per COA.`, true); return; }
    setBatches((prev) => [...prev, bn]);
    setBatchInput("");
  }, [batchInput, batches, showToast]);

  const removeBatch = useCallback((bn: string) => {
    setBatches((prev) => prev.filter((b) => b !== bn));
  }, []);

  // ── live preview (debounced) when batches + party resolve ─────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeFactory || batches.length === 0 || !partyCode) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/coa/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", factoryId: activeFactory.id, partyCode, batchNumbers: batches }),
        });
        const json = (await res.json()) as PreviewResult;
        setPreview(json);
      } catch {
        setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [activeFactory, batches, partyCode]);

  // Prefill ship-to from the party default when the party changes.
  useEffect(() => {
    setShipToSel("");
    setShipToManual("");
    setCodeTouched(false);
  }, [partyCode]);

  // C7: Code No. defaults to the party's code (editable; stops following once touched).
  useEffect(() => {
    if (codeTouched) return;
    setCodeNumber(preview?.defaultCodeNumber ?? partyCode ?? "");
  }, [preview?.defaultCodeNumber, partyCode, codeTouched]);

  // C9: review edits belong to one party/batch combination.
  useEffect(() => { setRowEdits({}); setDraftUrl(null); }, [partyCode, batches]);

  // C8: next number due + list of generated COAs.
  const refreshNumbers = useCallback(async () => {
    if (!activeFactory) return;
    try {
      const [n, l] = await Promise.all([
        fetch("/api/coa/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "next_no" }) }).then((r) => r.json()),
        fetch("/api/coa/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", factoryId: activeFactory.id }) }).then((r) => r.json()),
      ]);
      setNextNo(typeof n.nextNo === "number" ? n.nextNo : null);
      setCoaList(Array.isArray(l.rows) ? (l.rows as CoaListRow[]) : []);
    } catch { /* non-fatal: the form still works without the hint/list */ }
  }, [activeFactory]);

  useEffect(() => { void refreshNumbers(); }, [refreshNumbers]);

  // Duplicate-invoice warning (client-side check as the user types the number).
  useEffect(() => {
    if (!activeFactory || !docValue.trim()) { setDupInvoice(false); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("coa_documents")
        .select("id")
        .eq("factory_id", activeFactory.id)
        .eq("invoice_no", docValue.trim())
        .limit(1);
      setDupInvoice((data?.length ?? 0) > 0);
    }, 400);
    return () => clearTimeout(t);
  }, [docValue, activeFactory, supabase]);

  // ── resolved ship-to text ─────────────────────────────────────────────────
  const resolvedShipTo = useMemo(() => {
    if (shipToSel === "__manual__") return shipToManual.trim();
    if (shipToSel) {
      const opt = preview?.shipToOptions.find((o) => o.label === shipToSel);
      return opt?.address ?? "";
    }
    // nothing picked yet — fall back to party default if present
    return preview?.defaultShipTo?.trim() ?? "";
  }, [shipToSel, shipToManual, preview]);

  // ── guard / enable logic ──────────────────────────────────────────────────
  const blockingReason = useMemo(() => {
    if (!preview) return "Add batch(es) and select a party to preview.";
    if (preview.noSpecRows) return `No spec rows loaded for this party — load the customer's spec before issuing a COA.`;
    if (preview.anyMissing) return `No finalized QC found for batch ${preview.missingBatches.join(", ")}. Final QC results must be saved in Batch Analysis before a COA can be generated - ask QC to enter and save them, then retry.`;
    if (preview.anyGap) return `This party requires parameters with no QC source field: ${preview.gaps.map((g) => g.label).join(", ")}. Add them to the Final Inspection form first.`;
    if (preview.anyOutOfSpec) return `Out of spec — cannot certify failing material: ${preview.outOfSpec.map((o) => `${o.label} (batch ${o.batchNumber})`).join("; ")}.`;
    return null;
  }, [preview]);

  const formValid =
    !!activeFactory &&
    batches.length > 0 &&
    !!partyCode &&
    docValue.trim() !== "" &&
    vehicleNo.trim() !== "" &&
    quantityMt.trim() !== "" && Number(quantityMt) > 0 &&
    resolvedShipTo !== "";

  const canSubmit = formValid && !!preview?.canGenerate && !blockingReason && !submitting;

  // Only rows the chemist actually changed are sent; the server limits edits to
  // label / method / remarks (actuals + spec limits always come from the data).
  const buildOverrides = () =>
    (preview?.rows ?? []).map((r, i) => {
      const e = rowEdits[i];
      if (!e) return null;
      const o: RowEdit = {};
      if (e.label !== undefined && e.label !== r.label) o.label = e.label;
      if (e.method !== undefined && e.method !== (r.method ?? "")) o.method = e.method;
      if (e.remarks !== undefined && e.remarks !== (r.remarks ?? "")) o.remarks = e.remarks;
      return Object.keys(o).length ? o : null;
    });

  const buildCoaBody = (action: "generate" | "preview_pdf") => ({
    action,
    factoryId: activeFactory!.id,
    partyCode,
    shipTo: resolvedShipTo,
    docLabel: docKind,
    docValue: docValue.trim(),
    vehicleNo: vehicleNo.trim(),
    quantityMt: Number(quantityMt),
    batchNumbers: batches,
    checkedBy: profile?.full_name ?? "",
    codeNumber: codeNumber.trim(),
    testReportNo: reportNoInput.trim() === "" ? undefined : Number(reportNoInput),
    rowOverrides: buildOverrides(),
  });

  // C9: render the DRAFT PDF from the current (edited) values without issuing.
  const handlePreviewPdf = async () => {
    if (!activeFactory || !formValid) { showToast("Fill the form first.", true); return; }
    setDraftLoading(true);
    try {
      const res = await fetch("/api/coa/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCoaBody("preview_pdf")),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { showToast(json.message || "Could not build the preview.", true); return; }
      const bytes = Uint8Array.from(atob(json.pdfBase64 as string), (c) => c.charCodeAt(0));
      setDraftUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error.", true);
    } finally {
      setDraftLoading(false);
    }
  };

  const downloadCoa = async (id: string, no: number) => {
    if (!activeFactory) return;
    const res = await fetch("/api/coa/generate", {
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

  // ── submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit || !activeFactory || !user) return;
    setSubmitting(true);  // disabled after first click — number uniqueness also guards double-submit
    try {
      const res = await fetch("/api/coa/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCoaBody("generate")),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showToast(json.message || json.error || "COA generation failed.", true);
        setSubmitting(false);
        return;
      }
      // field audit flush (module 'coa', record_id = new COA id)
      await audit.flush(supabase, user.id, "coa", json.id);
      void refreshNumbers();   // C8: bump "next due" + the generated list
      setSuccess({
        id: json.id,
        testReportNo: json.testReportNo,
        emailStatus: json.emailStatus,
        emailError: json.emailError,
        customerName: preview?.customerName ?? partyCode,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error.", true);
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (!success || !activeFactory) return;
    const res = await fetch("/api/coa/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", coaId: success.id, factoryId: activeFactory.id }),
    });
    const json = await res.json();
    if (json.ok) {
      setSuccess({ ...success, emailStatus: "sent", emailError: undefined });
      showToast("COA email re-sent.", false);
    } else {
      setSuccess({ ...success, emailStatus: "failed", emailError: json.emailError });
      showToast(json.emailError || "Retry failed.", true);
    }
  };

  const handleDownload = async () => {
    if (!success || !activeFactory) return;
    const res = await fetch("/api/coa/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "download", coaId: success.id, factoryId: activeFactory.id }),
    });
    if (!res.ok) { showToast("Download failed.", true); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `COA-${success.testReportNo}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const resetForm = useCallback(() => {
    setDocValue(""); setVehicleNo(""); setBatchInput(""); setBatches([]); setQuantityMt("");
    setPartyCode(""); setShipToSel(""); setShipToManual(""); setPreview(null); setDupInvoice(false);
    setCodeNumber(""); setCodeTouched(false); setReportNoInput(""); setRowEdits({}); setDraftUrl(null);
    audit.reset();
  }, [audit]);

  // ── render guards ─────────────────────────────────────────────────────────
  if (authLoading || moduleLoading || !activeFactory) {
    return <div className="module-wrap"><div className="empty">Loading…</div></div>;
  }
  if (!allowed) {
    return <div className="module-wrap"><div className="empty">Redirecting…</div></div>;
  }

  // ── success screen ────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{success.emailStatus === "sent" ? "✅" : "⚠️"}</div>
          <h3 style={{ textTransform: "none" }}>COA generated — Test Report No. {success.testReportNo}</h3>
          <p className="field-hint">{success.customerName}</p>

          {success.emailStatus === "sent" ? (
            <p style={{ color: GREEN, marginTop: 12 }}>Emailed to the Lab mailboxes (Cc chinmaythakker@).</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p style={{ color: RED }}>Email failed: {success.emailError || "unknown error"}</p>
              <p className="field-hint">The COA is saved and the number is kept — no new number is used on retry.</p>
              <button className="btn" style={{ marginTop: 8 }} onClick={handleRetry}>Retry send</button>
            </div>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={handleDownload}>Download PDF</button>
            <button className="btn" onClick={() => { setSuccess(null); setSubmitting(false); resetForm(); }}>New COA</button>
          </div>
        </div>
      </div>
    );
  }

  const nB = batches.length;

  // ── main form ─────────────────────────────────────────────────────────────
  return (
    <div className="module-wrap">
      <div className="module-header">
        <div className="title">📄 Generate COA</div>
        <div className="sub">{activeFactory.name} · Certificate of Analysis (JSCI/QC/17)</div>
      </div>

      <div className="module-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* ── Manual inputs ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label>Document type</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["Invoice No.", "Challan No."] as const).map((k) => (
                <button key={k} type="button"
                  className={`btn ${docKind === k ? "btn-primary" : ""}`}
                  onClick={() => setDocKind(k)}>{k.replace(" No.", "")}</button>
              ))}
            </div>
          </div>
          <div>
            <label>{docKind}</label>
            <input type="text" value={docValue}
              onChange={(e) => setDocValue(e.target.value)}
              onBlur={() => audit.record("doc_value", docValue)} />
            {dupInvoice && (
              <div style={{ color: "var(--warn)", fontSize: 12, marginTop: 4 }}>
                ⚠ A COA already exists for this {docKind.replace(" No.", "").toLowerCase()} number (not blocked).
              </div>
            )}
          </div>

          <div>
            <label>Vehicle No.</label>
            <input type="text" value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              onBlur={() => audit.record("vehicle_no", vehicleNo)} />
          </div>
          <div>
            <label>Quantity (MT, total)</label>
            <NumericInput allowDecimal={true} min="0" value={quantityMt}
              onChange={(e) => setQuantityMt(e.target.value)}
              onBlur={() => audit.record("quantity_mt", quantityMt)} />
          </div>

          <div>
            {/* C7: Code No. — printed above the table on every COA */}
            <label>Code No.</label>
            <input type="text" value={codeNumber}
              placeholder={preview?.defaultCodeNumber ?? partyCode ?? "—"}
              onChange={(e) => { setCodeNumber(e.target.value); setCodeTouched(true); }}
              onBlur={() => audit.record("code_number", codeNumber)} />
          </div>
          <div>
            {/* C8: typed Test Report No. — blank = take the next number due */}
            <label>Test Report No. {nextNo != null && <span className="field-hint">(next due: {nextNo})</span>}</label>
            <input type="text" inputMode="numeric" value={reportNoInput}
              placeholder={nextNo != null ? String(nextNo) : "auto"}
              onChange={(e) => setReportNoInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => audit.record("test_report_no", reportNoInput)} />
          </div>
        </div>

        {/* ── Batches ── */}
        <div style={{ marginTop: 16 }}>
          <label>Batch No(s) — add up to {MAX_BATCHES_PER_COA}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" value={batchInput}
              placeholder="e.g. 347"
              onChange={(e) => setBatchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBatch(); } }} />
            <button type="button" className="btn" onClick={addBatch}>Add</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {batches.map((b) => (
              <span key={b} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 14, background: "var(--surface-2, #eee)" }}>
                {b}
                <button type="button" onClick={() => removeBatch(b)} style={{ border: "none", background: "none", cursor: "pointer" }}>✕</button>
              </span>
            ))}
          </div>
          {nB > BATCH_WARN_THRESHOLD && (
            <div style={{ color: "var(--warn)", fontSize: 12, marginTop: 4 }}>
              ⚠ {nB} batches — the certificate columns get narrow beyond {BATCH_WARN_THRESHOLD}.
            </div>
          )}
        </div>

        {/* ── Party + ship-to ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <label>Party / customer</label>
            <select value={partyCode} onChange={(e) => setPartyCode(e.target.value)}>
              <option value="">— select —</option>
              {parties.map((p) => (
                <option key={p.party_code} value={p.party_code}>{p.customer_name || p.party_code}</option>
              ))}
            </select>
            {preview?.batchPartyCodes?.some((b) => b.partyCode && b.partyCode !== partyCode) && (
              <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 4 }}>
                Batch was analysed against a different party — re-evaluated against the selected party.
              </div>
            )}
          </div>
          <div>
            <label>Ship-to</label>
            <select value={shipToSel} onChange={(e) => setShipToSel(e.target.value)}>
              <option value="">{preview?.defaultShipTo ? "Party default" : "— select —"}</option>
              {(preview?.shipToOptions ?? []).map((o) => (
                <option key={o.label} value={o.label}>{o.label}</option>
              ))}
              <option value="__manual__">Enter manually…</option>
            </select>
            {shipToSel === "__manual__" && (
              <textarea rows={4} style={{ marginTop: 8 }}
                placeholder="Full ship-to address (required)"
                value={shipToManual}
                onChange={(e) => setShipToManual(e.target.value)}
                onBlur={() => audit.record("ship_to", shipToManual)} />
            )}
            {resolvedShipTo && shipToSel !== "__manual__" && (
              <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", marginTop: 6, color: "var(--ink-soft)" }}>{resolvedShipTo}</pre>
            )}
          </div>
        </div>

        {/* ── Derived read-only preview strip ── */}
        {preview && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-soft)" }}>
            <strong>COA Date:</strong> today &nbsp;·&nbsp;
            <strong>Lot No:</strong> {preview.lotNos.join(", ") || "-"} &nbsp;·&nbsp;
            <strong>Mfg Date(s):</strong> {preview.mfgDates.join(", ") || "-"} &nbsp;·&nbsp;
            <strong>Expiry:</strong> {preview.expiryDate || "-"} <span style={{ color: "var(--ink-soft)" }}>(mfg + 2 yrs)</span>
          </div>
        )}

        {/* ── Guard banner ── */}
        {blockingReason && batches.length > 0 && partyCode && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: "#fdecea", color: RED, fontSize: 13 }}>
            ⛔ {blockingReason}
          </div>
        )}

        {/* ── Preview table ── */}
        {previewing && <div className="field-hint" style={{ marginTop: 12 }}>Resolving…</div>}
        {preview && preview.rows.length > 0 && (
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line, #ccc)" }}>
                  <th style={th}>Sr</th>
                  <th style={{ ...th, textAlign: "left" }}>Parameter</th>
                  {batches.map((b) => <th key={b} style={th}>B-{b}</th>)}
                  <th style={th}>Min</th>
                  <th style={th}>Max</th>
                  <th style={th}>Method</th>
                  <th style={th}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => {
                  const e = rowEdits[i] ?? {};
                  const setEdit = (patch: RowEdit) => setRowEdits((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }));
                  const cellInput: React.CSSProperties = { width: "100%", minWidth: 70, fontSize: 12, padding: "3px 5px" };
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line, #eee)" }}>
                      <td style={td}>{r.sub ? `${r.sr}${r.sub}` : r.sr}</td>
                      <td style={{ ...td, textAlign: "left" }}>
                        {/* C9: editable text (label / method / remarks) */}
                        <input type="text" style={{ ...cellInput, minWidth: 180 }} value={e.label ?? r.label}
                          onChange={(ev) => setEdit({ label: ev.target.value })} />
                        {r.needsVerification && <span title="Spec needs verification" style={{ color: "var(--warn)", marginLeft: 4 }}>⚠</span>}
                      </td>
                      {/* Actuals are read-only: they always come from the QC record.
                          C10: no pass/fail colouring here - the COA carries none. */}
                      {r.actuals.map((a) => (
                        <td key={a.batchNumber} style={td}>
                          {a.value == null ? "-" : r.decimals != null ? a.value.toFixed(r.decimals) : a.value}
                        </td>
                      ))}
                      <td style={td}>{r.hasSpec && r.min != null ? Number(r.min) : "-"}</td>
                      <td style={td}>{r.hasSpec && r.max != null ? Number(r.max) : "-"}</td>
                      <td style={td}>
                        <input type="text" style={cellInput} value={e.method ?? (r.method ?? "")}
                          onChange={(ev) => setEdit({ method: ev.target.value })} />
                      </td>
                      <td style={td}>
                        <input type="text" style={cellInput} value={e.remarks ?? (r.remarks ?? "")}
                          onChange={(ev) => setEdit({ remarks: ev.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {preview && preview.rows.length > 0 && (
          <div className="field-hint" style={{ marginTop: 8 }}>
            Parameter names, Test Method and Remarks above are editable. Actual values and spec limits
            come from the QC record and the party spec and cannot be changed here.
          </div>
        )}

        {/* ── C9: draft PDF review ── */}
        {draftUrl && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>Draft preview (not issued, no number used)</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <a className="btn" href={draftUrl} target="_blank" rel="noreferrer">Open / print</a>
                <button className="btn" type="button" onClick={() => setDraftUrl(null)}>Close</button>
              </div>
            </div>
            <iframe title="COA draft preview" src={draftUrl} style={{ width: "100%", height: 720, border: "1px solid var(--line, #ccc)", borderRadius: 6 }} />
          </div>
        )}

        {/* ── Submit ── */}
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button className="btn" type="button" disabled={!formValid || !preview?.canGenerate || draftLoading || submitting} onClick={handlePreviewPdf}>
            {draftLoading ? "Building preview…" : "Preview PDF"}
          </button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? "Generating…" : "Generate & email COA"}
          </button>
        </div>
      </div>

      {/* ── C8: list of COAs generated so far ── */}
      <div className="module-card" style={{ maxWidth: 980, margin: "16px auto 0" }}>
        <button type="button" className="btn" onClick={() => setShowList((v) => !v)}>
          {showList ? "Hide" : "Show"} generated COAs ({coaList.length})
        </button>
        {showList && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            {coaList.length === 0 ? (
              <div className="field-hint">No COAs generated yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--line, #ccc)" }}>
                    <th style={th}>Report No.</th>
                    <th style={{ ...th, textAlign: "left" }}>Customer</th>
                    <th style={th}>Date</th>
                    <th style={th}>Invoice / Challan</th>
                    <th style={th}>Batches</th>
                    <th style={th}>Qty</th>
                    <th style={th}>Email</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {coaList.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--line, #eee)" }}>
                      <td style={td}>{c.test_report_no}</td>
                      <td style={{ ...td, textAlign: "left" }}>{c.customer_name}</td>
                      <td style={td}>{new Date(c.generated_at).toLocaleDateString("en-IN")}</td>
                      <td style={td}>{c.invoice_no || "-"}</td>
                      <td style={td}>{c.batch_no || "-"}</td>
                      <td style={td}>{c.qty || "-"}</td>
                      <td style={{ ...td, color: c.email_status === "sent" ? GREEN : c.email_status === "failed" ? RED : "inherit" }}>{c.email_status || "-"}</td>
                      <td style={td}><button className="btn" type="button" onClick={() => downloadCoa(c.id, c.test_report_no)}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "center", fontWeight: 700, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "5px 8px", textAlign: "center", verticalAlign: "top" };
