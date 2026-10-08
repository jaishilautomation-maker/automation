"use client";

// =============================================================================
// Lab QC — Raw Material QC
//
// A-20/1: Crude Sulphur only — dynamic form driven by qc_test_definitions
//
// A-20:   5 RM materials
//   - Sulphur Powder → special branch: search qc_imports for A-20/1 source QC
//     by batch number. Shows imported QC read-only if found.
//   - Zinc Oxide, Calcium Chloride, Tebuconazole, Boric Powder →
//     standard dynamic form from qc_test_definitions
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import DateField from "@/components/DateField";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import { evalFormula } from "@/lib/formula";
import { notifyQcFinalized } from "@/lib/qc-exchange/notify";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { Material, QcTestDefinition } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { notifyReport } from "@/lib/reports/notify-report-client";
import { buildRmQcEmail } from "@/lib/notifications/lab-qc-emails";
import { useFieldAudit } from "@/lib/use-field-audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

interface QcImportRow {
  id: string;
  source_factory: string;
  source_batch_number: string | null;
  material: string | null;
  test_result: string | null;
  qc_status: string;
  tested_at: string | null;
  finalized_at: string | null;
  transferred_at: string;
  payload: Record<string, unknown>;
  status: string;
}

interface SpecRow {
  parameter: string;
  parameter_label: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  target_value: number | null;
  needs_verification: boolean;
}

type RiskStatus = "pass" | "fail" | "none";

type CrudeGrade = "A" | "B" | null;

// Synthetic "party" code seeded in migration 048 carrying the IS-6655 A-Grade
// incoming spec limits for Crude Sulphur. The chemist does NOT pick a grade —
// values are entered and the grade is auto-determined from them against these
// A-grade limits (see determineCrudeGrade below).
const CRUDE_A_GRADE_CODE = "SULPHUR_A_GRADE";

// IS-6655 purity band (% solubility in CS2) used to auto-grade a batch.
// A batch is only ever A or B — there is no reject outcome for crude sulphur.
const CRUDE_PURITY_A_MIN = 98.0;   // >= 98 and within A limits → A; else → B

// Oil incoming spec sheet: Appearance "Clear & Bright", Density 0.850–0.880,
// Viscosity "Report" (recorded, no limit).
const OIL_DENSITY_MIN = 0.850;
const OIL_DENSITY_MAX = 0.880;

