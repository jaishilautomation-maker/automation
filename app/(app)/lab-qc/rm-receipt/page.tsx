"use client";

// =============================================================================
// Lab QC — Raw Material Receipt
//
// A-20/1: Crude Sulphur only — batch_number, quantity, appearance
// A-20:   5 RM materials — Sulphur Powder, Zinc Oxide, Calcium Chloride,
//         Tebuconazole, Boric Powder — same 3 fields each
//
// Per spec: 3 fields per material (batch_number, quantity_mt, appearance).
// Stored in batches (batch_type='rm') + rm_receipts.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import type { Material } from "@/lib/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";

// A-20 RM materials in display order (matches spec)
const A20_RM_CODES = [
  "SULPHUR_POWDER",
  "ZINC_OXIDE",
  "CALCIUM_CHLORIDE",
  "TEBUCONAZOLE",
  "BORIC_POWDER",
];

export default function RmReceiptPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [materials, setMaterials]     = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(true);
  const [materialId, setMaterialId]   = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [quantityMt, setQuantityMt]   = useState("");
  const [appearance, setAppearance]   = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [submitting, setSubmitting]   = useState(false);

  const selectedMaterial = materials.find(m => m.id === materialId);

  useEffect(() => {
    const sb = createClient();
    if (isA20_1) {
      // A-20/1: Crude Sulphur only
      sb.from("materials").select("*").eq("code", "SULPHUR_CRUDE").eq("is_active", true)
        .maybeSingle()
        .then(({ data }) => {
          if (data) { setMaterials([data as Material]); setMaterialId((data as Material).id); }
          setLoadingMats(false);
        });
    } else {
      // A-20: 5 RM materials in spec order
      sb.from("materials").select("*")
        .in("code", A20_RM_CODES)
        .eq("is_active", true)
        .then(({ data }) => {
          // Sort by spec order
          const sorted = A20_RM_CODES
            .map(code => (data ?? []).find((m: Material) => m.code === code))
            .filter(Boolean) as Material[];
          setMaterials(sorted);
          setLoadingMats(false);
        });
    }
  }, []);

  const reset = () => {
    if (!isA20_1) setMaterialId("");
    setBatchNumber(""); setQuantityMt(""); setAppearance("");
    setReceivedDate(todayISO());
  };

  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — please refresh.", true); return; }
    if (!materialId)             { showToast("Select a material.", true); return; }
    if (!batchNumber.trim())     { showToast("Batch number is required.", true); return; }
    if (!quantityMt || isNaN(parseFloat(quantityMt))) {
      showToast("Enter a valid quantity.", true); return;
    }

    setSubmitting(true);
    try {
      const qty = parseFloat(quantityMt);

      const { data: batch, error: batchErr } = await supabase
        .from("batches")
        .insert({
          batch_number:    batchNumber.trim(),
          factory_id:      activeFactory.id,
          material_id:     materialId,
          product_id:      null,
          batch_type:      "rm",
          production_date: receivedDate,
          quantity:        qty,
          unit:            "MT",
          source_batch_id: null,
          created_by:      user.id,
        })
        .select("id")
        .single();

      if (batchErr || !batch) {
        showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true);
        return;
      }

      const { error: receiptErr } = await supabase
        .from("rm_receipts")
        .insert({
          batch_id:      batch.id,
          factory_id:    activeFactory.id,
          supplier_name: selectedMaterial?.name ?? "—",  // required col; use material name
          received_date: receivedDate,
          received_by:   user.id,
          quantity:      qty,
          unit:          "MT",
          remarks:       appearance.trim() || null,  // appearance stored in remarks
        });

      if (receiptErr) {
        showToast("Batch saved but receipt failed: " + receiptErr.message, true);
        return;
      }

      showToast("Receipt recorded ✓");
      reset();
    } catch {
      showToast("Network error — please try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Raw Material Receipt</h3>
        <div className="field-hint">{activeFactory?.name ?? "—"}</div>

        {/* Material selector */}
        <label>Raw Material *</label>
        {loadingMats ? (
          <div className="field-hint">Loading…</div>
        ) : isA20_1 ? (
          <input type="text" disabled value={materials[0]?.name ?? "Crude Sulphur"}
            style={{ background: "var(--surface)", fontWeight: 600 }} />
        ) : (
          <select value={materialId} onChange={e => { setMaterialId(e.target.value); setBatchNumber(""); setQuantityMt(""); setAppearance(""); }}>
            <option value="">— Select raw material —</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}

        {/* 3-field form — shown once material is selected */}
        {materialId && selectedMaterial && (
          <>
            <label>{selectedMaterial.name} — Batch Number *</label>
            <input
              type="text"
              placeholder="e.g. SP-260824-001"
              value={batchNumber}
              onChange={e => setBatchNumber(e.target.value)}
            />

            <label>{selectedMaterial.name} — Quantity Received (MT) *</label>
            <input
              type="number"
              min="0"
              step="0.001"
              placeholder="0.000"
              value={quantityMt}
              onChange={e => setQuantityMt(e.target.value)}
            />

            <label>{selectedMaterial.name} — Appearance / Physical State</label>
            <input
              type="text"
              placeholder="e.g. Yellow powder, free flowing"
              value={appearance}
              onChange={e => setAppearance(e.target.value)}
            />

            <label>Date Received</label>
            <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />

            <button
              className="btn btn-primary"
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              style={{ marginTop: 12 }}
            >
              {submitting ? "Saving…" : "Save Receipt"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
