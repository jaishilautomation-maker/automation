"use client";

// =============================================================================
// Packing Machine Maintenance Checklist — Module B (A-20 only)
//
// This is NOT a frequency-scheduled PM register.
// It is a periodic checklist filled per date: all 10 machines × parts,
// each part marked Do / Do Not + optional remark.
//
// Flow:
//   1. Page loads today's checklist if it exists (UNIQUE factory+date)
//      otherwise shows "Start today's checklist" button
//   2. All machines × parts render as rows with Do / Do Not toggle
//   3. 3 sign-off fields at the bottom
//   4. Saves the checklist header + all entries in two INSERTs
//   5. Updating: existing entries are UPSERTed
//
// Access: operator, factory_admin, company_admin
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { useToast } from "@/lib/toast-context";
import type {
  PackingMaintenanceItem,
  PackingMaintenanceChecklist,
  PackingMaintenanceChecklistEntry,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Local state type per entry
// ---------------------------------------------------------------------------
interface EntryState {
  itemId: string;
  status: "do" | "do_not" | null;
  remark: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function PackingMaintenancePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [checklistDate, setChecklistDate] = useState(todayISO());

  // Master items (seeded)
  const [items, setItems]             = useState<PackingMaintenanceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  // Current checklist for selected date
  const [checklist, setChecklist]     = useState<PackingMaintenanceChecklist | null>(null);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  // Entry states: itemId → { status, remark }
  const [entries, setEntries]         = useState<Record<string, EntryState>>({});

  // Sign-offs
  const [maintEngineerSign, setMaintEngineerSign]     = useState("");
  const [productionManagerSign, setProductionManagerSign] = useState("");

  const [submitting, setSubmitting]   = useState(false);

  // -------------------------------------------------------------------------
  // Load master items once
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!activeFactory) return;
    const sb = createClient();
    sb.from("packing_maintenance_items")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .order("sr_no")
      .then(({ data }) => {
        const rows = (data ?? []) as PackingMaintenanceItem[];
        setItems(rows);
        // Initialise entry state
        const init: Record<string, EntryState> = {};
        rows.forEach(r => { init[r.id] = { itemId: r.id, status: null, remark: "" }; });
        setEntries(init);
        setLoadingItems(false);
      });
  }, [activeFactory]);

  // -------------------------------------------------------------------------
  // Load checklist for selected date
  // -------------------------------------------------------------------------
  const loadChecklist = useCallback(async () => {
    if (!activeFactory) return;
    setLoadingChecklist(true);

    const { data: cl } = await supabase
      .from("packing_maintenance_checklists")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .eq("checklist_date", checklistDate)
      .maybeSingle();

    setChecklist(cl as PackingMaintenanceChecklist | null);

    if (cl) {
      // Load existing entries
      const { data: existingEntries } = await supabase
        .from("packing_maintenance_checklist_entries")
        .select("*")
        .eq("checklist_id", cl.id);

      const entryMap: Record<string, EntryState> = {};
      // Initialise with blanks first
      items.forEach(item => {
        entryMap[item.id] = { itemId: item.id, status: null, remark: "" };
      });
      // Overlay with saved values
      ((existingEntries ?? []) as PackingMaintenanceChecklistEntry[]).forEach(e => {
        entryMap[e.item_id] = {
          itemId: e.item_id,
          status: e.status as "do" | "do_not" | null,
          remark: e.remark ?? "",
        };
      });
      setEntries(entryMap);

      // Pre-fill sign-offs
      setMaintEngineerSign(cl.maintenance_engineer_sign ?? "");
      setProductionManagerSign(cl.production_manager_sign ?? "");
    } else {
      // Reset to blanks for a new checklist
      const init: Record<string, EntryState> = {};
      items.forEach(r => { init[r.id] = { itemId: r.id, status: null, remark: "" }; });
      setEntries(init);
      setMaintEngineerSign("");
      setProductionManagerSign("");
    }

    setLoadingChecklist(false);
  }, [activeFactory, checklistDate, items, supabase]);

  // Reload when date or items change
  useEffect(() => {
    if (!loadingItems) loadChecklist();
  }, [checklistDate, loadingItems, loadChecklist]);

  // -------------------------------------------------------------------------
  // Toggle Do / Do Not
  // -------------------------------------------------------------------------
  function toggleStatus(itemId: string, val: "do" | "do_not") {
    setEntries(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status: prev[itemId]?.status === val ? null : val,
      },
    }));
  }

  function setRemark(itemId: string, remark: string) {
    setEntries(prev => ({ ...prev, [itemId]: { ...prev[itemId], remark } }));
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const handleSave = async () => {
    if (!user || !activeFactory) { showToast("Session error — refresh.", true); return; }

    setSubmitting(true);
    try {
      let clId = checklist?.id;

      if (!clId) {
        // Create checklist header
        const { data: newCl, error: clErr } = await supabase
          .from("packing_maintenance_checklists")
          .insert({
            factory_id:               activeFactory.id,
            checklist_date:           checklistDate,
            operator_sign:            user.id,
            maintenance_engineer_sign: maintEngineerSign.trim() || null,
            production_manager_sign:  productionManagerSign.trim() || null,
          })
          .select("id")
          .single();

        if (clErr || !newCl) {
          showToast("Could not create checklist: " + (clErr?.message ?? "unknown"), true);
          return;
        }
        clId = newCl.id;
      } else {
        // Update sign-offs on existing header
        await supabase
          .from("packing_maintenance_checklists")
          .update({
            maintenance_engineer_sign: maintEngineerSign.trim() || null,
            production_manager_sign:  productionManagerSign.trim() || null,
          })
          .eq("id", clId);
      }

      // Upsert all entries
      const entryRows = Object.values(entries).map(e => ({
        checklist_id: clId,
        item_id:      e.itemId,
        status:       e.status,
        remark:       e.remark || null,
      }));

      const { error: entryErr } = await supabase
        .from("packing_maintenance_checklist_entries")
        .upsert(entryRows, { onConflict: "checklist_id,item_id" });

      if (entryErr) {
        showToast("Entries failed to save: " + entryErr.message, true);
        return;
      }

      showToast("Checklist saved ✓");
      loadChecklist();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Group items by machine
  // -------------------------------------------------------------------------
  const machineNames = Array.from(new Set(items.map(i => i.machine_name)));

  const doneCount     = Object.values(entries).filter(e => e.status === "do").length;
  const doNotCount    = Object.values(entries).filter(e => e.status === "do_not").length;
  const unfilledCount = items.length - doneCount - doNotCount;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* Header */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Packing Machine Maintenance Checklist</h3>
            <div className="field-hint">{activeFactory?.name ?? "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--ok)", fontWeight: 600 }}>{doneCount} Do</span>
            <span style={{ color: "var(--warn)", fontWeight: 600 }}>{doNotCount} Do Not</span>
            {unfilledCount > 0 && (
              <span style={{ color: "var(--ink-soft)" }}>{unfilledCount} unfilled</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
          <div>
            <label>Date</label>
            <input
              type="date"
              value={checklistDate}
              onChange={e => setChecklistDate(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
          {checklist && (
            <div className="field-hint" style={{ color: "var(--ok)" }}>
              ✓ Checklist exists for this date — editing it
            </div>
          )}
        </div>
      </div>

      {/* Checklist body */}
      {loadingItems || loadingChecklist ? (
        <div className="card"><div className="empty">Loading…</div></div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty">
            No maintenance items found. Run migration 002_a20_full_schema.sql to seed them.
          </div>
        </div>
      ) : (
        machineNames.map(machineName => {
          const machineItems = items.filter(i => i.machine_name === machineName);
          return (
            <div key={machineName} className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 10 }}>
              {/* Machine header */}
              <div style={{
                padding: "8px 16px",
                background: "var(--surface-2, #f9f7f4)",
                borderBottom: "1px solid var(--line)",
                fontWeight: 700, fontSize: 13,
              }}>
                {machineName}
              </div>

              {machineItems.map((item, idx) => {
                const entry = entries[item.id] ?? { itemId: item.id, status: null, remark: "" };
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 16px",
                      borderBottom: idx < machineItems.length - 1 ? "1px solid var(--line)" : "none",
                      flexWrap: "wrap",
                      background: entry.status === "do_not" ? "#fff5f5" : "transparent",
                    }}
                  >
                    {/* Sr + Part name */}
                    <span style={{ minWidth: 24, color: "var(--ink-soft)", fontSize: 11 }}>
                      {item.sr_no}
                    </span>
                    <span style={{ flex: 1, minWidth: 140, fontSize: 13 }}>
                      {item.machine_part}
                    </span>

                    {/* Do / Do Not toggles */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["do", "do_not"] as const).map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => toggleStatus(item.id, val)}
                          style={{
                            padding: "4px 12px",
                            borderRadius: 20,
                            border: "1px solid var(--line)",
                            fontSize: 12,
                            cursor: "pointer",
                            fontWeight: entry.status === val ? 700 : 400,
                            background: entry.status === val
                              ? (val === "do" ? "var(--ok)" : "#d32f2f")
                              : "var(--surface)",
                            color: entry.status === val ? "#fff" : "var(--ink)",
                          }}
                        >
                          {val === "do" ? "Do" : "Do Not"}
                        </button>
                      ))}
                    </div>

                    {/* Remark */}
                    <input
                      type="text"
                      placeholder="Remark"
                      value={entry.remark}
                      onChange={e => setRemark(item.id, e.target.value)}
                      style={{ width: 160, fontSize: 12 }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {/* Sign-offs */}
      {items.length > 0 && (
        <div className="card">
          <h3>Sign-offs</h3>
          <div className="row2">
            <div>
              <label>Operator Sign</label>
              <input
                type="text"
                disabled
                value={user?.email ?? "Current user"}
                style={{ background: "var(--surface)" }}
              />
            </div>
            <div>
              <label>Maintenance Engineer Sign</label>
              <input
                type="text"
                placeholder="Name"
                value={maintEngineerSign}
                onChange={e => setMaintEngineerSign(e.target.value)}
              />
            </div>
          </div>
          <div style={{ maxWidth: 340 }}>
            <label>Production Manager Sign</label>
            <input
              type="text"
              placeholder="Name"
              value={productionManagerSign}
              onChange={e => setProductionManagerSign(e.target.value)}
            />
          </div>

          <button
            className="btn btn-primary"
            type="button"
            disabled={submitting}
            onClick={handleSave}
            style={{ marginTop: 14 }}
          >
            {submitting ? "Saving…" : checklist ? "Update Checklist" : "Save Checklist"}
          </button>
        </div>
      )}
    </>
  );
}
