"use client";

// =============================================================================
// Lab QC — Report Generation
//
// A dedicated tab (beside Activities / Records / Search / Dashboard) to
// generate + download report PDFs for an already-saved QC entry, WITHOUT
// having to re-open the data-entry form.
//
// Enter a batch number → the page finds what QC data exists for it and shows
// the applicable report buttons:
//   • batch_analysis (Sulphur Powder) → Finish Goods Testing + Final Inspection
//   • product_qc                      → Certificate of Analysis (COA)
//
// Crude Sulphur Incoming (Doc JSCI/QC/03) is a separate flow — it needs TWO
// rm_qc records (Sample 1 / Sample 2), so it stays on the RM QC page.
// =============================================================================

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";

interface BatchAnalysisHit {
  id: string;
  analysis_date: string;
}

interface ProductQcHit {
  id: string;
  test_date: string;
  phase: string;
  product_name: string;
}

export default function LabQcReportsPage() {
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [batchNumber, setBatchNumber] = useState("");
  const [searching, setSearching]     = useState(false);
  const [searched, setSearched]       = useState(false);

  const [batchAnalysis, setBatchAnalysis] = useState<BatchAnalysisHit | null>(null);
  const [productQcs, setProductQcs]       = useState<ProductQcHit[]>([]);

  // Final Inspection modal (needs srNo / jobNo / shift not stored anywhere)
  const [fiModalOpen, setFiModalOpen] = useState(false);
  const [fiExtra, setFiExtra] = useState({ srNo: "", jobNo: "", shift: "Day" });

  // Which report is currently generating (disables its button)
  const [busy, setBusy] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Look up all QC records tied to the entered batch number.
  // -------------------------------------------------------------------------
  const handleSearch = async () => {
    const bn = batchNumber.trim();
    if (!bn) { showToast("Enter a batch number.", true); return; }
    if (!activeFactory) { showToast("Session error — refresh.", true); return; }

    setSearching(true);
    setSearched(false);
    setBatchAnalysis(null);
    setProductQcs([]);

    try {
      // Resolve the batch row(s) with this number at this factory
      const { data: batches } = await supabase
        .from("batches")
        .select("id, batch_number")
        .eq("factory_id", activeFactory.id)
        .ilike("batch_number", bn);

      const batchIds = (batches ?? []).map(b => b.id);

      if (batchIds.length === 0) {
        setSearched(true);
        return;
      }

      // batch_analysis (one per batch)
      const { data: ba } = await supabase
        .from("batch_analysis")
        .select("id, analysis_date, batch_id")
        .in("batch_id", batchIds)
        .order("analysis_date", { ascending: false })
        .limit(1);
      if (ba && ba.length > 0) {
        setBatchAnalysis({ id: ba[0].id, analysis_date: ba[0].analysis_date });
      }

      // product_qc (may be multiple: phases / products)
      const { data: pqc } = await supabase
        .from("product_qc")
        .select("id, test_date, phase, product_id, products(name)")
        .in("batch_id", batchIds)
        .order("test_date", { ascending: false });
      if (pqc && pqc.length > 0) {
        setProductQcs(pqc.map(r => {
          const p = r.products as { name?: string } | null;
          return {
            id: r.id,
            test_date: r.test_date,
            phase: r.phase,
            product_name: p?.name ?? "Product",
          };
        }));
      }

      setSearched(true);
    } catch {
      showToast("Search failed — try again.", true);
    } finally {
      setSearching(false);
    }
  };

  // -------------------------------------------------------------------------
  // Report generation calls (reuse the existing API routes)
  // -------------------------------------------------------------------------
  const genBatchAnalysisReport = async (
    reportType: "finish_goods" | "final_inspection",
    extra?: Record<string, string>,
  ) => {
    if (!activeFactory || !batchAnalysis) return;
    setBusy(reportType);
    try {
      const res = await fetch("/api/lab-qc/generate-batch-analysis-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_analysis_id: batchAnalysis.id,
          factory_id: activeFactory.id,
          report_type: reportType,
          extra,
        }),
      });
      const json = await res.json();
      if (!res.ok) { showToast("Report failed: " + (json?.error ?? "unknown"), true); return; }
      showToast("Report generated ✓");
      setFiModalOpen(false);
      if (json.pdf_url) window.open(json.pdf_url, "_blank");
    } catch {
      showToast("Network error generating report.", true);
    } finally {
      setBusy(null);
    }
  };

  const genCoa = async (productQcId: string) => {
    // COA needs customer + dispatch details; those live on the Product QC page's
    // modal. From here we direct the user there rather than duplicate the whole
    // customer/spec form. (COA requires customer spec selection.)
    showToast("Open Product QC → Generate COA for customer-specific certificates.", false);
    void productQcId;
  };

  const hasAnyReport = batchAnalysis || productQcs.length > 0;

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Report Generation</h3>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Enter a batch number to generate and download its report PDFs from
          already-saved QC data.
        </div>

        <label>Batch Number *</label>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <input
            type="text"
            placeholder="e.g. test4567"
            value={batchNumber}
            onChange={e => setBatchNumber(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            style={{ flex: "1 1 auto", width: "auto", minWidth: 0 }}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={searching}
            onClick={handleSearch}
            style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}
          >
            {searching ? "Searching…" : "Find"}
          </button>
        </div>
      </div>

      {/* Results */}
      {searched && !hasAnyReport && (
        <div className="card">
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No saved QC records found for batch <strong>&ldquo;{batchNumber.trim()}&rdquo;</strong>.
            Check the batch number, or save the analysis first under Activities.
          </div>
        </div>
      )}

      {/* Batch Analysis reports (Sulphur Powder) */}
      {batchAnalysis && (
        <div className="card">
          <h3>Sulphur Powder — Batch {batchNumber.trim()}</h3>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Analysis saved {new Date(batchAnalysis.analysis_date).toLocaleDateString("en-IN")}.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy === "finish_goods"}
              onClick={() => genBatchAnalysisReport("finish_goods")}
              style={{ flex: "0 0 auto", width: "auto" }}
            >
              {busy === "finish_goods" ? "Generating…" : "Finish Goods Testing Report"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setFiModalOpen(true)}
              style={{ flex: "0 0 auto", width: "auto" }}
            >
              Final Inspection Record (JSCI/QC/16)
            </button>
          </div>
        </div>
      )}

      {/* Product QC → COA */}
      {productQcs.length > 0 && (
        <div className="card">
          <h3>Product QC — Batch {batchNumber.trim()}</h3>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Certificates of Analysis are customer-specific — generate them from
            the Product QC screen where you can pick the customer &amp; dispatch
            details.
          </div>
          {productQcs.map(p => (
            <div key={p.id} className="pending-item">
              <div className="pi-top">
                <span>✅ {p.product_name}{p.phase !== "none" ? ` · Phase ${p.phase}` : ""}</span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {new Date(p.test_date).toLocaleDateString("en-IN")}
                </span>
              </div>
              <Link
                href="/lab-qc/product-qc"
                style={{ fontSize: 13, color: "var(--clay)" }}
              >
                Open Product QC to generate COA →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Final Inspection modal */}
      {fiModalOpen && batchAnalysis && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={() => busy !== "final_inspection" && setFiModalOpen(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: "100%", margin: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <h3>Final Inspection Record Details</h3>
            <div className="field-hint" style={{ marginBottom: 12 }}>
              These fields aren&rsquo;t stored on the analysis — enter them for
              this report.
            </div>

            <label>Sr No</label>
            <input type="text" placeholder="e.g. 393"
              value={fiExtra.srNo} onChange={e => setFiExtra(f => ({ ...f, srNo: e.target.value }))} />

            <label style={{ marginTop: 10 }}>Job No</label>
            <input type="text" placeholder="e.g. P-324"
              value={fiExtra.jobNo} onChange={e => setFiExtra(f => ({ ...f, jobNo: e.target.value }))} />

            <label style={{ marginTop: 10 }}>Shift</label>
            <select value={fiExtra.shift} onChange={e => setFiExtra(f => ({ ...f, shift: e.target.value }))}>
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy === "final_inspection"}
                onClick={() => genBatchAnalysisReport("final_inspection", fiExtra)}
                style={{ flex: 1 }}
              >
                {busy === "final_inspection" ? "Generating…" : "Generate Report"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={busy === "final_inspection"}
                onClick={() => setFiModalOpen(false)}
                style={{ flex: "0 0 auto", width: "auto" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
