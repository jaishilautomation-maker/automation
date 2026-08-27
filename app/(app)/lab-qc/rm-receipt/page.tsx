"use client";

// =============================================================================
// Lab QC — Raw Material Receipt
//
// A-20/1: Dropdown to select Crude Sulphur or Oil
//   - Crude Sulphur: invoice_number, quantity, appearance, photo
//   - Oil: supplier name, date/time, quantity(MT), truck number, batch number, photo
// A-20: 5 RM materials dropdown
// =============================================================================

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import PhotoUploader, { type PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { Material } from "@/lib/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowLocalDatetime() {
  return new Date().toISOString().slice(0, 16);
}

const isA20_1 = process.env.NEXT_PUBLIC_FACTORY_CODE === "A20_1";

// A-20/1 RM types
type RmType = "crude_sulphur" | "oil";

// A-20 RM materials in display order
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

  // A-20/1: type selector
  const [rmType, setRmType] = useState<RmType>("crude_sulphur");

  // A-20: material from DB
  const [materials, setMaterials]       = useState<Material[]>([]);
  const [loadingMats, setLoadingMats]   = useState(true);
  const [materialId, setMaterialId]     = useState("");

  // Crude Sulphur fields
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [quantityMt, setQuantityMt]     = useState("");
  const [appearance, setAppearance]     = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [csTruckNumber, setCsTruckNumber] = useState("");

  // Oil fields
  const [supplierName, setSupplierName] = useState("");
  const [oilDatetime, setOilDatetime]   = useState(nowLocalDatetime());
  const [oilQuantity, setOilQuantity]   = useState("");
  const [truckNumber, setTruckNumber]   = useState("");
  const [oilBatchNumber, setOilBatchNumber] = useState("");

  const [submitting, setSubmitting]     = useState(false);
  const photoRef = useRef<PhotoUploaderHandle | null>(null);

  const selectedMaterial = materials.find(m => m.id === materialId);

  // Load materials for A-20
  useEffect(() => {
    if (isA20_1) { setLoadingMats(false); return; }
    const sb = createClient();
    sb.from("materials").select("*")
      .in("code", A20_RM_CODES)
      .eq("is_active", true)
      .then(({ data }) => {
        const sorted = A20_RM_CODES
          .map(code => (data ?? []).find((m: Material) => m.code === code))
          .filter(Boolean) as Material[];
        setMaterials(sorted);
        setLoadingMats(false);
      });
  }, []);

  // Clears all form fields. Optionally also clears the selected material.
  // On successful submit we clear everything; on dropdown change we keep the
  // newly selected material and only reset the dependent fields.
  const reset = (clearMaterial = true) => {
    setInvoiceNumber(""); setQuantityMt(""); setAppearance("");
    setReceivedDate(todayISO()); setCsTruckNumber("");
    setSupplierName(""); setOilDatetime(nowLocalDatetime());
    setOilQuantity(""); setTruckNumber(""); setOilBatchNumber("");
    if (!isA20_1 && clearMaterial) setMaterialId("");
  };

  // ── Crude Sulphur submit ──
  const handleSubmitCrudeSulphur = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!invoiceNumber.trim()) { showToast("Invoice number is required.", true); return; }
    if (!quantityMt || isNaN(parseFloat(quantityMt))) {
      showToast("Enter a valid quantity.", true); return;
    }

    setSubmitting(true);
    try {
      const qty = parseFloat(quantityMt);

      const { data: batch, error: batchErr } = await supabase
        .from("batches")
        .insert({
          batch_number:    invoiceNumber.trim(),
          factory_id:      activeFactory.id,
          material_id:     null,
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
        showToast("Could not save: " + (batchErr?.message ?? "unknown"), true); return;
      }

      await supabase.from("rm_receipts").insert({
        batch_id:      batch.id,
        factory_id:    activeFactory.id,
        supplier_name: "Crude Sulphur",
        received_date: receivedDate,
        received_by:   user.id,
        quantity:      qty,
        unit:          "MT",
        remarks:       [appearance.trim(), csTruckNumber.trim() ? `Truck: ${csTruckNumber.trim()}` : ""].filter(Boolean).join(" | ") || null,
      });

      if (photoRef.current?.hasPending) await photoRef.current.flush(batch.id);

      showToast("Crude Sulphur receipt saved ✓");
      reset();
    } catch { showToast("Network error.", true); }
    finally { setSubmitting(false); }
  };

  // ── Oil submit ──
  const handleSubmitOil = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!supplierName.trim()) { showToast("Supplier name is required.", true); return; }
    if (!oilQuantity || isNaN(parseFloat(oilQuantity))) {
      showToast("Enter a valid quantity.", true); return;
    }
    if (!oilBatchNumber.trim()) { showToast("Batch number is required.", true); return; }

    setSubmitting(true);
    try {
      const qty = parseFloat(oilQuantity);

      const { data: batch, error: batchErr } = await supabase
        .from("batches")
        .insert({
          batch_number:    oilBatchNumber.trim(),
          factory_id:      activeFactory.id,
          material_id:     null,
          product_id:      null,
          batch_type:      "rm",
          production_date: oilDatetime.slice(0, 10),
          quantity:        qty,
          unit:            "MT",
          source_batch_id: null,
          created_by:      user.id,
        })
        .select("id")
        .single();

      if (batchErr || !batch) {
        showToast("Could not save: " + (batchErr?.message ?? "unknown"), true); return;
      }

      await supabase.from("rm_receipts").insert({
        batch_id:      batch.id,
        factory_id:    activeFactory.id,
        supplier_name: supplierName.trim(),
        received_date: oilDatetime.slice(0, 10),
        received_by:   user.id,
        quantity:      qty,
        unit:          "MT",
        remarks:       `Truck: ${truckNumber.trim() || "—"}`,
      });

      if (photoRef.current?.hasPending) await photoRef.current.flush(batch.id);

      showToast("Oil receipt saved ✓");
      reset();
    } catch { showToast("Network error.", true); }
    finally { setSubmitting(false); }
  };

  // ── A-20 generic submit (unchanged logic) ──
  const handleSubmitA20 = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId) { showToast("Select a material.", true); return; }
    if (!invoiceNumber.trim()) { showToast("Invoice number is required.", true); return; }
    if (!quantityMt || isNaN(parseFloat(quantityMt))) {
      showToast("Enter a valid quantity.", true); return;
    }

    setSubmitting(true);
    try {
      const qty = parseFloat(quantityMt);

      const { data: batch, error: batchErr } = await supabase
        .from("batches")
        .insert({
          batch_number:    invoiceNumber.trim(),
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
        showToast("Could not save: " + (batchErr?.message ?? "unknown"), true); return;
      }

      await supabase.from("rm_receipts").insert({
        batch_id:      batch.id,
        factory_id:    activeFactory.id,
        supplier_name: selectedMaterial?.name ?? "—",
        received_date: receivedDate,
        received_by:   user.id,
        quantity:      qty,
        unit:          "MT",
        remarks:       appearance.trim() || null,
      });

      if (photoRef.current?.hasPending) await photoRef.current.flush(batch.id);

      showToast("Receipt saved ✓");
      reset();
    } catch { showToast("Network error.", true); }
    finally { setSubmitting(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Raw Material Receipt</h3>
        <div className="field-hint">{activeFactory?.name ?? "—"}</div>

        {/* A-20/1: type selector */}
        {isA20_1 ? (
          <>
            <label>Material Type *</label>
            <select value={rmType} onChange={e => { setRmType(e.target.value as RmType); reset(); }}>
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
              <select value={materialId} onChange={e => { reset(false); setMaterialId(e.target.value); }}>
                <option value="">— Select raw material —</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* ── A-20/1: Crude Sulphur form ── */}
      {isA20_1 && rmType === "crude_sulphur" && (
        <div className="card">
          <h3>Crude Sulphur Receipt</h3>

          <label>Invoice Number *</label>
          <input type="text" placeholder="e.g. INV-2024-001"
            value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />

          <label>Quantity Received (MT) *</label>
          <input type="number" min="0" step="0.001" placeholder="0.000"
            value={quantityMt} onChange={e => setQuantityMt(e.target.value)} />

          <label>Appearance / Physical State</label>
          <input type="text" placeholder="e.g. Yellow powder, free flowing"
            value={appearance} onChange={e => setAppearance(e.target.value)} />

          <label>Date Received</label>
          <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />

          <label>Truck Number</label>
          <input type="text" placeholder="e.g. MH-12-AB-1234"
            value={csTruckNumber} onChange={e => setCsTruckNumber(e.target.value)} />

          {user && activeFactory && (
            <div style={{ marginTop: 12 }}>
              <PhotoUploader ref={photoRef} label="Receipt Photo" fieldKey="receipt_photo"
                factoryCode={activeFactory.code} entityType="rm_receipt" entityId={null}
                userId={user.id} factoryId={activeFactory.id} onUploaded={() => {}} />
            </div>
          )}

          <button className="btn btn-primary" type="button" disabled={submitting}
            onClick={handleSubmitCrudeSulphur} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Save Receipt"}
          </button>
        </div>
      )}

      {/* ── A-20/1: Oil form ── */}
      {isA20_1 && rmType === "oil" && (
        <div className="card">
          <h3>Oil Receipt</h3>

          <label>Name of Supplier *</label>
          <input type="text" placeholder="Supplier name"
            value={supplierName} onChange={e => setSupplierName(e.target.value)} />

          <label>Date & Time *</label>
          <input type="datetime-local" value={oilDatetime}
            onChange={e => setOilDatetime(e.target.value)} />

          <label>Quantity (MT) *</label>
          <input type="number" min="0" step="0.001" placeholder="0.000"
            value={oilQuantity} onChange={e => setOilQuantity(e.target.value)} />

          <label>Truck Number</label>
          <input type="text" placeholder="e.g. MH-12-AB-1234"
            value={truckNumber} onChange={e => setTruckNumber(e.target.value)} />

          <label>Batch Number *</label>
          <input type="text" placeholder="e.g. OIL-260824-001"
            value={oilBatchNumber} onChange={e => setOilBatchNumber(e.target.value)} />

          {user && activeFactory && (
            <div style={{ marginTop: 12 }}>
              <PhotoUploader ref={photoRef} label="Receipt Photo" fieldKey="receipt_photo"
                factoryCode={activeFactory.code} entityType="rm_receipt" entityId={null}
                userId={user.id} factoryId={activeFactory.id} onUploaded={() => {}} />
            </div>
          )}

          <button className="btn btn-primary" type="button" disabled={submitting}
            onClick={handleSubmitOil} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Save Receipt"}
          </button>
        </div>
      )}

      {/* ── A-20 generic form ── */}
      {!isA20_1 && materialId && selectedMaterial && (
        <div className="card">
          <label>Invoice Number *</label>
          <input type="text" placeholder="e.g. INV-2024-001"
            value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />

          <label>Quantity Received (MT) *</label>
          <input type="number" min="0" step="0.001" placeholder="0.000"
            value={quantityMt} onChange={e => setQuantityMt(e.target.value)} />

          <label>Appearance / Physical State</label>
          <input type="text" placeholder="e.g. Yellow powder, free flowing"
            value={appearance} onChange={e => setAppearance(e.target.value)} />

          <label>Date Received</label>
          <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />

          {user && activeFactory && (
            <div style={{ marginTop: 12 }}>
              <PhotoUploader ref={photoRef} label="Receipt Photo" fieldKey="receipt_photo"
                factoryCode={activeFactory.code} entityType="rm_receipt" entityId={null}
                userId={user.id} factoryId={activeFactory.id} onUploaded={() => {}} />
            </div>
          )}

          <button className="btn btn-primary" type="button" disabled={submitting}
            onClick={handleSubmitA20} style={{ marginTop: 12 }}>
            {submitting ? "Saving…" : "Save Receipt"}
          </button>
        </div>
      )}
    </>
  );
}