// Small inline spec + pass/fail badge (mirrors the crude sulphur badge layout).
function SpecBadge({ specText, status, needsVerification }: {
  specText: string;
  status: RiskStatus;
  needsVerification?: boolean;
}) {
  const color = status === "pass" ? "var(--ok)" : status === "fail" ? "#c0392b" : "var(--ink-soft)";
  const label = status === "pass" ? "✓ Pass" : status === "fail" ? "✗ Fail" : "—";
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4 }}>
      <div style={{ color: "var(--ink-soft)" }}>
        Spec: <strong>{specText}</strong>
        {needsVerification && (
          <span title="Spec needs verification against the physical sheet"
            style={{ color: "var(--warn)", marginLeft: 4 }}>⚠</span>
        )}
      </div>
      <div style={{ color, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";

// A-20/1 QC type
type QcRmType = "crude_sulphur" | "oil";

const A20_RM_CODES = [
  "SULPHUR_POWDER",
  "ZINC_OXIDE",
  "CALCIUM_CHLORIDE",
  "TEBUCONAZOLE",
  "BORIC_POWDER",
];

export default function RmQcPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // ── Draft autosave ──────────────────────────────────────────────────────
  const pathname = usePathname();
  interface DraftShape {
    qcRmType: QcRmType;
    crudeInvoiceNumber: string;
    values: Record<string, string>;
    testDate: string;
    remarks: string;
    oilBatchNumber: string;
    oilAppearance: string;
    oilMass: string;
    oilVolume: string;
    oilViscosity: string;
  }
  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, activeFactory?.id, user?.id),
  );
  const d0 = draft.restored;
  // One-time snapshot of the restored draft (captured at mount). The defs-load
  // effect seeds `values` from this, NOT the live `d0`, so autosaves don't
  // re-seed and clobber what the user is typing.
  const [initialDraft] = useState<DraftShape | null>(() => draft.restored);

  // A-20/1 type selector
  const [qcRmType, setQcRmType] = useState<QcRmType>(d0?.qcRmType ?? "crude_sulphur");

  const [materials, setMaterials]     = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(true);
  const [materialId, setMaterialId]   = useState("");
  const [batchId, setBatchId]         = useState("");
  const [batches, setBatches]         = useState<BatchOption[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  // A-20/1 Crude Sulphur: invoice number resolved against rm_receipts.
  // No auto-create — the chemist must enter an invoice that was already
  // registered in the RM Receipt activity.
  const [crudeInvoiceNumber, setCrudeInvoiceNumber] = useState(d0?.crudeInvoiceNumber ?? "");
  const [resolvingInvoice, setResolvingInvoice]     = useState(false);
  const [receiptLinkError, setReceiptLinkError]     = useState<string | null>(null);
  // Pulled read-only from the matched rm_receipts row on successful link.
  const [linkedReceipt, setLinkedReceipt] = useState<{
    id: string;
    supplier_name: string;
    received_date: string;
    quantity: number;
    unit: string;
  } | null>(null);
  // Crude Sulphur A-grade specs — auto-loaded (no grade selector). Drives the
  // inline per-parameter spec + pass/fail badge and the auto-determined grade.
  const [crudeSpecs, setCrudeSpecs] = useState<SpecRow[]>([]);
  const [testDefs, setTestDefs]       = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(false);
  const [values, setValues]           = useState<Record<string, string>>({});
  const [testDate, setTestDate]       = useState(d0?.testDate ?? new Date().toISOString().slice(0, 10));
  // Chemist name is taken from the logged-in user (profile.full_name) — no
  // manual entry. Used only for email/sheet display; chemist_id = user.id
  // remains the authoritative identity on the record.
  const chemistName = profile?.full_name ?? "";
  const [remarks, setRemarks]         = useState(d0?.remarks ?? "");
  const [submitting, setSubmitting]   = useState(false);

  // Oil QC fields
  const [oilBatchNumber, setOilBatchNumber] = useState(d0?.oilBatchNumber ?? "");
  const [oilAppearance, setOilAppearance]   = useState(d0?.oilAppearance ?? "");
  const [oilMass, setOilMass]               = useState(d0?.oilMass ?? "");
  const [oilVolume, setOilVolume]           = useState(d0?.oilVolume ?? "");
  const [oilViscosity, setOilViscosity]     = useState(d0?.oilViscosity ?? "");
  const [oilSubmitting, setOilSubmitting]   = useState(false);

  const oilDensity = (parseFloat(oilMass) && parseFloat(oilVolume))
    ? (parseFloat(oilMass) / parseFloat(oilVolume)).toFixed(4)
    : "";

  // Oil QC spec check (fixed spec sheet — Appearance "Clear & Bright",
  // Density 0.850–0.880, Viscosity is "Report" so no pass/fail).
  const oilAppearanceStatus: RiskStatus = (() => {
    const t = oilAppearance.trim().toLowerCase();
    if (!t) return "none";
    const normalized = t.replace(/\band\b/g, "&").replace(/\s+/g, " ");
    return normalized.includes("clear") && normalized.includes("bright")
      ? "pass" : "fail";
  })();
  const oilDensityStatus: RiskStatus = (() => {
    if (!oilDensity) return "none";
    const v = parseFloat(oilDensity);
    if (isNaN(v)) return "none";
    return v >= OIL_DENSITY_MIN && v <= OIL_DENSITY_MAX ? "pass" : "fail";
  })();
  const oilEvaluated: RiskStatus[] = [oilAppearanceStatus, oilDensityStatus].filter(s => s !== "none");
  const oilOverallStatus: RiskStatus =
    oilEvaluated.length === 0 ? "none" : oilEvaluated.some(s => s === "fail") ? "fail" : "pass";

  // Sulphur Powder cross-factory state (A-20 only)
  const [spBatchSearch, setSpBatchSearch]       = useState("");
  const [spSearching, setSpSearching]           = useState(false);
  const [spImport, setSpImport]                 = useState<QcImportRow | null>(null);
  const [spNotFound, setSpNotFound]             = useState(false);
  const [spImporting, setSpImporting]           = useState(false);
  const [spImportedBatchId, setSpImportedBatchId] = useState<string | null>(null);

  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});
  const audit = useFieldAudit();

  // Autosave the live form state on every change (debounced inside the hook).
  const draftSave = draft.save;
  useEffect(() => {
    draftSave({
      qcRmType, crudeInvoiceNumber, values, testDate, remarks,
      oilBatchNumber, oilAppearance, oilMass, oilVolume, oilViscosity,
    });
  }, [qcRmType, crudeInvoiceNumber, values, testDate, remarks,
      oilBatchNumber, oilAppearance, oilMass, oilVolume, oilViscosity, draftSave]);

  const selectedMaterial = materials.find(m => m.id === materialId);
  const isSulphurPowder  = selectedMaterial?.code === "SULPHUR_POWDER";

  // ---------------------------------------------------------------------------
  // Load materials
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const sb = createClient();
    if (isA20_1) {
      sb.from("materials").select("*").eq("code", "SULPHUR_CRUDE").eq("is_active", true)
        .maybeSingle()
        .then(({ data }) => {
          if (data) { setMaterials([data as Material]); setMaterialId((data as Material).id); }
          setLoadingMats(false);
        });
    } else {
      sb.from("materials").select("*").in("code", A20_RM_CODES).eq("is_active", true)
        .then(({ data }) => {
          const sorted = A20_RM_CODES
            .map(code => (data ?? []).find((m: Material) => m.code === code))
            .filter(Boolean) as Material[];
          setMaterials(sorted);
          setLoadingMats(false);
        });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Load batches (for A-20/1 crude sulphur these are invoice-number entries)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) { setBatches([]); setBatchId(""); return; }
    if (!isA20_1 && (!materialId || isSulphurPowder)) {
      setBatches([]); setBatchId(""); return;
    }
    // For A-20/1: skip if oil type is selected
    if (isA20_1 && qcRmType !== "crude_sulphur") {
      setBatches([]); setBatchId(""); return;
    }
    setLoadingBatches(true);

    let query = supabase.from("batches")
      .select("id, batch_number, lot_number, production_date")
      .eq("factory_id", activeFactory.id)
      .eq("batch_type", "rm")
      .order("production_date", { ascending: false })
      .limit(50);

    // For A-20 (non A-20/1), filter by material
    if (!isA20_1 && materialId) {
      query = query.eq("material_id", materialId);
    }

    query.then(({ data }) => {
        setBatches((data ?? []) as BatchOption[]);
        setBatchId("");
        setLoadingBatches(false);
      });
  }, [materialId, activeFactory, isSulphurPowder, supabase, qcRmType]);

  // ---------------------------------------------------------------------------
  // Load test definitions
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!materialId || isSulphurPowder) { setTestDefs([]); setValues({}); return; }
    setLoadingDefs(true);
    supabase.from("qc_test_definitions").select("*")
      .eq("material_id", materialId).eq("phase", "none").eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        // Merge any saved draft values over the blank init so restored input
        // survives a tab/browser close (one-time; see initialDraft).
        setValues({ ...init, ...(initialDraft?.values ?? {}) });
        setLoadingDefs(false);
      });
  }, [materialId, isSulphurPowder, supabase, initialDraft]);

  // ---------------------------------------------------------------------------
  // Crude Sulphur: auto-load the IS-6655 A-grade specs (no grade selector).
  // The chemist enters values and the grade is determined from them; these
  // A-grade limits drive both the inline per-parameter badge and the grade calc.
  // Uses the same coa_customer_specs table as Batch Analysis.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isA20_1 || qcRmType !== "crude_sulphur") { setCrudeSpecs([]); return; }
    supabase
      .from("coa_customer_specs")
      .select("parameter, parameter_label, unit, min_value, max_value, target_value, needs_verification")
      .eq("party_code", CRUDE_A_GRADE_CODE)
      .eq("is_active", true)
      .then(({ data }) => setCrudeSpecs((data ?? []) as SpecRow[]));
  }, [qcRmType, supabase]);

  // ---------------------------------------------------------------------------
  // Sulphur Powder: search qc_imports by batch number
  // ---------------------------------------------------------------------------
  const searchSulphurQc = useCallback(async () => {
    const q = spBatchSearch.trim();
    if (!q) { showToast("Enter a batch number to search.", true); return; }

    setSpSearching(true);
    setSpImport(null);
    setSpNotFound(false);

    // Read qc_imports from the SAME project the /receive route writes to.
    // Both are now bound to NEXT_PUBLIC_SUPABASE_URL (the single A-20 project),
    // so a synced row is always visible to this lookup.

    // Match on batch number. Use a case-insensitive exact match and take the
    // most recent active row — there can be more than one if the source QC was
    // re-sent, and requiring exactly one would otherwise error.
    const { data, error } = await supabase
      .from("qc_imports")
      .select("*")
      .ilike("source_batch_number", q)
      .eq("status", "active")
      .order("transferred_at", { ascending: false })
      .limit(1);

    setSpSearching(false);
    if (error) { showToast("Search failed: " + error.message, true); return; }
    if (data && data.length > 0) {
      setSpImport(data[0] as QcImportRow);
      // Has this Sulphur Powder batch already been registered locally in A-20?
      if (activeFactory) {
        const { data: existing } = await supabase
          .from("batches")
          .select("id")
          .eq("factory_id", activeFactory.id)
          .ilike("batch_number", q)
          .maybeSingle();
        setSpImportedBatchId(existing?.id ?? null);
      }
    } else {
      setSpNotFound(true);
    }
  }, [spBatchSearch, supabase, showToast, activeFactory]);

  // ---------------------------------------------------------------------------
  // Sulphur Powder: register the looked-up A-20/1 batch locally in A-20.
  //
  // A-20 does NOT create its own rm_qc row for Sulphur Powder (QC is owned by
  // A-20/1). Instead we register the batch as an A-20 `batches` row so it is
  // usable downstream (Product QC, production), traceable to the A-20/1 source
  // by batch number. No FK to the A-20/1 batch is possible (separate project),
  // so the link is the shared batch number.
  // ---------------------------------------------------------------------------
  const importSulphurBatch = useCallback(async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!spImport) return;
    if (!isSulphurPowder || !materialId) { showToast("Select Sulphur Powder first.", true); return; }

    const bn = (spImport.source_batch_number ?? spBatchSearch).trim();
    if (!bn) { showToast("No batch number to import.", true); return; }

    setSpImporting(true);
    try {
      // Idempotent: reuse an existing local batch with the same number.
      const { data: existing } = await supabase
        .from("batches")
        .select("id")
        .eq("factory_id", activeFactory.id)
        .ilike("batch_number", bn)
        .maybeSingle();

      if (existing) {
        setSpImportedBatchId(existing.id);
        showToast("Batch already registered in A-20 ✓");
        return;
      }

      const prodDate = spImport.tested_at
        ? String(spImport.tested_at).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const { data: newBatch, error } = await supabase
        .from("batches")
        .insert({
          batch_number:    bn,
          factory_id:      activeFactory.id,
          material_id:     materialId,       // Sulphur Powder
          product_id:      null,
          batch_type:      "rm",
          production_date: prodDate,
          quantity:        null,
          unit:            null,
          source_batch_id: null,             // A-20/1 batch lives in another project
          created_by:      user.id,
        })
        .select("id")
        .single();

      if (error || !newBatch) {
        showToast("Could not register batch: " + (error?.message ?? "unknown"), true);
        return;
      }
      setSpImportedBatchId(newBatch.id);
      showToast("Sulphur Powder batch registered in A-20 ✓");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSpImporting(false);
    }
  }, [user, activeFactory, spImport, isSulphurPowder, materialId, spBatchSearch, supabase, showToast]);

  // ---------------------------------------------------------------------------
  // Field change
  // ---------------------------------------------------------------------------
  const handleChange = useCallback((key: string, val: string) => {
    setValues(prev => {
      const next = { ...prev, [key]: val };
      testDefs.filter(d => d.is_calculated && d.formula).forEach(d => {
        const result = evalFormula(d.formula!, next);
        next[d.test_key] = result !== null ? String(result) : "";
      });
      return next;
    });
  }, [testDefs]);

  // ---------------------------------------------------------------------------
  // Crude Sulphur: per-parameter spec lookup + pass/fail (mirrors Batch Analysis)
  // ---------------------------------------------------------------------------
  const crudeSpecFor = useCallback(
    (paramKey: string): SpecRow | undefined => crudeSpecs.find(s => s.parameter === paramKey),
    [crudeSpecs]
  );

  const crudeStatusFor = useCallback(
    (paramKey: string, rawVal: string): RiskStatus => {
      const spec = crudeSpecFor(paramKey);
      if (!spec) return "none";
      const v = parseFloat(rawVal);
      if (rawVal === "" || isNaN(v)) return "none";
      if (spec.min_value != null && v < spec.min_value) return "fail";
      if (spec.max_value != null && v > spec.max_value) return "fail";
      return "pass";
    },
    [crudeSpecFor]
  );

  const crudeSpecText = useCallback((s: SpecRow): string => {
    const parts: string[] = [];
    if (s.min_value != null) parts.push(`min ${s.min_value}`);
    if (s.max_value != null) parts.push(`max ${s.max_value}`);
    const base = parts.join(" · ") || "—";
    return s.target_value != null ? `${base} (target ${s.target_value})` : base;
  }, []);

  const buildCrudeSpecBadge = useCallback((paramKey: string): React.ReactNode => {
    const spec = crudeSpecFor(paramKey);
    if (!spec) return null;
    const raw = values[paramKey] ?? "";
    const st = crudeStatusFor(paramKey, raw);
    const color = st === "pass" ? "var(--ok)" : st === "fail" ? "#c0392b" : "var(--ink-soft)";
    const label = st === "pass" ? "✓ Pass" : st === "fail" ? "✗ Fail" : "—";
    return (
      <div style={{ fontSize: 12, lineHeight: 1.4 }}>
        <div style={{ color: "var(--ink-soft)" }}>
          Spec: <strong>{crudeSpecText(spec)}</strong>
          {spec.needs_verification && (
            <span title="Spec needs verification against the physical sheet"
              style={{ color: "var(--warn)", marginLeft: 4 }}>⚠</span>
          )}
        </div>
        <div style={{ color, fontWeight: 700 }}>{label}</div>
      </div>
    );
  }, [crudeSpecFor, crudeStatusFor, values, crudeSpecText]);

  // Per-parameter A-grade pass/fail across crude parameters that have a spec + value
  const crudeEvaluatedRows = crudeSpecs
    .map(s => ({ status: crudeStatusFor(s.parameter, values[s.parameter] ?? "") }))
    .filter(r => r.status !== "none");
  const crudeAnyFail = crudeEvaluatedRows.some(r => r.status === "fail");
  const crudeAllWithinA =
    crudeEvaluatedRows.length > 0 && !crudeAnyFail;

  // --------------------------------------------------------------------------
  // Auto-determine grade from ENTERED values (IS-6655) — no upfront selection.
  // Crude sulphur readings are consistently above the lowest bound, so there is
  // no "Reject" outcome: a batch is either A or B. Any exceptional low reading
  // is captured as B (the safety-side catch-all) rather than rejected.
  //   A    → purity ≥ 98 AND every A-grade limit met (acidity/ash/heat-loss)
  //   B    → anything else (purity < 98, or ≥ 98 with an A limit exceeded)
  //   null → purity not yet entered (nothing to grade)
  // --------------------------------------------------------------------------
  const crudeGrade: CrudeGrade = (() => {
    const purityRaw = values["purity_percent"] ?? "";
    const purity = parseFloat(purityRaw);
    if (purityRaw === "" || isNaN(purity)) return null;
    if (purity >= CRUDE_PURITY_A_MIN && crudeAllWithinA) return "A";
    return "B";
  })();

  // ---------------------------------------------------------------------------
  // Crude Sulphur: resolve invoice number against an EXISTING rm_receipts row.
  //
  // Flow:
  //   1. Look up batches.batch_number = invoice (A-20/1 RM Receipt stores the
  //      invoice number as the batch number, not in rm_receipts.invoice_number).
  //   2. If no batch found → show error, keep test fields locked.
  //   3. If batch found but no rm_receipts row for that batch_id → same error.
  //   4. If rm_receipts row found → pull supplier/date/qty read-only, set
  //      batchId and linkedReceipt. Never auto-create a batch here.
  // ---------------------------------------------------------------------------
  const resolveCrudeInvoice = useCallback(async () => {
    const inv = crudeInvoiceNumber.trim();
    if (!inv) { setBatchId(""); setLinkedReceipt(null); setReceiptLinkError(null); return; }
    if (!activeFactory || !user || !materialId) { setBatchId(""); return; }
    setResolvingInvoice(true);
    setReceiptLinkError(null);
    setLinkedReceipt(null);
    setBatchId("");
    try {
      // Step 1: find the batch by invoice number (stored as batch_number).
      const { data: batchRow } = await supabase
        .from("batches")
        .select("id")
        .eq("factory_id", activeFactory.id)
        .eq("batch_number", inv)
        .maybeSingle();

      if (!batchRow) {
        setReceiptLinkError(
          `No receipt found for invoice "${inv}" — create it in Raw Material Receipt first.`
        );
        return;
      }

      // Step 2: require an rm_receipts row for this batch.
      const { data: receiptRow } = await supabase
        .from("rm_receipts")
        .select("id, supplier_name, received_date, quantity, unit")
        .eq("batch_id", batchRow.id)
        .eq("factory_id", activeFactory.id)
        .maybeSingle();

      if (!receiptRow) {
        setReceiptLinkError(
          `Invoice "${inv}" has no receipt record — create it in Raw Material Receipt first.`
        );
        return;
      }

      // Success — lock the form to this receipt.
      setBatchId(batchRow.id);
      setLinkedReceipt({
        id:            receiptRow.id,
        supplier_name: receiptRow.supplier_name,
        received_date: receiptRow.received_date,
        quantity:      receiptRow.quantity,
        unit:          receiptRow.unit,
      });
    } catch {
      setReceiptLinkError("Network error resolving invoice — try again.");
    } finally {
      setResolvingInvoice(false);
    }
  }, [crudeInvoiceNumber, activeFactory, user, materialId, supabase]);

  // ---------------------------------------------------------------------------
  // Submit (non-Sulphur Powder materials)
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId) { showToast("Select a material.", true); return; }
    if (!batchId)    { showToast("Select a batch.", true); return; }

    setSubmitting(true);
    try {
      const testResults: Record<string, number | string | boolean> = {};
      testDefs.forEach(d => {
        const raw = values[d.test_key];
        if (raw === "" || raw === undefined) return;
        if (d.input_type === "number") {
          const n = parseFloat(raw); if (!isNaN(n)) testResults[d.test_key] = n;
        } else if (d.input_type === "boolean") {
          testResults[d.test_key] = raw === "true";
        } else {
          testResults[d.test_key] = raw;
        }
      });

      // Crude Sulphur: persist the auto-determined IS-6655 grade alongside the
      // raw values so it flows to the DB, email, and sheet.
      const isCrudeSulphur = isA20_1 && qcRmType === "crude_sulphur";
      if (isCrudeSulphur && crudeGrade) {
        testResults["incoming_grade"] = crudeGrade;
      }

      const { data: newRow, error } = await supabase.from("rm_qc").insert({
        batch_id:             batchId,
        factory_id:           activeFactory.id,
        material_id:          materialId,
        chemist_id:           user.id,
        test_date:            testDate,
        appearance:           values["appearance"] ?? null,
        appearance_ok:        null,
        test_results:         testResults,
        remarks:              remarks.trim() || null,
        // Receipt link (migration 060) — authoritative link to the rm_receipts row.
        receipt_id:           linkedReceipt?.id ?? null,
      }).select("id").single();

      if (error || !newRow) {
        showToast("Could not save: " + (error?.message ?? "unknown"), true); return;
      }

      const flushPromises = Object.values(uploaderRefs.current)
        .filter(Boolean).map(ref => ref!.flush(newRow.id));
      await Promise.all(flushPromises);
      // Flush field-level audit log (one batched INSERT)
      await audit.flush(supabase, user.id, "rm_qc", newRow.id);

      // Fire-and-forget: generate + email the filled incoming-inspection report.
      void notifyReport({ source: "rm_qc", recordId: newRow.id });

      void notifyQcFinalized({
        sourceTable:   "rm_qc",
        sourceRecordId: newRow.id,
        factoryId:     activeFactory.id,
        batchId:       batchId,
        overallResult: "pending",
        testDate:      testDate,
        testResults:   testResults,
        extra:         { material_name: selectedMaterial?.name ?? null, appearance: values["appearance"] ?? null, remarks: remarks.trim() || null },
      });

      // Fire-and-forget email
      const nowISO = new Date().toISOString();
      const selectedBatch = batches.find(b => b.id === batchId);
      const { subject: rmqcSubj, html: rmqcHtml } = buildRmQcEmail({
        materialName:    selectedMaterial?.name ?? "Raw Material",
        batchNumber:     selectedBatch?.batch_number,
        testDate:        testDate,
        chemistName:     chemistName.trim() || null,
        grade:           isCrudeSulphur ? crudeGrade : null,
        testResults,
        remarks:         remarks.trim() || null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     nowISO,
      });
      void notifyEvent({
        eventType: "lab_qc_rm_qc",
        subject: rmqcSubj,
        html: rmqcHtml,
        factoryId: activeFactory.id,
        referenceId: newRow.id,
        sheetData: {
          type: "append",
          target: "lab",
          tab: "RM QC",
          values: [
            newRow.id,
            selectedMaterial?.name ?? "Raw Material",
            selectedBatch?.batch_number ?? null,
            linkedReceipt?.id ?? null,
            testDate,
            chemistName.trim() || null,
            isCrudeSulphur ? (crudeGrade ?? "") : "",
            JSON.stringify(testResults),
            remarks.trim() || null,
            profile?.full_name ?? null,
            nowISO,
            activeFactory.id,
          ],
        },
      });

      showToast("QC results saved ✓");
      setBatchId("");
      setLinkedReceipt(null);
      setReceiptLinkError(null);
      setCrudeInvoiceNumber("");
      setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
      setRemarks("");
      audit.reset();
      draft.clear();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  const photoProps: PhotoUploadProps | undefined = (user && activeFactory) ? {
    factoryCode:  activeFactory.code,
    factoryId:    activeFactory.id,
    entityType:   "rm_qc",
    entityId:     null,
    userId:       user.id,
    onUploaded:   (key, path) => handleChange(key, path),
    uploaderRefs,
  } : undefined;


  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Raw Material QC</h3>

        {/* A-20/1: type selector */}
        {isA20_1 ? (
          <>
            <label>Material Type *</label>
            <select value={qcRmType} onChange={e => { setQcRmType(e.target.value as QcRmType); }}>
              <option value="crude_sulphur">Crude Sulphur</option>
              <option value="oil">Oil</option>
            </select>
          </>
        ) : (
          <>
            <label>Raw Material *</label>
            {loadingMats ? (
              <div className="field-hint">Loading…</div>
            ) : (
              <select value={materialId} onChange={e => {
                setMaterialId(e.target.value);
                setSpImport(null); setSpNotFound(false); setSpBatchSearch(""); setSpImportedBatchId(null);
                setBatchId(""); setValues({});
              }}>
                <option value="">— Select raw material —</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* ── A-20/1 Crude Sulphur QC (batch selector + dynamic test form) ── */}
      {isA20_1 && qcRmType === "crude_sulphur" && (
        <>
          <div className="card">
            <label>Invoice Number *</label>
            <input
              type="text"
              placeholder="Enter invoice number"
              value={crudeInvoiceNumber}
              onChange={e => {
                setCrudeInvoiceNumber(e.target.value);
                setBatchId("");
                setLinkedReceipt(null);
                setReceiptLinkError(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  // Link on Enter (not just Tab/blur). Prevent an accidental
                  // form submit and blur so the field also loses focus.
                  e.preventDefault();
                  void resolveCrudeInvoice();
                  e.currentTarget.blur();
                }
              }}
              onBlur={resolveCrudeInvoice}
            />
            {resolvingInvoice && <div className="field-hint">Looking up receipt…</div>}
            {!resolvingInvoice && receiptLinkError && (
              <div className="field-hint" style={{ color: "var(--warn)", fontWeight: 600, marginTop: 6 }}>
                ✗ {receiptLinkError}
              </div>
            )}
            {!resolvingInvoice && batchId && linkedReceipt && (
              <div className="field-hint" style={{ color: "var(--ok)" }}>
                ✓ Receipt found — enter test details below.
              </div>
            )}
            {!resolvingInvoice && crudeInvoiceNumber.trim() && !batchId && !receiptLinkError && (
              <div className="field-hint">Press Enter or tab out to look up this invoice.</div>
            )}
          </div>

          {/* Read-only receipt details — pulled from rm_receipts on successful link */}
          {batchId && linkedReceipt && (
            <div className="card" style={{ background: "var(--ok-soft)", border: "1px solid var(--ok)" }}>
              <h3 style={{ color: "var(--ok)", marginBottom: 8 }}>Receipt Details (read-only)</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 13 }}>
                <div><b>Supplier:</b> {linkedReceipt.supplier_name}</div>
                <div><b>Received Date:</b> {linkedReceipt.received_date}</div>
                <div><b>Quantity:</b> {linkedReceipt.quantity} {linkedReceipt.unit}</div>
              </div>
              <div className="field-hint" style={{ marginTop: 8 }}>
                These details are from the RM Receipt record — edit them there if incorrect.
              </div>
            </div>
          )}

          {batchId && (
            <>
              <div className="card">
                <h3>Test Details</h3>
                <div className="row2">
                  <div>
                    <label>Test Date *</label>
                    <DateField value={testDate} onChange={setTestDate} />
                  </div>
                  <div>
                    <label>Chemist</label>
                    <input type="text" readOnly value={chemistName || "—"}
                      style={{ background: "var(--ok-soft)", fontWeight: 600 }} />
                    <p className="field-hint" style={{ marginTop: 4 }}>From your login</p>
                  </div>
                </div>
                {crudeSpecs.length === 0 && (
                  <p className="field-hint" style={{ marginTop: 6, color: "var(--warn)" }}>
                    No IS-6655 specs on file — run migration 048 to enable the
                    inline spec check and auto-grade.
                  </p>
                )}
              </div>

              {loadingDefs ? (
                <div className="card"><div className="empty">Loading test fields…</div></div>
              ) : (
                <div className="card">
                  <h3>Test Results — Crude Sulphur</h3>
                  <p className="field-hint" style={{ marginBottom: 12 }}>
                    Enter the values below. Each parameter shows its IS-6655 A-grade
                    spec and pass/fail, and the grade is determined automatically.
                  </p>
                  {testDefs.map(def => (
                    <QcFieldRenderer
                      key={def.id}
                      def={def}
                      value={values[def.test_key] ?? ""}
                      onChange={handleChange}
                      onBlur={(key, val) => audit.record(key, val)}
                      specBadge={crudeSpecs.length > 0 ? buildCrudeSpecBadge(def.test_key) : null}
                      photoUploadProps={photoProps}
                    />
                  ))}
                </div>
              )}

              {/* Auto-determined grade banner (IS-6655). Grade is computed from
                  the entered values — the chemist does not pick it. */}
              {crudeSpecs.length > 0 && crudeGrade && (() => {
                const isA = crudeGrade === "A";
                const accent = isA ? "var(--ok)" : "var(--warn)";
                const bg = isA ? "var(--ok-soft)" : "#fff4e0";
                return (
                  <div className="card" style={{
                    display: "flex", alignItems: "center", gap: 12,
                    borderLeft: `4px solid ${accent}`,
                  }}>
                    <span style={{
                      fontSize: 14, fontWeight: 700, padding: "4px 14px", borderRadius: 14,
                      background: bg, color: accent,
                    }}>
                      {`GRADE: ${crudeGrade}`}
                    </span>
                    <span className="field-hint" style={{ margin: 0 }}>
                      Auto-determined from entered values (IS-6655) ·{" "}
                      {crudeEvaluatedRows.filter(r => r.status === "pass").length}/{crudeEvaluatedRows.length} parameters within A-grade spec
                    </span>
                  </div>
                );
              })()}

              <div className="card">
                <h3>Remarks</h3>
                <textarea placeholder="Additional observations…" value={remarks}
                  onChange={e => setRemarks(e.target.value)} rows={3} />
              </div>

              <button className="btn btn-primary" type="button"
                disabled={submitting || loadingDefs} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Save QC Results"}
              </button>
            </>
          )}
        </>
      )}

      {/* ── A-20/1 Oil QC ── */}
      {isA20_1 && qcRmType === "oil" && (
        <div className="card">
          <h3>Oil QC</h3>

          <label>Batch Number *</label>
          <input type="text" placeholder="e.g. OIL-260824-001"
            value={oilBatchNumber} onChange={e => setOilBatchNumber(e.target.value)} />

          <h3 style={{ marginTop: 16 }}>Test Results</h3>
          <p className="field-hint" style={{ marginBottom: 12 }}>
            Each parameter shows its spec and pass/fail. Viscosity is recorded
            for report only (no limit).
          </p>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <label>Appearance</label>
              <input type="text" placeholder="Clear & Bright"
                value={oilAppearance} onChange={e => setOilAppearance(e.target.value)} />
            </div>
            <div style={{ flex: "0 0 auto", minWidth: 150, paddingBottom: 2 }}>
              <SpecBadge specText="Clear &amp; Bright" status={oilAppearanceStatus} />
            </div>
          </div>

          <label style={{ marginTop: 12 }}>Density</label>
          <div className="row2">
            <div>
              <label>Mass of sample, M (g)</label>
              <input type="number" step="any" placeholder="0"
                value={oilMass} onChange={e => setOilMass(e.target.value)} />
            </div>
            <div>
              <label>Volume of sample, V (mL)</label>
              <input type="number" step="any" placeholder="0"
                value={oilVolume} onChange={e => setOilVolume(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 4, display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <label>Density = M/V (g/mL)</label>
              <input type="text" readOnly value={oilDensity}
                style={{ background: "var(--ok-soft)", fontWeight: 600 }}
                placeholder="Auto-calculated" />
            </div>
            <div style={{ flex: "0 0 auto", minWidth: 150, paddingBottom: 2 }}>
              <SpecBadge specText={`${OIL_DENSITY_MIN.toFixed(3)}–${OIL_DENSITY_MAX.toFixed(3)}`} status={oilDensityStatus} />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <label>Viscosity</label>
              <input type="number" step="any" placeholder="Viscosity value"
                value={oilViscosity} onChange={e => setOilViscosity(e.target.value)} />
            </div>
            <div style={{ flex: "0 0 auto", minWidth: 150, paddingBottom: 2 }}>
              <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--ink-soft)" }}>
                Spec: <strong>Report</strong>
                <div>—</div>
              </div>
            </div>
          </div>

          {/* Overall oil pass/fail banner */}
          {oilOverallStatus !== "none" && (
            <div className="card" style={{
              marginTop: 16, display: "flex", alignItems: "center", gap: 12,
              borderLeft: `4px solid ${oilOverallStatus === "pass" ? "var(--ok)" : "#c0392b"}`,
            }}>
              <span style={{
                fontSize: 14, fontWeight: 700, padding: "4px 14px", borderRadius: 14,
                background: oilOverallStatus === "pass" ? "var(--ok-soft)" : "#fde8e8",
                color: oilOverallStatus === "pass" ? "var(--ok)" : "#c0392b",
              }}>
                {oilOverallStatus === "pass" ? "OVERALL: PASS" : "OVERALL: FAIL"}
              </span>
              <span className="field-hint" style={{ margin: 0 }}>
                {oilEvaluated.filter(s => s === "pass").length}/{oilEvaluated.length} parameters within spec
              </span>
            </div>
          )}

          <button className="btn btn-primary" type="button"
            disabled={oilSubmitting}
            onClick={async () => {
              if (!user || !activeFactory) { showToast("Session error.", true); return; }
              if (!oilBatchNumber.trim()) { showToast("Batch number required.", true); return; }

              setOilSubmitting(true);
              try {
                // Find the batch by number
                const { data: batchRow } = await supabase
                  .from("batches")
                  .select("id")
                  .eq("factory_id", activeFactory.id)
                  .eq("batch_number", oilBatchNumber.trim())
                  .maybeSingle();

                let bId = batchRow?.id;
                if (!bId) {
                  // Create batch
                  const { data: nb, error: be } = await supabase.from("batches").insert({
                    batch_number: oilBatchNumber.trim(),
                    factory_id: activeFactory.id,
                    material_id: null, product_id: null,
                    batch_type: "rm",
                    production_date: new Date().toISOString().slice(0, 10),
                    quantity: null, unit: "kg",
                    source_batch_id: null, created_by: user.id,
                  }).select("id").single();
                  if (be || !nb) { showToast("Could not create batch: " + (be?.message ?? ""), true); return; }
                  bId = nb.id;
                }

                const testResults: Record<string, string | number> = {};
                if (oilAppearance) testResults["appearance"] = oilAppearance;
                if (oilMass) testResults["mass_g"] = parseFloat(oilMass);
                if (oilVolume) testResults["volume_ml"] = parseFloat(oilVolume);
                if (oilDensity) testResults["density_g_ml"] = parseFloat(oilDensity);
                if (oilViscosity) testResults["viscosity"] = parseFloat(oilViscosity);
                // Persist the spec pass/fail result so it flows to email + sheet.
                const oilResult = oilOverallStatus === "pass" ? "PASS"
                  : oilOverallStatus === "fail" ? "FAIL" : "";
                if (oilResult) testResults["spec_result"] = oilResult;

                const { data: oilRow, error } = await supabase.from("rm_qc").insert({
                  batch_id: bId,
                  factory_id: activeFactory.id,
                  material_id: null,
                  chemist_id: user.id,
                  test_date: new Date().toISOString().slice(0, 10),
                  appearance: oilAppearance || null,
                  appearance_ok: null,
                  test_results: testResults,
                  remarks: null,
                }).select("id").single();

                if (error || !oilRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
                // Fire-and-forget: generate + email the incoming-inspection report.
                void notifyReport({ source: "rm_qc", recordId: oilRow.id });

                void notifyQcFinalized({
                  sourceTable:   "rm_qc",
                  sourceRecordId: oilRow.id,
                  factoryId:     activeFactory.id,
                  batchId:       bId,
                  overallResult: "pending",
                  testDate:      new Date().toISOString().slice(0, 10),
                  testResults:   testResults,
                  extra:         { material_name: "Oil", appearance: oilAppearance || null },
                });

                // Fire-and-forget email
                const oilNowISO = new Date().toISOString();
                const { subject: oilQcSubj, html: oilQcHtml } = buildRmQcEmail({
                  materialName:    "Oil",
                  batchNumber:     oilBatchNumber.trim(),
                  testDate:        oilNowISO.slice(0, 10),
                  grade:           oilResult || null,   // PASS / FAIL vs oil spec
                  testResults,
                  remarks:         null,
                  submittedByName: profile?.full_name ?? "—",
                  submittedAt:     oilNowISO,
                });
                void notifyEvent({
                  eventType: "lab_qc_rm_qc",
                  subject: oilQcSubj,
                  html: oilQcHtml,
                  factoryId: activeFactory.id,
                  referenceId: oilRow.id,
                  sheetData: {
                    type: "append",
                    target: "lab",
                    tab: "RM QC",
                    values: [
                      oilRow.id,
                      "Oil",
                      oilBatchNumber.trim(),
                      oilNowISO.slice(0, 10),
                      null,      // chemist — not collected for oil QC
                      oilResult, // grade column carries the oil PASS/FAIL verdict
                      JSON.stringify(testResults),
                      null,  // remarks — not collected for oil QC
                      profile?.full_name ?? null,
                      oilNowISO,
                      activeFactory.id,
                    ],
                  },
                });

                showToast("Oil QC saved ✓");
                setOilBatchNumber(""); setOilAppearance("");
                setOilMass(""); setOilVolume(""); setOilViscosity("");
                draft.clear();
              } catch { showToast("Network error.", true); }
              finally { setOilSubmitting(false); }
            }}
            style={{ marginTop: 12 }}>
            {oilSubmitting ? "Saving…" : "Save Oil QC"}
          </button>
        </div>
      )}

      {/* ── Sulphur Powder: cross-factory QC lookup (A-20 only) ── */}
      {isSulphurPowder && (
        <div className="card">
          <h3>Sulphur Powder QC</h3>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Sulphur Powder QC is performed at Factory A-20/1.
            Enter the batch number to retrieve the finalized QC record.
          </div>

          <label>Batch Number *</label>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              type="text"
              placeholder="e.g. SP-260824-001"
              value={spBatchSearch}
              onChange={e => { setSpBatchSearch(e.target.value); setSpImport(null); setSpNotFound(false); setSpImportedBatchId(null); }}
              onKeyDown={e => e.key === "Enter" && searchSulphurQc()}
              style={{ flex: "1 1 auto", width: "auto", minWidth: 0 }}
            />
            <button
              className="btn btn-secondary"
              type="button"
              disabled={spSearching}
              onClick={searchSulphurQc}
              // .btn is width:100% globally; override so it sizes to its label
              // and lets the input take the remaining width in this flex row.
              style={{ flex: "0 0 auto", width: "auto", whiteSpace: "nowrap" }}
            >
              {spSearching ? "Searching…" : "Look up"}
            </button>
          </div>

          {/* Found */}
          {spImport && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                padding: "10px 14px",
                background: "var(--ok-soft)",
                border: "1px solid var(--ok)",
                borderRadius: 8,
                marginBottom: 12,
              }}>
                <div style={{ fontWeight: 700, color: "var(--ok)", marginBottom: 4 }}>
                  ✓ Source QC found
                </div>
                <div style={{ fontSize: 13 }}>
                  <strong>Source:</strong> {spImport.source_factory}<br />
                  <strong>Material:</strong> {spImport.material ?? "Sulphur Powder"}<br />
                  <strong>Batch:</strong> {spImport.source_batch_number}<br />
                  <strong>QC Status:</strong>{" "}
                  <span style={{
                    fontWeight: 700,
                    color: spImport.test_result === "pass" ? "var(--ok)" : "var(--warn)",
                  }}>
                    {(spImport.test_result ?? spImport.qc_status ?? "—").toUpperCase()}
                  </span><br />
                  <strong>QC Date:</strong> {spImport.tested_at ? new Date(spImport.tested_at).toLocaleDateString("en-IN") : "—"}<br />
                  <strong>Received at A-20:</strong> {new Date(spImport.transferred_at).toLocaleDateString("en-IN")}<br />
                  <strong>Source QC ID:</strong> <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{spImport.id}</span>
                </div>
              </div>

              {/* Full payload read-only */}
              <details>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--clay)", marginBottom: 6 }}>
                  View QC Details (read-only)
                </summary>
                <textarea
                  readOnly
                  rows={10}
                  value={JSON.stringify(spImport.payload, null, 2)}
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: 11, width: "100%",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 6, padding: 10,
                    resize: "vertical",
                  }}
                />
              </details>

              <div className="field-hint" style={{ marginTop: 8, color: "var(--ok)" }}>
                This QC record is read-only. It was finalized by Factory A-20/1 and cannot be modified here.
              </div>

              {/* Register the batch locally in A-20 so it is usable downstream */}
              <div style={{ marginTop: 12 }}>
                {spImportedBatchId ? (
                  <div style={{
                    padding: "8px 12px", background: "var(--ok-soft)",
                    border: "1px solid var(--ok)", borderRadius: 8,
                    fontSize: 13, color: "var(--ok)", fontWeight: 600,
                  }}>
                    ✓ This batch is registered in A-20 (batch number {spImport.source_batch_number}).
                    It can now be used in A-20 Product QC / production.
                  </div>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={spImporting}
                      onClick={importSulphurBatch}
                    >
                      {spImporting ? "Registering…" : "Register batch in A-20"}
                    </button>
                    <div className="field-hint" style={{ marginTop: 4 }}>
                      Creates a Sulphur Powder batch record in A-20 under this batch number,
                      linked to the A-20/1 source QC above.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Not found */}
          {spNotFound && (
            <div style={{
              marginTop: 12, padding: "10px 14px",
              background: "#fff3e0",
              border: "1px solid var(--warn)",
              borderRadius: 8, fontSize: 13, color: "var(--warn)",
            }}>
              Source QC not found for batch <strong>&ldquo;{spBatchSearch}&rdquo;</strong>.
              Verify the batch number or wait for QC synchronization from A-20/1.
            </div>
          )}
        </div>
      )}

      {/* ── Standard dynamic QC form for non-Sulphur-Powder materials (A-20 only) ── */}
      {!isA20_1 && materialId && !isSulphurPowder && (
        <>
          {/* Batch selector (shows invoice number for A-20/1 crude sulphur) */}
          <div className="card">
            <label>{isA20_1 ? "Invoice Number" : "Batch"} *</label>
            {loadingBatches ? <div className="field-hint">Loading…</div>
              : batches.length === 0 ? (
                <div className="field-hint" style={{ color: "var(--warn)" }}>
                  No receipts found.{" "}
                  <Link href="/lab-qc/rm-receipt" style={{ color: "var(--clay)" }}>Create a receipt first →</Link>
                </div>
              ) : (
                <select value={batchId} onChange={e => setBatchId(e.target.value)}>
                  <option value="">{isA20_1 ? "— Select invoice —" : "— Select batch —"}</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number}{b.lot_number ? ` · Lot ${b.lot_number}` : ""} · {b.production_date}
                    </option>
                  ))}
                </select>
              )}
          </div>

          {batchId && (
            <>
              <div className="card">
                <h3>Test Details</h3>
                <div className="row2">
                  <div>
                    <label>Test Date *</label>
                    <DateField value={testDate} onChange={setTestDate} />
                  </div>
                  <div>
                    <label>Chemist</label>
                    <input type="text" readOnly value={chemistName || "—"}
                      style={{ background: "var(--ok-soft)", fontWeight: 600 }} />
                    <p className="field-hint" style={{ marginTop: 4 }}>From your login</p>
                  </div>
                </div>
              </div>

              {loadingDefs ? (
                <div className="card"><div className="empty">Loading test fields…</div></div>
              ) : testDefs.length === 0 ? (
                <div className="card">
                  <div className="field-hint">
                    No test definitions found for {selectedMaterial?.name}.
                    Run migration 003_a20_qc_seed.sql in the Supabase SQL editor.
                  </div>
                </div>
              ) : (
                <div className="card">
                  <h3>Test Results — {selectedMaterial?.name}</h3>
                  <div className="field-hint" style={{ marginBottom: 12 }}>
                    All test fields are optional unless marked *.
                    Leave blank if the test was not performed.
                    Green fields are auto-calculated from the values you enter.
                  </div>
                  {testDefs.map(def => (
                    <QcFieldRenderer
                      key={def.id}
                      def={def}
                      value={values[def.test_key] ?? ""}
                      onChange={handleChange}
                      onBlur={(key, val) => audit.record(key, val)}
                      photoUploadProps={photoProps}
                    />
                  ))}
                </div>
              )}

              <div className="card">
                <h3>Remarks</h3>
                <textarea placeholder="Additional observations…" value={remarks}
                  onChange={e => setRemarks(e.target.value)} rows={3} />
              </div>

              <button className="btn btn-primary" type="button"
                disabled={submitting || loadingDefs} onClick={handleSubmit}>
                {submitting ? "Saving…" : "Save QC Results"}
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
