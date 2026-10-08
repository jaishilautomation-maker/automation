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
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import DateField from "@/components/DateField";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { useFormDraft, draftKey } from "@/lib/use-form-draft";
import PhotoUploader, { type PhotoUploaderHandle } from "@/components/PhotoUploader";
import type { Material, Vendor } from "@/lib/types";
import { notifyEvent } from "@/lib/notifications/notify-client";
import { buildRmReceiptEmail } from "@/lib/notifications/lab-qc-emails";
import { useFieldAudit } from "@/lib/use-field-audit";

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
// Note: SULPHUR_POWDER is intentionally excluded here — its batch number is
// generated in Factory A-20/1 and captured under Raw Material QC instead.
const A20_RM_CODES = [
  "ZINC_OXIDE",
  "CALCIUM_CHLORIDE",
  "TEBUCONAZOLE",
  "BORIC_POWDER",
];

export default function RmReceiptPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  // ── Draft autosave ──────────────────────────────────────────────────────
  const pathname = usePathname();
  interface DraftShape {
    rmType: RmType;
    materialId: string;
    invoiceNumber: string;
    quantityMt: string;
    appearance: string;
    receivedDate: string;
    csTruckNumber: string;
    csVendorId: string;
    supplierName: string;
    oilDatetime: string;
    oilQuantity: string;
    truckNumber: string;
    oilBatchNumber: string;
  }
  const draft = useFormDraft<DraftShape>(
    draftKey(pathname, activeFactory?.id, user?.id),
  );
  const d0 = draft.restored;

  // A-20/1: type selector
  const [rmType, setRmType] = useState<RmType>(d0?.rmType ?? "crude_sulphur");

  // A-20: material from DB
  const [materials, setMaterials]       = useState<Material[]>([]);
  const [loadingMats, setLoadingMats]   = useState(true);
  const [materialId, setMaterialId]     = useState(d0?.materialId ?? "");

  // Crude Sulphur fields
  const [invoiceNumber, setInvoiceNumber] = useState(d0?.invoiceNumber ?? "");
  const [quantityMt, setQuantityMt]     = useState(d0?.quantityMt ?? "");
  const [appearance, setAppearance]     = useState(d0?.appearance ?? "");
  const [receivedDate, setReceivedDate] = useState(d0?.receivedDate ?? todayISO());
  const [csTruckNumber, setCsTruckNumber] = useState(d0?.csTruckNumber ?? "");
  // Crude sulphur vendor — loaded from vendors table (migration 058).
  const [csVendors, setCsVendors]       = useState<Vendor[]>([]);
  const [csVendorId, setCsVendorId]     = useState(d0?.csVendorId ?? "");

  // Oil fields
  const [supplierName, setSupplierName] = useState(d0?.supplierName ?? "");
  const [oilDatetime, setOilDatetime]   = useState(d0?.oilDatetime ?? nowLocalDatetime());
  const [oilQuantity, setOilQuantity]   = useState(d0?.oilQuantity ?? "");
  const [truckNumber, setTruckNumber]   = useState(d0?.truckNumber ?? "");
  const [oilBatchNumber, setOilBatchNumber] = useState(d0?.oilBatchNumber ?? "");

  const [submitting, setSubmitting]     = useState(false);
  const photoRef = useRef<PhotoUploaderHandle | null>(null);
  const audit = useFieldAudit();

  // Autosave the live form state on every change (debounced inside the hook).
  const draftSave = draft.save;
  useEffect(() => {
    draftSave({
      rmType, materialId, invoiceNumber, quantityMt, appearance, receivedDate,
      csTruckNumber, csVendorId, supplierName, oilDatetime, oilQuantity,
      truckNumber, oilBatchNumber,
    });
  }, [rmType, materialId, invoiceNumber, quantityMt, appearance, receivedDate,
      csTruckNumber, csVendorId, supplierName, oilDatetime, oilQuantity,
      truckNumber, oilBatchNumber, draftSave]);

  const selectedMaterial = materials.find(m => m.id === materialId);

  // Load materials for A-20; load crude sulphur vendors for A-20/1.
  useEffect(() => {
    if (isA20_1) {
      setLoadingMats(false);
      const sb = createClient();
      sb.from("vendors")
        .select("*")
        .eq("vendor_type", "crude_sulphur")
        .eq("is_active", true)
        .order("vendor_name")
        .then(({ data }) => setCsVendors((data ?? []) as Vendor[]));
      return;
    }
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
    setReceivedDate(todayISO()); setCsTruckNumber(""); setCsVendorId("");
    setSupplierName(""); setOilDatetime(nowLocalDatetime());
    setOilQuantity(""); setTruckNumber(""); setOilBatchNumber("");
    if (!isA20_1 && clearMaterial) setMaterialId("");
    audit.reset();
    draft.clear();
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

      const selectedVendor = csVendors.find(v => v.id === csVendorId);

      // Build receipt payload. vendor_id requires migration 060 to be applied;
      // if the column doesn't exist yet the insert would fail silently, so we
      // catch the error and retry without it so the receipt still saves.
      const receiptPayload: Record<string, unknown> = {
        batch_id:      batch.id,
        factory_id:    activeFactory.id,
        supplier_name: selectedVendor?.vendor_name ?? "Crude Sulphur",
        vendor_id:     csVendorId || null,
        received_date: receivedDate,
        received_by:   user.id,
        quantity:      qty,
        unit:          "MT",
        remarks:       [appearance.trim(), csTruckNumber.trim() ? `Truck: ${csTruckNumber.trim()}` : ""].filter(Boolean).join(" | ") || null,
      };

      let { error: receiptErr } = await supabase.from("rm_receipts").insert(receiptPayload);

      // If insert failed (likely vendor_id column not yet added — migration 060
      // not applied), retry without vendor_id so the receipt still saves.
      if (receiptErr) {
        delete receiptPayload.vendor_id;
        const retry = await supabase.from("rm_receipts").insert(receiptPayload);
        receiptErr = retry.error;
      }

      if (receiptErr) {
        showToast("Receipt row could not be saved: " + receiptErr.message, true); return;
      }

      if (photoRef.current?.hasPending) await photoRef.current.flush(batch.id);
      // Flush field-level audit log (one batched INSERT, using batch.id as record_id)
      await audit.flush(supabase, user.id, "rm_receipt", batch.id);

      // Fire-and-forget email
      const nowISO = new Date().toISOString();
      const { subject, html } = buildRmReceiptEmail({
        materialType:    "Crude Sulphur",
        batchNumber:     invoiceNumber.trim(),
        supplierName:    selectedVendor?.vendor_name ?? "Crude Sulphur",
        quantity:        parseFloat(quantityMt),
        unit:            "MT",
        receivedDate:    receivedDate,
        truckNumber:     csTruckNumber.trim() || null,
        appearance:      appearance.trim() || null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     nowISO,
        factoryName:     activeFactory.name,
      });
      void notifyEvent({
        eventType: "lab_qc_rm_receipt",
        subject,
        html,
        factoryId: activeFactory.id,
        referenceId: batch.id,
        sheetData: {
          type: "append",
          target: "lab",
          tab: "RM Receipts",
          values: [
            batch.id,
            "Crude Sulphur",
            invoiceNumber.trim(),
            selectedVendor?.vendor_name ?? null,
            selectedVendor?.vendor_name ?? "Crude Sulphur",
            parseFloat(quantityMt),
            "MT",
            receivedDate,
            csTruckNumber.trim() || null,
            appearance.trim() || null,
            profile?.full_name ?? null,
            nowISO,
            activeFactory.id,
          ],
        },
      });

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

      // Fire-and-forget email
      const nowISO2 = new Date().toISOString();
      const { subject: oilSubj, html: oilHtml } = buildRmReceiptEmail({
        materialType:    "Oil",
        batchNumber:     oilBatchNumber.trim(),
        supplierName:    supplierName.trim(),
        quantity:        parseFloat(oilQuantity),
        unit:            "MT",
        receivedDate:    oilDatetime.slice(0, 10),
        truckNumber:     truckNumber.trim() || null,
        appearance:      null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     nowISO2,
        factoryName:     activeFactory.name,
      });
      void notifyEvent({
        eventType: "lab_qc_rm_receipt",
        subject: oilSubj,
        html: oilHtml,
        factoryId: activeFactory.id,
        referenceId: batch.id,
        sheetData: {
          type: "append",
          target: "lab",
          tab: "RM Receipts",
          values: [
            batch.id,
            "Oil",
            oilBatchNumber.trim(),
            supplierName.trim(),
            parseFloat(oilQuantity),
            "MT",
            oilDatetime.slice(0, 10),
            truckNumber.trim() || null,
            null,  // appearance — not collected for oil
            profile?.full_name ?? null,
            nowISO2,
            activeFactory.id,
          ],
        },
      });

      showToast("Oil receipt saved ✓");
      reset();
    } catch { showToast("Network error.", true); }
    finally { setSubmitting(false); }
  };

  // ── A-20 generic submit (unchanged logic) ──
  const handleSubmitA20 = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!materialId) { showToast("Select a material.", true); return; }
    if (!invoiceNumber.trim()) { showToast("Batch number is required.", true); return; }
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

      // Fire-and-forget email
      const nowISO3 = new Date().toISOString();
      const { subject: a20Subj, html: a20Html } = buildRmReceiptEmail({
        materialType:    selectedMaterial?.name ?? "Raw Material",
        batchNumber:     invoiceNumber.trim(),
        supplierName:    selectedMaterial?.name ?? "—",
        quantity:        parseFloat(quantityMt),
        unit:            "MT",
        receivedDate:    receivedDate,
        appearance:      appearance.trim() || null,
        submittedByName: profile?.full_name ?? "—",
        submittedAt:     nowISO3,
        factoryName:     activeFactory.name,
      });
      void notifyEvent({ eventType: "lab_qc_rm_receipt", subject: a20Subj, html: a20Html, factoryId: activeFactory.id, referenceId: batch.id });

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

          <label>Vendor / Supplier *</label>
          {csVendors.length === 0 ? (
            <div className="field-hint">Loading vendors…</div>
          ) : (
            <select value={csVendorId} onChange={e => setCsVendorId(e.target.value)}>
              <option value="">— Select vendor —</option>
              {csVendors.map(v => (
                <option key={v.id} value={v.id}>{v.vendor_name}</option>
              ))}
            </select>
          )}

          <label style={{ marginTop: 12 }}>Invoice Number *</label>
          <input type="text" placeholder="e.g. INV-2024-001"
            value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
            onBlur={() => audit.record("invoice_number", invoiceNumber)} />

          <label>Quantity Received (MT) *</label>
          <input type="number" min="0" step="0.001" placeholder="0.000"
            value={quantityMt} onChange={e => setQuantityMt(e.target.value)}
            onBlur={() => audit.record("quantity_mt", quantityMt)} />

          <label>Appearance / Physical State</label>
          <input type="text" placeholder="e.g. Yellow powder, free flowing"
            value={appearance} onChange={e => setAppearance(e.target.value)}
            onBlur={() => audit.record("appearance", appearance)} />

          <label>Date Received</label>
          <DateField value={receivedDate} onChange={setReceivedDate}
            onBlur={() => audit.record("received_date", receivedDate)} />

          <label>Truck Number</label>
          <input type="text" placeholder="e.g. MH-12-AB-1234"
            value={csTruckNumber} onChange={e => setCsTruckNumber(e.target.value)}
            onBlur={() => audit.record("truck_number", csTruckNumber)} />

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
          <label>Batch Number *</label>
          <input type="text" placeholder="e.g. BATCH-2024-001"
            value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />

          <label>Quantity Received (MT) *</label>
          <input type="number" min="0" step="0.001" placeholder="0.000"
            value={quantityMt} onChange={e => setQuantityMt(e.target.value)} />

          <label>Appearance / Physical State</label>
          <input type="text" placeholder="e.g. Yellow powder, free flowing"
            value={appearance} onChange={e => setAppearance(e.target.value)} />

          <label>Date Received</label>
          <DateField value={receivedDate} onChange={setReceivedDate} />

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
