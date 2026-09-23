"use client";

// =============================================================================
// Lab QC — Packing Material QC
//
// QC for packing materials (e.g. HDPE bags), item sourced from
// stores_stock_items WHERE category = 'packaging_material'.
//
// Fields: item, PO weight, actual weight (correlation % auto-computed),
// drop test (pass/fail), strength check (pass/fail), overall result.
// User captured from session (auth.uid) — no manual name field.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

interface PackingItem {
  id: string;
  item_code: string;
  item_name: string;
}

type PassFail = "pass" | "fail" | "";

export default function PackingQcPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [items, setItems]           = useState<PackingItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemId, setItemId]         = useState("");
  const [poWeight, setPoWeight]     = useState("");
  const [actualWeight, setActualWeight] = useState("");
  const [dropTest, setDropTest]     = useState<PassFail>("");
  const [strengthCheck, setStrengthCheck] = useState<PassFail>("");
  const [overall, setOverall]       = useState<PassFail>("");
  const [remarks, setRemarks]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Live correlation % = actual / po * 100
  const correlation = (() => {
    const po = parseFloat(poWeight);
    const act = parseFloat(actualWeight);
    if (!po || isNaN(po) || isNaN(act)) return "";
    return ((act / po) * 100).toFixed(2);
  })();

  // -------------------------------------------------------------------------
  // Load packaging-material items for this factory
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) return;
    setLoadingItems(true);
    supabase
      .from("stores_stock_items")
      .select("id, item_code, item_name")
      .eq("factory_id", activeFactory.id)
      .eq("category", "packaging_material")   // NOTE: enum value is 'packaging_material'
      .eq("is_active", true)
      .order("item_name")
      .then(({ data }) => {
        setItems((data ?? []) as PackingItem[]);
        setLoadingItems(false);
      });
  }, [activeFactory, supabase]);

  const handleSubmit = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }
    if (!itemId) { showToast("Select a packing item.", true); return; }
    if (!overall) { showToast("Set the overall result.", true); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("packing_qc").insert({
        factory_id:            activeFactory.id,
        item_id:               itemId,
        po_weight:             poWeight ? parseFloat(poWeight) : null,
        actual_weight:         actualWeight ? parseFloat(actualWeight) : null,
        drop_test_result:      dropTest || null,
        strength_check_result: strengthCheck || null,
        overall_result:        overall,
        tested_by:             user.id,
        remarks:               remarks.trim() || null,
      });

      if (error) { showToast("Could not save: " + error.message, true); return; }

      showToast("Packing QC saved ✓");
      setItemId(""); setPoWeight(""); setActualWeight("");
      setDropTest(""); setStrengthCheck(""); setOverall(""); setRemarks("");
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  const pfSelect = (val: PassFail, setter: (v: PassFail) => void) => (
    <select value={val} onChange={e => setter(e.target.value as PassFail)}>
      <option value="">— Select —</option>
      <option value="pass">Pass</option>
      <option value="fail">Fail</option>
    </select>
  );

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <h3>Packing Material QC</h3>
        <div className="field-hint" style={{ marginBottom: 12 }}>
          Tested by <strong>{profile?.full_name ?? "—"}</strong> (from your login).
        </div>

        <label>Packing Item *</label>
        {loadingItems ? (
          <div className="field-hint">Loading items…</div>
        ) : items.length === 0 ? (
          <div className="field-hint" style={{ color: "var(--warn)" }}>
            No packaging-material items found for {activeFactory?.name}. Add them under Stores first.
          </div>
        ) : (
          <select value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">— Select item —</option>
            {items.map(it => (
              <option key={it.id} value={it.id}>{it.item_name} ({it.item_code})</option>
            ))}
          </select>
        )}
      </div>

      {itemId && (
        <>
          <div className="card">
            <h3>Weight Correlation</h3>
            <div className="row2">
              <div>
                <label>PO Weight</label>
                <input type="number" step="any" placeholder="0"
                  value={poWeight} onChange={e => setPoWeight(e.target.value)} />
              </div>
              <div>
                <label>Actual Weight</label>
                <input type="number" step="any" placeholder="0"
                  value={actualWeight} onChange={e => setActualWeight(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <label>Correlation = Actual / PO × 100</label>
              <input type="text" readOnly value={correlation ? `${correlation}%` : ""}
                style={{ background: "var(--ok-soft)", fontWeight: 600 }}
                placeholder="Auto-calculated" />
            </div>
          </div>

          <div className="card">
            <h3>Physical Tests</h3>
            <div className="row2">
              <div>
                <label>Drop Test</label>
                {pfSelect(dropTest, setDropTest)}
              </div>
              <div>
                <label>Strength Check</label>
                {pfSelect(strengthCheck, setStrengthCheck)}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label>Overall Result *</label>
              {pfSelect(overall, setOverall)}
            </div>
          </div>

          <div className="card">
            <h3>Remarks</h3>
            <textarea placeholder="Any additional observations…"
              value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} />
          </div>

          <button className="btn btn-primary" type="button"
            disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Saving…" : "Save Packing QC"}
          </button>
        </>
      )}
    </>
  );
}
