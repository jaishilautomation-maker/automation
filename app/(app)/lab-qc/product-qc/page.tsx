"use client";

// =============================================================================
// Lab QC — Product QC (dynamic per-product forms)
//
// Meeting fixes (023_qc_form_meeting_fixes.sql, 4 Nov 2026):
//   A1  Manufacturing Date added alongside Testing Date.
//   A2  "Analysed By" dropdown replicates batch-analysis pattern.
//   A3  sample_taken_by deactivated in DB — no code change needed.
//   A4  lot_batch_number / lot_batch_quantity deactivated in DB — batch
//       number entered once in the header; all products read from there.
//   A5  Section headers rendered between field groups (section_label column).
//   A6  Calculated results already follow inputs via sort_order (migration 022);
//       calcium_content sort_order fixed in migration 023.
//   A7  Burette V1/V2 warning: if V2 < V1 show inline message, suppress result.
//   A9  NumericInput used by QcFieldRenderer for all number fields — no spinner.
//   A10 Live spec check: specs loaded from product_qc_specs table (seeded from
//       COA PDFs in migration 025); pass (✓) / fail (✗) shown beside each field.
//       Neutral "No spec" when no row for a parameter. needs_verification rows
//       show a ⚠ icon beside the spec limit.
//   111% guard: suspensibility shows "—" until all inputs valid; warns if >100.
//   pH: placeholder "0.00" to match pH meter 2 d.p. display.
//
// Flow:
//   1. Pick product (5 A-20 Lab QC products)
//   2. For phase-aware products (Sulphur SC, Zinc SC): pick Phase A or B
//   3. Enter batch number (top-level, non-blocking background lookup)
//   4. Dynamic form renders from qc_test_definitions sorted by sort_order,
//      grouped by section_label for headers.
//   5. Calculated fields update live; submit = INSERT or UPDATE.
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
import { flushPhotoUploads, PHOTO_UPLOAD_FAILED_MSG } from "@/lib/upload";
import QcFieldRenderer, { type PhotoUploadProps } from "@/components/QcFieldRenderer";
import type { PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { Product, QcTestDefinition, ProductQc, QcPhase } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { notifyReport } from "@/lib/reports/notify-report-client";
import { buildProductQcEmail } from "@/lib/notifications/lab-qc-emails";
import { ANALYSIS_BY_OPTIONS, ANALYSIS_BY_KEY } from "@/lib/lab-qc/analysis-by";

interface BatchOption {
  id: string;
  batch_number: string;
  lot_number: string | null;
  production_date: string;
}

// Product spec row from product_qc_specs table
interface SpecRow {
  test_key: string;
  parameter_label: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  needs_verification: boolean;
}

// Products that have Phase A + B
const PHASE_AWARE_CODES = ["SULPHUR_SC", "ZINC_SC"];

// Calculated fields that support "Enter manually" toggle
const MANUAL_OVERRIDE_KEYS = new Set(["calcium_content", "boron_content"]);

// Burette pair definitions: [v1_key, v2_key, result_key]
// When V2 < V1 we suppress the result and show an inline warning.
const BURETTE_PAIRS: [string, string, string][] = [
  ["naoh_v1",          "naoh_v2",          "boron_content"],
  ["content_iodine_blank", "content_iodine_vol", "sulphur_content"],   // Ziddi B2>B1
  ["zc_v1_with_cyanide", "zc_v2_without_cyanide", "zinc_content"],      // Zinc SC B
  ["v1_with_cyanide",    "v2_without_cyanide",     "zinc_content_a"],   // Zinc SC A
];

// Suspensibility keys that should show ">100" warning
const SUSPENSIBILITY_KEYS = new Set([
  "suspensibility", "sulphur_suspensibility", "suspension",
]);

export default function ProductQcPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // ── Draft autosave ──────────────────────────────────────────────────────
  const pathname = usePathname();
  interface DraftShape {
    productId: string;
    phase: QcPhase;
    batchId: string;
    directBatchNumber: string;
    directLotNumber: string;
    values: Record<string, string>;
    testDate: string;
    mfgDate: string;
    analysisBy: string;
    remarks: string;
  }
  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, activeFactory?.id, user?.id),
  );
  const d0 = draft.restored;
  const [initialDraft] = useState<DraftShape | null>(() => draft.restored);

  // Step 1: product selection
  const [products, setProducts]         = useState<Product[]>([]);
  const [productId, setProductId]       = useState(d0?.productId ?? "");
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Step 2: phase selection (for phase-aware products)
  const [phase, setPhase]               = useState<QcPhase>(d0?.phase ?? "none");

  // Step 3: batch selection
  const [batches, setBatches]           = useState<BatchOption[]>([]);
  const [batchId, setBatchId]           = useState(d0?.batchId ?? "");

  // A-20 direct batch entry
  const [directBatchNumber, setDirectBatchNumber] = useState(d0?.directBatchNumber ?? "");
  const [directLotNumber, setDirectLotNumber]     = useState(d0?.directLotNumber ?? "");
  const [batchLookupState, setBatchLookupState] = useState<
    "idle" | "searching" | "found" | "not_found"
  >("idle");
  const [lookedUpBatch, setLookedUpBatch] = useState<BatchOption | null>(null);
  const batchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Test definitions for selected product + phase
  const [testDefs, setTestDefs]         = useState<QcTestDefinition[]>([]);
  const [loadingDefs, setLoadingDefs]   = useState(false);

  // Existing QC record
  const [existingRecord, setExistingRecord] = useState<ProductQc | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  // Form state
  const [values, setValues]             = useState<Record<string, string>>({});
  const [testDate, setTestDate]         = useState(d0?.testDate ?? new Date().toISOString().slice(0, 10));
  const [mfgDate, setMfgDate]           = useState(d0?.mfgDate   ?? new Date().toISOString().slice(0, 10));
  const [analysisBy, setAnalysisBy]     = useState(d0?.analysisBy ?? "");
  const [remarks, setRemarks]           = useState(d0?.remarks ?? "");
  const [submitting, setSubmitting]     = useState(false);
  const uploaderRefs = useRef<Record<string, PhotoUploaderHandle | null>>({});

  // Per-field warnings
  const [sieveWarnings, setSieveWarnings]   = useState<Record<string, string>>({});
  const [buretteWarnings, setBuretteWarnings] = useState<Record<string, string>>({});

  // A10: product specs for pass/fail indicators
  const [specs, setSpecs] = useState<SpecRow[]>([]);

  // Autosave
  const draftSave = draft.save;
  useEffect(() => {
    draftSave({
      productId, phase, batchId, directBatchNumber, directLotNumber,
      values, testDate, mfgDate, analysisBy, remarks,
    });
  }, [productId, phase, batchId, directBatchNumber, directLotNumber,
      values, testDate, mfgDate, analysisBy, remarks, draftSave]);

  const selectedProduct = products.find(p => p.id === productId);
  const isPhaseAware    = PHASE_AWARE_CODES.includes(selectedProduct?.code ?? "");
  const isA20 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20";

  const A20_PRODUCT_CODES = ["SULPHUR_SC", "ZINC_SC", "ZIDDI", "LIQUID_CALCIUM", "LIQUID_BORON"];

  // ── Load products ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = supabase.from("products").select("*").eq("is_active", true);
    const finalQ = isA20
      ? q.in("code", A20_PRODUCT_CODES)
      : q.eq("is_trial_only", false);
    finalQ.order("name")
      .then(({ data }) => {
        setProducts((data ?? []) as Product[]);
        setLoadingProducts(false);
      });
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset on product change ───────────────────────────────────────────────
  useEffect(() => {
    setPhase(isPhaseAware ? "A" : "none");
    setBatchId("");
    setDirectBatchNumber("");
    setDirectLotNumber("");
    setBatchLookupState("idle");
    setLookedUpBatch(null);
    setExistingRecord(null);
    setValues({});
    setRemarks("");
    setSieveWarnings({});
    setBuretteWarnings({});
  }, [productId, isPhaseAware]);

  // ── Load batches (A-20/1) ─────────────────────────────────────────────────
  useEffect(() => {
    if (isA20) { setBatches([]); return; }
    if (!productId || !activeFactory) { setBatches([]); return; }

    const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";
    const selectedCode = products.find(p => p.id === productId)?.code;
    const isSulphurProduct = selectedCode === "SULPHUR_SC" || selectedCode === "SULPHUR_POWDER";

    if (isA20_1 && isSulphurProduct) {
      supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("batch_type", "fg")
        .order("production_date", { ascending: false })
        .limit(50)
        .then(({ data }) => setBatches((data ?? []) as BatchOption[]));
    } else {
      supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("product_id", productId)
        .order("production_date", { ascending: false })
        .limit(50)
        .then(({ data }) => setBatches((data ?? []) as BatchOption[]));
    }
  }, [productId, activeFactory, supabase, products]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load test definitions ─────────────────────────────────────────────────
  useEffect(() => {
    if (!productId) { setTestDefs([]); setValues({}); return; }

    setLoadingDefs(true);
    supabase
      .from("qc_test_definitions")
      .select("*")
      .eq("product_id", productId)
      .eq("phase", phase)
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const defs = (data ?? []) as QcTestDefinition[];
        setTestDefs(defs);
        const init: Record<string, string> = {};
        defs.forEach(d => { init[d.test_key] = ""; });
        setValues({ ...init, ...(initialDraft?.values ?? {}) });
        setLoadingDefs(false);
      });
  }, [productId, phase, supabase, initialDraft]);

  // ── A10: Load product specs for pass/fail indicators ─────────────────────
  useEffect(() => {
    if (!productId || !selectedProduct) { setSpecs([]); return; }
    const code = selectedProduct.code;
    const phaseKey = phase === "none" ? "none" : phase;
    supabase
      .from("product_qc_specs")
      .select("test_key, parameter_label, unit, min_value, max_value, needs_verification")
      .eq("product_code", code)
      .eq("phase", phaseKey)
      .eq("is_active", true)
      .then(({ data }) => setSpecs((data ?? []) as SpecRow[]));
  }, [productId, phase, selectedProduct, supabase]);

  // ── A-20: silent background batch lookup ─────────────────────────────────
  useEffect(() => {
    if (!isA20 || !productId || !activeFactory) return;
    const bn = directBatchNumber.trim();
    if (!bn) {
      setBatchLookupState("idle");
      setLookedUpBatch(null);
      setBatchId("");
      return;
    }
    setBatchLookupState("searching");
    if (batchDebounceRef.current) clearTimeout(batchDebounceRef.current);
    batchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("batches")
        .select("id, batch_number, lot_number, production_date")
        .eq("factory_id", activeFactory.id)
        .eq("product_id", productId)
        .eq("batch_number", bn)
        .maybeSingle();
      if (data) {
        setLookedUpBatch(data as BatchOption);
        setBatchId(data.id);
        setBatchLookupState("found");
      } else {
        setLookedUpBatch(null);
        setBatchId("");
        setBatchLookupState("not_found");
      }
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directBatchNumber, productId, activeFactory]);

  // ── Load existing record ──────────────────────────────────────────────────
  useEffect(() => {
    if (!batchId || !productId) { setExistingRecord(null); return; }

    setCheckingExisting(true);
    supabase
      .from("product_qc")
      .select("*")
      .eq("batch_id", batchId)
      .eq("product_id", productId)
      .eq("phase", phase)
      .maybeSingle()
      .then(({ data }) => {
        const rec = data as ProductQc | null;
        setExistingRecord(rec);
        if (rec) {
          setTestDate(rec.test_date);
          setMfgDate(rec.mfg_date ?? new Date().toISOString().slice(0, 10));
          setAnalysisBy(
            (rec.test_results?.[ANALYSIS_BY_KEY] as string | undefined) ?? rec.analysed_by ?? ""
          );
          setRemarks(rec.remarks ?? "");
          const prefill: Record<string, string> = {};
          const tr = (rec.test_results ?? {}) as Record<string, unknown>;
          testDefs.forEach(d => {
            const v = tr[d.test_key];
            prefill[d.test_key] = v !== undefined && v !== null ? String(v) : "";
          });
          testDefs
            .filter(d => d.is_calculated && d.formula)
            .forEach(d => {
              if (prefill[d.test_key + "_manual_mode"] === "1") return;
              const result = evalFormula(d.formula!, prefill, d.unit);
              if (result !== null) prefill[d.test_key] = String(result);
            });
          setValues(prefill);
        } else {
          const init: Record<string, string> = {};
          testDefs.forEach(d => { init[d.test_key] = ""; });
          setValues(init);
          setRemarks("");
        }
        setCheckingExisting(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, productId, phase, supabase]);

  // ── Field change + live recalc ────────────────────────────────────────────
  const SIEVE_PAIRS: [string, string][] = [
    ["wet_sieve200_residue",  "wet_sieve200_sample"],
    ["wet_sieve325_residue",  "wet_sieve325_sample"],
    ["sieve100_retained",     "sieve100_sample"],
    ["sieve200_retained",     "sieve200_sample"],
    ["sieve325_retained",     "sieve325_sample"],
  ];

  const handleChange = useCallback(
    (key: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: val };

        testDefs
          .filter(d => d.is_calculated && d.formula)
          .forEach(d => {
            if (next[d.test_key + "_manual_mode"] === "1") return;

            // A7: V2 < V1 guard — suppress result and record warning
            const burettePair = BURETTE_PAIRS.find(([, , rk]) => rk === d.test_key);
            if (burettePair) {
              const [v1k, v2k] = burettePair;
              const v1 = parseFloat(next[v1k] ?? "");
              const v2 = parseFloat(next[v2k] ?? "");
              if (!isNaN(v1) && !isNaN(v2) && v2 < v1) {
                next[d.test_key] = "";
                // Warning handled in buretteWarnings state below
                return;
              }
            }

            const result = evalFormula(d.formula!, next, d.unit);
            next[d.test_key] = result !== null ? String(result) : "";
          });

        return next;
      });

      // Sieve retained > sample warnings
      setSieveWarnings(prev => {
        const next = { ...prev };
        for (const [retKey, sampleKey] of SIEVE_PAIRS) {
          if (key !== retKey && key !== sampleKey) continue;
          setValues(vals => {
            const retained = parseFloat(key === retKey ? val : (vals[retKey] ?? ""));
            const sample   = parseFloat(key === sampleKey ? val : (vals[sampleKey] ?? ""));
            if (!isNaN(retained) && !isNaN(sample) && retained > sample) {
              next[retKey] = `Retained (${retained} g) > Sample (${sample} g) — check values`;
            } else {
              delete next[retKey];
            }
            return vals;
          });
        }
        return next;
      });

      // A7: Burette V2 < V1 warnings
      setBuretteWarnings(prev => {
        const next = { ...prev };
        setValues(vals => {
          const merged = { ...vals, [key]: val };
          for (const [v1k, v2k, rk] of BURETTE_PAIRS) {
            if (key !== v1k && key !== v2k) continue;
            const v1 = parseFloat(merged[v1k] ?? "");
            const v2 = parseFloat(merged[v2k] ?? "");
            if (!isNaN(v1) && !isNaN(v2) && v2 < v1) {
              next[rk] = `V2 (${v2}) is less than V1 (${v1}) — check burette readings`;
            } else {
              delete next[rk];
            }
          }
          return vals;
        });
        return next;
      });
    },
    [testDefs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!user || !activeFactory)       { showToast("Session error — refresh.", true); return; }
    if (!productId)                    { showToast("Select a product.", true); return; }
    if (!isA20 && !batchId)            { showToast("Select a batch.", true); return; }
    if (isA20 && !directBatchNumber.trim()) { showToast("Enter a batch number.", true); return; }

    setSubmitting(true);
    try {
      const effectiveBatchId = batchId || null;
      const effectiveBatchNo = directBatchNumber.trim();

      if (isA20) {
        let dupQuery = supabase
          .from("product_qc")
          .select("id")
          .eq("product_id", productId)
          .eq("phase", phase)
          .eq("factory_id", activeFactory.id);

        if (effectiveBatchId) {
          dupQuery = dupQuery.eq("batch_id", effectiveBatchId);
        } else {
          dupQuery = dupQuery.eq("batch_no", effectiveBatchNo).is("batch_id", null);
        }

        const { data: dup } = await dupQuery.maybeSingle();
        if (dup && !existingRecord) {
          showToast("A QC record already exists for this batch, product and phase.", true);
          setSubmitting(false);
          return;
        }
      }

      const testResults: Record<string, number | string | boolean> = {};
      testDefs.forEach(d => {
        const raw = values[d.test_key];
        if (raw === "" || raw === undefined) return;
        if (d.input_type === "number" && !(d.is_calculated && values[d.test_key + "_manual_mode"] === "1")) {
          const n = parseFloat(raw);
          if (!isNaN(n)) testResults[d.test_key] = n;
        } else if (d.input_type === "boolean") {
          testResults[d.test_key] = raw === "true";
        } else {
          testResults[d.test_key] = raw;
        }
        const manualKey = d.test_key + "_manual_mode";
        if (values[manualKey]) testResults[manualKey] = values[manualKey];
        const otherKey = d.test_key + "_other";
        if (values[otherKey]) testResults[otherKey] = values[otherKey];
      });

      // Store analysed_by in test_results (JSONB) for consistency with batch-analysis
      if (analysisBy) testResults[ANALYSIS_BY_KEY] = analysisBy;

      const appearanceOkRaw = values["appearance_ok"];
      const appearanceOk =
        appearanceOkRaw === "true" ? true :
        appearanceOkRaw === "false" ? false : null;

      if (existingRecord) {
        const { error } = await supabase
          .from("product_qc")
          .update({
            test_date:     testDate,
            mfg_date:      mfgDate || null,
            analysed_by:   analysisBy || null,
            appearance:    values["colour_physical_state"] ?? null,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
            updated_by:    user.id,
          })
          .eq("id", existingRecord.id);

        if (error) { showToast("Update failed: " + error.message, true); return; }
        if (!await flushPhotoUploads(Object.values(uploaderRefs.current), existingRecord.id)) showToast(PHOTO_UPLOAD_FAILED_MSG, true);

        const { data: fresh } = await supabase
          .from("product_qc").select("overall_result").eq("id", existingRecord.id).maybeSingle();
        void notifyQcFinalized({
          sourceTable:   "product_qc",
          sourceRecordId: existingRecord.id,
          factoryId:     activeFactory.id,
          batchId:       existingRecord.batch_id ?? existingRecord.batch_no ?? "",
          phase,
          overallResult: fresh?.overall_result ?? (appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending"),
          testDate,
          testResults,
          extra: { product_name: selectedProduct?.name ?? null, appearance: values["colour_physical_state"] ?? null, remarks: remarks.trim() || null },
        });

        if (isA20) void notifyReport({ source: "product_qc", recordId: existingRecord.id });

        const pqcUpdISO = new Date().toISOString();
        const { subject: pqcUpdSubj, html: pqcUpdHtml } = buildProductQcEmail({
          productName:     selectedProduct?.name ?? "Product",
          batchNumber:     batches.find(b => b.id === existingRecord.batch_id)?.batch_number,
          phase,
          testDate,
          appearance:      values["colour_physical_state"] ?? null,
          appearanceOk,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     pqcUpdISO,
          isUpdate:        true,
        });
        void notifyEvent({
          eventType: "lab_qc_product_qc",
          subject: pqcUpdSubj,
          html: pqcUpdHtml,
          factoryId: activeFactory.id,
          referenceId: existingRecord.id,
          sheetData: {
            type: "append",
            target: "lab",
            tab: "Product QC",
            values: [
              existingRecord.id, selectedProduct?.name ?? null,
              batches.find(b => b.id === existingRecord.batch_id)?.batch_number ?? null,
              phase, testDate, mfgDate || null, analysisBy || null,
              values["colour_physical_state"] ?? null, appearanceOk,
              "pending", JSON.stringify(testResults),
              remarks.trim() || null, profile?.full_name ?? null,
              pqcUpdISO, true, activeFactory.id,
            ],
          },
        });

        showToast("Product QC updated ✓");
        draft.clear();
      } else {
        const { data: newRow, error } = await supabase
          .from("product_qc")
          .insert({
            batch_id:      effectiveBatchId,
            batch_no:      isA20 ? effectiveBatchNo : undefined,
            factory_id:    activeFactory.id,
            product_id:    productId,
            phase,
            chemist_id:    user.id,
            test_date:     testDate,
            mfg_date:      mfgDate || null,
            analysed_by:   analysisBy || null,
            appearance:    values["colour_physical_state"] ?? null,
            appearance_ok: appearanceOk,
            test_results:  testResults,
            remarks:       remarks.trim() || null,
          })
          .select("id")
          .single();

        if (error || !newRow) { showToast("Could not save: " + (error?.message ?? "unknown"), true); return; }
        if (!await flushPhotoUploads(Object.values(uploaderRefs.current), newRow.id)) showToast(PHOTO_UPLOAD_FAILED_MSG, true);

        const { data: fresh } = await supabase
          .from("product_qc").select("overall_result").eq("id", newRow.id).maybeSingle();
        void notifyQcFinalized({
          sourceTable:   "product_qc",
          sourceRecordId: newRow.id,
          factoryId:     activeFactory.id,
          batchId:       effectiveBatchId ?? effectiveBatchNo,
          phase,
          overallResult: fresh?.overall_result ?? (appearanceOk === true ? "pass" : appearanceOk === false ? "fail" : "pending"),
          testDate,
          testResults,
          extra: { product_name: selectedProduct?.name ?? null, appearance: values["colour_physical_state"] ?? null, remarks: remarks.trim() || null },
        });

        if (isA20) void notifyReport({ source: "product_qc", recordId: newRow.id });

        const pqcInsISO = new Date().toISOString();
        const batchNum = isA20
          ? (lookedUpBatch?.batch_number ?? effectiveBatchNo)
          : (batches.find(b => b.id === effectiveBatchId)?.batch_number ?? null);
        const { subject: pqcInsSubj, html: pqcInsHtml } = buildProductQcEmail({
          productName:     selectedProduct?.name ?? "Product",
          batchNumber:     batchNum,
          phase,
          testDate,
          appearance:      values["colour_physical_state"] ?? null,
          appearanceOk,
          testResults:     testResults as Record<string, unknown>,
          remarks:         remarks.trim() || null,
          submittedByName: profile?.full_name ?? "—",
          submittedAt:     pqcInsISO,
          isUpdate:        false,
        });
        void notifyEvent({
          eventType: "lab_qc_product_qc",
          subject: pqcInsSubj,
          html: pqcInsHtml,
          factoryId: activeFactory.id,
          referenceId: newRow.id,
          sheetData: {
            type: "append",
            target: "lab",
            tab: "Product QC",
            values: [
              newRow.id, selectedProduct?.name ?? null, batchNum,
              phase, testDate, mfgDate || null, analysisBy || null,
              values["colour_physical_state"] ?? null, appearanceOk,
              "pending", JSON.stringify(testResults),
              remarks.trim() || null, profile?.full_name ?? null,
              pqcInsISO, false, activeFactory.id,
            ],
          },
        });

        showToast("Product QC saved ✓");
        setBatchId("");
        setDirectBatchNumber("");
        setDirectLotNumber("");
        setBatchLookupState("idle");
        setLookedUpBatch(null);
        setExistingRecord(null);
        setSieveWarnings({});
        setBuretteWarnings({});
        setValues(prev => Object.fromEntries(Object.keys(prev).map(k => [k, ""])));
        setRemarks("");
        setAnalysisBy("");
        draft.clear();
      }
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── A10: Spec lookup helpers (mirrors batch-analysis pattern) ────────────
  const specFor = useCallback(
    (key: string): SpecRow | undefined => specs.find(s => s.test_key === key),
    [specs],
  );

  type SpecStatus = "pass" | "fail" | "none";

  const statusFor = useCallback(
    (key: string, rawVal: string): SpecStatus => {
      const spec = specFor(key);
      if (!spec) return "none";
      const v = parseFloat(rawVal);
      if (rawVal === "" || isNaN(v)) return "none";
      if (spec.min_value != null && v < spec.min_value) return "fail";
      if (spec.max_value != null && v > spec.max_value) return "fail";
      return "pass";
    },
    [specFor],
  );

  const specLimitText = useCallback((spec: SpecRow): string => {
    const parts: string[] = [];
    if (spec.min_value != null) parts.push(`≥ ${spec.min_value}`);
    if (spec.max_value != null) parts.push(`≤ ${spec.max_value}`);
    return parts.join(" · ") || "—";
  }, []);

  const buildSpecBadge = useCallback(
    (key: string): React.ReactNode => {
      const spec = specFor(key);
      if (!spec) return null;
      // No limits → neutral "No spec", never "Pass"
      if (spec.min_value == null && spec.max_value == null) {
        return (
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ color: "var(--ink-soft)" }}>{spec.parameter_label}</div>
            <div style={{ color: "var(--ink-soft)", fontWeight: 600 }}>No spec</div>
          </div>
        );
      }
      const raw = values[key] ?? "";
      const st = statusFor(key, raw);
      const color = st === "pass" ? "var(--ok)" : st === "fail" ? "#c0392b" : "var(--ink-soft)";
      const label = st === "pass" ? "✓ Pass" : st === "fail" ? "✗ Fail" : "—";
      return (
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ color: "var(--ink-soft)" }}>
            Spec: <strong>{specLimitText(spec)}{spec.unit ? ` ${spec.unit}` : ""}</strong>
            {spec.needs_verification && (
              <span title="Interim spec from COA — verify against official spec sheet"
                style={{ color: "var(--warn)", marginLeft: 4 }}>⚠</span>
            )}
          </div>
          <div style={{ color, fontWeight: 700, fontSize: 13 }}>{label}</div>
        </div>
      );
    },
    [specFor, statusFor, specLimitText, values],
  );

  // ── Build grouped field sections for rendering (A5) ───────────────────────
  interface FieldSection {
    label: string | null;  // null = no header
    defs: QcTestDefinition[];
  }

  const fieldSections: FieldSection[] = [];
  let currentLabel: string | null | undefined = undefined; // undefined = not started

  for (const def of testDefs) {
    const sl = def.section_label ?? null;
    if (sl !== currentLabel) {
      fieldSections.push({ label: sl, defs: [] });
      currentLabel = sl;
    }
    fieldSections[fieldSections.length - 1].defs.push(def);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      {/* Step 1+2: product + phase */}
      <div className="card">
        <h3>Product QC</h3>

        <label>Product *</label>
        {loadingProducts ? (
          <div className="field-hint">Loading products…</div>
        ) : (
          <select value={productId} onChange={e => { setProductId(e.target.value); setBatchId(""); }}>
            <option value="">— Select product —</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {isPhaseAware && productId && (
          <>
            <label>Phase *</label>
            <div className="chip-group">
              {(["A", "B"] as QcPhase[]).map(ph => (
                <div
                  key={ph}
                  className={`chip${phase === ph ? " selected" : ""}`}
                  onClick={() => { setPhase(ph); setBatchId(""); }}
                >
                  Phase {ph}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Step 3 (A-20): single batch number — no per-product lot_batch_number shown */}
      {isA20 && productId && (
        <div className="card">
          <h3>Batch</h3>
          <label>Batch Number *</label>
          <input
            type="text"
            placeholder="e.g. SSC-260824-001"
            value={directBatchNumber}
            onChange={e => {
              setDirectBatchNumber(e.target.value);
              setBatchLookupState("idle");
            }}
          />
          {batchLookupState === "found" && lookedUpBatch && (
            <div className="field-hint" style={{ color: "var(--ok)", marginTop: 4 }}>
              ✓ Linked to Production Job Card batch · {lookedUpBatch.production_date}
              {lookedUpBatch.lot_number ? ` · Lot ${lookedUpBatch.lot_number}` : ""}
            </div>
          )}
          {batchLookupState === "not_found" && directBatchNumber.trim() && (
            <div className="field-hint" style={{ color: "var(--ink-soft)", marginTop: 4 }}>
              Not linked to a Production Job Card — will save as standalone record.
            </div>
          )}
        </div>
      )}

      {/* Step 3 (A-20/1): batch dropdown */}
      {!isA20 && productId && (
        <div className="card">
          <h3>Batch</h3>
          <label>Batch Number *</label>
          {batches.length === 0 ? (
            <div className="field-hint" style={{ color: "var(--warn)" }}>
              No batches for {selectedProduct?.name ?? "this product"} at {activeFactory?.name}.
            </div>
          ) : (
            <select value={batchId} onChange={e => setBatchId(e.target.value)}>
              <option value="">— Select batch number —</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.batch_number}
                  {b.lot_number ? ` · Lot ${b.lot_number}` : ""}
                  {" · "}{b.production_date}
                </option>
              ))}
            </select>
          )}

          {checkingExisting && <div className="field-hint">Checking for existing record…</div>}

          {batchId && !checkingExisting && existingRecord && (
            <div className="readonly-block" style={{ background: "var(--ok-soft)", color: "var(--ok)", marginTop: 10 }}>
              ✓ A QC record already exists for this batch / phase
              (submitted {new Date(existingRecord.submitted_at).toLocaleDateString("en-IN")}).
              Saving will update it.
            </div>
          )}
        </div>
      )}

      {/* Step 4: form */}
      {productId && (isA20 ? directBatchNumber.trim() !== "" : (batchId && !checkingExisting)) && (
        <>
          {/* A1 + A2: Test Date, Mfg Date, Analysed By in one card */}
          <div className="card">
            <h3>Test Details</h3>
            <div className="row2">
              <div>
                <label>Manufacturing Date *</label>
                <DateField value={mfgDate} onChange={setMfgDate} />
              </div>
              <div>
                <label>Testing Date *</label>
                <DateField value={testDate} onChange={setTestDate} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label>Analysed By</label>
              <select
                value={analysisBy}
                onChange={e => setAnalysisBy(e.target.value)}
              >
                <option value="">— Select chemist —</option>
                {ANALYSIS_BY_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingDefs ? (
            <div className="card"><div className="empty">Loading test fields…</div></div>
          ) : testDefs.length === 0 ? (
            <div className="card">
              <div className="field-hint">
                No test definitions for {selectedProduct?.name ?? "this product"}
                {isPhaseAware ? ` Phase ${phase}` : ""}.
              </div>
            </div>
          ) : (
            <div className="card">
              <h3>
                Test Results — {selectedProduct?.name}
                {isPhaseAware ? ` · Phase ${phase}` : ""}
              </h3>
              <div className="field-hint" style={{ marginBottom: 12 }}>
                Green fields are auto-calculated. Enter input values and they update automatically.
              </div>

              {/* A5: Render fields grouped by section_label */}
              {fieldSections.map((section, si) => (
                <div key={si}>
                  {section.label && (
                    <div style={{
                      margin: "20px 0 10px",
                      padding: "7px 12px",
                      background: "var(--bg-soft)",
                      borderLeft: "4px solid var(--accent)",
                      borderRadius: "0 6px 6px 0",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {section.label}
                      </span>
                    </div>
                  )}
                  {section.defs.map(def => {
                    // Build combined warning badge (sieve + burette)
                    const sieveWarn = sieveWarnings[def.test_key];
                    const buretteWarn = buretteWarnings[def.test_key];

                    // 111% guard: suspensibility >100 warning
                    const isSusp = SUSPENSIBILITY_KEYS.has(def.test_key);
                    const suspResult = isSusp ? parseFloat(values[def.test_key] ?? "") : NaN;
                    const suspWarn = isSusp && !isNaN(suspResult) && suspResult > 100
                      ? `Result ${suspResult.toFixed(2)}% > 100 — check readings`
                      : undefined;

                    // needs_review indicator for interim/unconfirmed formulas
                    const reviewBadge = def.needs_review ? (
                      <div style={{ fontSize: 11, color: "var(--warn)", fontStyle: "italic" }}>
                        ⚠ Formula not yet confirmed — verify result with lab before approving
                      </div>
                    ) : undefined;

                    // A10: spec pass/fail badge (merged with other warnings)
                    const specBadgeEl = buildSpecBadge(def.test_key);

                    const warnBadge = (sieveWarn || buretteWarn || suspWarn || reviewBadge || specBadgeEl) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {specBadgeEl}
                        {sieveWarn && (
                          <div style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600 }}>
                            ⚠ {sieveWarn}
                          </div>
                        )}
                        {buretteWarn && (
                          <div style={{ fontSize: 12, color: "var(--error)", fontWeight: 600 }}>
                            ✗ {buretteWarn}
                          </div>
                        )}
                        {suspWarn && (
                          <div style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600 }}>
                            ⚠ {suspWarn}
                          </div>
                        )}
                        {reviewBadge}
                      </div>
                    ) : undefined;

                    return (
                      <QcFieldRenderer
                        key={def.id}
                        def={def}
                        value={values[def.test_key] ?? ""}
                        onChange={handleChange}
                        allValues={values}
                        manualOverrideKeys={MANUAL_OVERRIDE_KEYS}
                        specBadge={warnBadge}
                        photoUploadProps={(user && activeFactory) ? {
                          factoryCode:  activeFactory.code,
                          factoryId:    activeFactory.id,
                          entityType:   "product_qc",
                          entityId:     existingRecord?.id ?? null,
                          userId:       user.id,
                          onUploaded:   (k, path) => handleChange(k, path),
                          uploaderRefs,
                        } : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h3>Remarks</h3>
            <textarea
              placeholder="Additional observations…"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={3}
            />
          </div>

          {/* A10: Overall pass/fail summary */}
          {(() => {
            const evaluated = specs
              .map(s => ({ key: s.test_key, st: statusFor(s.test_key, values[s.test_key] ?? "") }))
              .filter(r => r.st !== "none");
            if (evaluated.length === 0) return null;
            const fails = evaluated.filter(r => r.st === "fail");
            const passes = evaluated.filter(r => r.st === "pass");
            const overallOk = fails.length === 0;
            return (
              <div style={{
                padding: "10px 14px",
                borderRadius: 6,
                border: `1px solid ${overallOk ? "var(--ok)" : "#c0392b"}`,
                background: overallOk ? "var(--ok-soft)" : "#fdf2f2",
                marginBottom: 8,
                fontSize: 13,
              }}>
                <strong style={{ color: overallOk ? "var(--ok)" : "#c0392b" }}>
                  {overallOk ? `✓ All ${passes.length} checked parameters pass spec` : `✗ ${fails.length} parameter${fails.length > 1 ? "s" : ""} out of spec`}
                </strong>
                {!overallOk && (
                  <div style={{ marginTop: 4, color: "#c0392b" }}>
                    {fails.map(f => {
                      const spec = specFor(f.key);
                      return (
                        <div key={f.key} style={{ fontSize: 12 }}>
                          · {spec?.parameter_label ?? f.key}: {values[f.key] ?? "—"}
                          {spec?.unit ? ` ${spec.unit}` : ""}
                          {" "}(spec: {spec ? specLimitText(spec) : "—"})
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          <p className="field-hint" style={{ marginBottom: 8 }}>
            Factory: <strong>{activeFactory?.name ?? "—"}</strong> ·{" "}
            Product: <strong>{selectedProduct?.name ?? "—"}</strong>
            {isPhaseAware ? ` · Phase ${phase}` : ""}
          </p>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting || loadingDefs}
            onClick={handleSubmit}
          >
            {submitting
              ? "Saving…"
              : existingRecord
              ? "Update QC Record"
              : "Save QC Record"}
          </button>
        </>
      )}
    </>
  );
}
