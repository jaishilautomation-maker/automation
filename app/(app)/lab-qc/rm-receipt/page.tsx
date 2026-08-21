"use client";

// =============================================================================
// Lab QC — Raw Material Receipt
//
// What this form does:
//   1. Chemist selects a material (filtered to this factory's active materials)
//   2. Fills in supplier, invoice, vehicle, date, quantity, lot number
//   3. On submit:
//      a. INSERTs a row into `batches` (batch_type = 'rm')
//      b. INSERTs a row into `rm_receipts` linked to that batch
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

const UNITS = ["kg", "L", "MT", "bags", "drums"] as const;

export default function RmReceiptPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // Master data
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loadingMats, setLoadingMats] = useState(true);

  // Form state
  const [materialId, setMaterialId]     = useState("");
  const [batchNumber, setBatchNumber]   = useState("");
  const [lotNumber, setLotNumber]       = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [quantity, setQuantity]         = useState("");
  const [unit, setUnit]                 = useState<typeof UNITS[number]>("kg");
  const [remarks, setRemarks]           = useState("");
  const [submitting, setSubmitting]     = useState(false);

  // Load materials
  useEffect(() => {
    supabase
      .from("materials")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setMaterials((data ?? []) as Material[]);
        setLoadingMats(false);
      });
  }, [supabase]);

  const reset = () => {
    setMaterialId(""); setBatchNumber(""); setLotNumber("");
    setSupplierName(""); setInvoiceNumber(""); setVehicleNumber("");
    setReceivedDate(todayISO()); setQuantity(""); setUnit("kg"); setRemarks("");
  };

  const handleSubmit = async () => {
    if (!user || !activeFactory) {
      showToast("Session error — please refresh.", true);
      return;
    }
    if (!materialId)        { showToast("Select a material.", true); return; }
    if (!batchNumber.trim()) { showToast("Batch number is required.", true); return; }
    if (!supplierName.trim()) { showToast("Supplier name is required.", true); return; }
    if (!quantity || isNaN(parseFloat(quantity))) {
      showToast("Enter a valid quantity.", true);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Insert batch row
      const { data: batch, error: batchErr } = await supabase
        .from("batches")
        .insert({
          batch_number:    batchNumber.trim(),
          lot_number:      lotNumber.trim() || null,
          factory_id:      activeFactory.id,
          material_id:     materialId,
          product_id:      null,
          batch_type:      "rm",
          production_date: receivedDate,
          machine:         null,
          quantity:        parseFloat(quantity),
          unit,
          source_batch_id: null,
          created_by:      user.id,
        })
        .select("id")
        .single();

      if (batchErr || !batch) {
        showToast("Could not create batch: " + (batchErr?.message ?? "unknown"), true);
        return;
      }

      // 2. Insert rm_receipt row
      const { error: receiptErr } = await supabase
        .from("rm_receipts")
        .insert({
          batch_id:       batch.id,
          factory_id:     activeFactory.id,
          supplier_name:  supplierName.trim(),
          invoice_number: invoiceNumber.trim() || null,
          vehicle_number: vehicleNumber.trim() || null,
          received_date:  receivedDate,
          received_by:    user.id,
          quantity:       parseFloat(quantity),
          unit,
          remarks:        remarks.trim() || null,
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

        {/* Material selection */}
        <label>Material *</label>
        {loadingMats ? (
          <div className="field-hint">Loading materials…</div>
        ) : (
          <select value={materialId} onChange={e => setMaterialId(e.target.value)}>
            <option value="">— Select material —</option>
            {materials.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        {/* Batch / lot identifiers */}
        <div className="row2">
          <div>
            <label>Batch / Delivery Number *</label>
            <input
              type="text"
              placeholder="e.g. DEL-20240821"
              value={batchNumber}
              onChange={e => setBatchNumber(e.target.value)}
            />
          </div>
          <div>
            <label>Lot Number (supplier)</label>
            <input
              type="text"
              placeholder="Supplier lot no."
              value={lotNumber}
              onChange={e => setLotNumber(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Supplier Details</h3>

        <label>Supplier Name *</label>
        <input
          type="text"
          placeholder="Full supplier / vendor name"
          value={supplierName}
          onChange={e => setSupplierName(e.target.value)}
        />

        <div className="row2">
          <div>
            <label>Invoice Number</label>
            <input
              type="text"
              placeholder="Invoice / challan no."
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
            />
          </div>
          <div>
            <label>Vehicle Number</label>
            <input
              type="text"
              placeholder="e.g. MH 04 AB 1234"
              value={vehicleNumber}
              onChange={e => setVehicleNumber(e.target.value)}
            />
          </div>
        </div>

        <label>Date Received *</label>
        <input
          type="date"
          value={receivedDate}
          onChange={e => setReceivedDate(e.target.value)}
        />
      </div>

      <div className="card">
        <h3>Quantity</h3>
        <div className="row2">
          <div>
            <label>Quantity *</label>
            <input
              type="number"
              min="0"
              step="0.001"
              placeholder="0"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <label>Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value as typeof UNITS[number])}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Remarks</h3>
        <textarea
          placeholder="Any observations about the delivery (condition, packaging, etc.)"
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          rows={3}
        />
      </div>

      <p className="field-hint" style={{ marginBottom: 8 }}>
        Factory: <strong>{activeFactory?.name ?? "—"}</strong>
      </p>

      <button
        className="btn btn-primary"
        type="button"
        disabled={submitting || loadingMats}
        onClick={handleSubmit}
      >
        {submitting ? "Saving…" : "Save Receipt"}
      </button>
    </>
  );
}
