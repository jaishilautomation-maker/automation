"use client";

// =============================================================================
// Production Incharge — Job Card
//
// NEW FLOW (migration 010):
//   Production creates the shift first with batch details.
//   Operator then fills machine/checkpoints/hours/signatures.
//   Lab then signs off.
//
// This page handles TWO sub-modes:
//   Tab "New Entry" — production creates a new shift with up to 4 batch entries,
//                     each with: maal code, sulphur info, oil info
//   Tab "Pending"   — list of shifts waiting for production's planned/actual
//                     bags (production_submitted = false), click to fill
// =============================================================================

import { useEffect, useState, useCallback, useId } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BatchRow {
  id: string;
  maalCode: string;
  sulphurInfo: string;  // supplier / lot / khali karne ki tarik
  oilInfo: string;      // supplier / batch / qty
}

interface PendingShift {
  id: string;
  machine: string;
  shift_date: string;
  shift_type: string;
  operator: string | null;
  jobno: string | null;
  operator_submitted: boolean;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeBlank(id: string): BatchRow {
  return { id, maalCode: "", sulphurInfo: "", oilInfo: "" };
}

const LOW_PROD_REASONS = [
  "Jaali bharna (Mesh clogging)",
  "Machine kharab (Machine breakdown)",
  "Bijli band (Power failure)",
  "Kacha maal (Raw material issue)",
  "Roller jam",
  "Nitrogen unit issue",
];

export default function ProductionPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();
  const uid = useId();

  const [tab, setTab] = useState<"new" | "pending">("new");

  // ── New entry form ────────────────────────────────────────────────────────
  const [machine, setMachine]     = useState("M1");
  const [jobno, setJobno]         = useState("");
  const [shiftDate, setShiftDate] = useState(todayISO());
  const [shiftType, setShiftType] = useState<"Day" | "Night" | "">("");
  const [batches, setBatches]     = useState<BatchRow[]>([makeBlank(`${uid}-0`)]);
  const [sigProd, setSigProd]     = useState("");
  const [submittingNew, setSubmittingNew] = useState(false);

  const addBatch = () => {
    if (batches.length >= 4) { showToast("Maximum 4 batch entries per shift.", true); return; }
    setBatches(prev => [...prev, makeBlank(`${uid}-${Date.now()}`)]);
  };

  const removeBatch = (id: string) => {
    if (batches.length === 1) { showToast("At least one batch entry required.", true); return; }
    setBatches(prev => prev.filter(b => b.id !== id));
  };

  const changeBatch = (id: string, field: keyof BatchRow, val: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b));
  };

  const resetNew = () => {
    setJobno(""); setShiftType(""); setShiftDate(todayISO()); setSigProd("");
    setBatches([makeBlank(`${uid}-r${Date.now()}`)]);
  };

  const handleCreateShift = async () => {
    if (!user) { showToast("Session expired — sign in again.", true); return; }
    if (!shiftType) { showToast("Select shift type (Day/Night).", true); return; }
    if (batches.length === 0) { showToast("Add at least one batch entry.", true); return; }

    setSubmittingNew(true);
    try {
      // Resolve factory_id
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("factory_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      const factoryId = roleRow?.factory_id ?? null;

      // INSERT shift — production creates it first
      const { data: shift, error: shiftErr } = await supabase
        .from("shifts")
        .insert({
          user_id:              user.id,
          factory_id:           factoryId,
          machine,
          jobno:                jobno.trim() || null,
          shift_date:           shiftDate,
          shift_type:           shiftType,
          sig_production:       sigProd.trim() || null,
          production_submitted: true,
          // operator_submitted defaults to false in DB (migration 010)
          lab_submitted:        false,
        })
        .select("id")
        .single();

      if (shiftErr || !shift) {
        showToast("Could not create shift: " + (shiftErr?.message ?? "unknown"), true);
        return;
      }

      // INSERT batch entries with production's fields
      const rows = batches.map((b, i) => ({
        shift_id:    shift.id,
        seq:         i + 1,
        maal_code:   b.maalCode.trim()   || null,
        sulphur:     b.sulphurInfo.trim() || null,
        oil:         b.oilInfo.trim()     || null,
        // operator fields left null — filled in next step
        from_time: null, to_time: null,
        material:  null, calcifier: null,
        blower_in: null, blower_out: null,
        work:      null,
      }));

      const { error: batchErr } = await supabase.from("batch_entries").insert(rows);
      if (batchErr) {
        showToast("Shift created but batch entries failed: " + batchErr.message, true);
        return;
      }

      showToast("Shift created ✓ — operator will now fill machine / checkpoint details.");
      resetNew();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmittingNew(false);
    }
  };

  // ── Pending: fill planned/actual on operator-submitted shifts ─────────────
  const [pending, setPending]       = useState<PendingShift[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [activeShift, setActiveShift] = useState<PendingShift | null>(null);
  const [planned, setPlanned]       = useState("");
  const [actual, setActual]         = useState("");
  const [batchNo, setBatchNo]       = useState("");
  const [bags, setBags]             = useState("");
  const [reason, setReason]         = useState("");
  const [submittingFill, setSubmittingFill] = useState(false);

  const loadPending = useCallback(async () => {
    setLoadingPending(true);
    // Show operator-submitted shifts where production hasn't added planned/actual yet
    // (We reuse production_submitted=true as "production created it" —
    //  the pending queue is now shifts where operator_submitted=true but
    //  planned/actual haven't been filled yet, i.e. bags IS NULL)
    const { data, error } = await supabase
      .from("shifts")
      .select("id, machine, shift_date, shift_type, operator, jobno, operator_submitted")
      .eq("operator_submitted", true)
      .is("bags", null)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PendingShift[]);
    setLoadingPending(false);
  }, [supabase, showToast]);

  useEffect(() => {
    if (tab === "pending") loadPending();
  }, [tab, loadPending]);

  const handleFillProduction = async () => {
    if (!activeShift || !user) return;
    setSubmittingFill(true);
    const { error } = await supabase.from("shifts").update({
      planned:  parseFloat(planned) || 0,
      actual:   parseFloat(actual)  || 0,
      batch_no: batchNo.trim()      || null,
      bags:     parseFloat(bags)    || 0,
      reason:   reason              || null,
    }).eq("id", activeShift.id);

    if (error) showToast("Could not save: " + error.message, true);
    else {
      showToast("Production figures saved ✓");
      setActiveShift(null);
      loadPending();
    }
    setSubmittingFill(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["new", "pending"] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setActiveShift(null); }}
            style={{
              padding: "7px 18px", borderRadius: 20, fontSize: 13, cursor: "pointer",
              border: "1px solid var(--line)",
              background: tab === t ? "var(--clay)" : "var(--surface)",
              color: tab === t ? "#fff" : "var(--ink)",
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === "new" ? "New Job Card Entry" : "Pending Production Figures"}
          </button>
        ))}
      </div>

      {/* ── TAB: New Entry ─────────────────────────────────────────────────── */}
      {tab === "new" && (
        <>
          <div className="card">
            <h3>New Job Card Entry</h3>
            <div className="field-hint" style={{ marginBottom: 12 }}>
              Production fills this first. Operator will then add machine / checkpoint details.
            </div>

            <div className="row2">
              <div>
                <label>Machine</label>
                <select value={machine} onChange={e => setMachine(e.target.value)}>
                  <option value="M1">M1</option>
                  <option value="M2">M2</option>
                </select>
              </div>
              <div>
                <label>Job Number</label>
                <input type="text" placeholder="e.g. JB-0451" value={jobno}
                  onChange={e => setJobno(e.target.value)} />
              </div>
            </div>

            <div className="row2">
              <div>
                <label>Shift Date *</label>
                <input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} />
              </div>
              <div>
                <label>Shift *</label>
                <div className="chip-group">
                  {(["Day", "Night"] as const).map(s => (
                    <div key={s} className={`chip${shiftType === s ? " selected" : ""}`}
                      onClick={() => setShiftType(s)}>
                      {s === "Day" ? "Day (8am–8pm)" : "Night (8pm–8am)"}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <label>Production Incharge Sign</label>
            <input type="text" placeholder="Name" value={sigProd}
              onChange={e => setSigProd(e.target.value)} />
          </div>

          {/* Batch entries */}
          <div className="card">
            <div className="helper-row">
              <h3 style={{ margin: 0 }}>Batch Entries</h3>
              <span className="count">{batches.length} / 4</span>
            </div>
            <div className="field-hint" style={{ marginBottom: 10 }}>
              Add one entry per batch. Fill material code, sulphur and oil details.
            </div>

            {batches.map((b, i) => (
              <div key={b.id} style={{
                border: "1px solid var(--line)", borderRadius: 8,
                padding: 14, marginBottom: 10,
                background: "var(--surface)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Batch {i + 1}</span>
                  {batches.length > 1 && (
                    <button type="button" className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "3px 10px", color: "var(--warn)" }}
                      onClick={() => removeBatch(b.id)}>
                      Remove
                    </button>
                  )}
                </div>

                <label>Maal ka Code Number</label>
                <input type="text" placeholder="e.g. SC-001"
                  value={b.maalCode} onChange={e => changeBatch(b.id, "maalCode", e.target.value)} />

                <label>Sulphur — Supplier / Lot Number / खाली करने की तारीख</label>
                <input type="text" placeholder="e.g. ABC Sulphur / LOT-2024-05 / 21-Aug-2024"
                  value={b.sulphurInfo} onChange={e => changeBatch(b.id, "sulphurInfo", e.target.value)} />

                <label>Oil — Supplier / Batch Number / Oil Quantity</label>
                <input type="text" placeholder="e.g. XYZ Oil / B-201 / 50 kg"
                  value={b.oilInfo} onChange={e => changeBatch(b.id, "oilInfo", e.target.value)} />
              </div>
            ))}

            <button type="button" className="btn btn-ghost" onClick={addBatch}>
              + Add batch entry
            </button>
          </div>

          <button className="btn btn-primary" type="button"
            disabled={submittingNew} onClick={handleCreateShift}>
            {submittingNew ? "Creating…" : "Create Job Card Entry"}
          </button>
        </>
      )}

      {/* ── TAB: Pending production figures ────────────────────────────────── */}
      {tab === "pending" && !activeShift && (
        <div className="card">
          <h3>Shifts pending production figures</h3>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            These shifts have been filled by the operator. Add planned/actual bag counts.
          </div>
          {loadingPending ? (
            <div className="empty">Loading…</div>
          ) : pending.length === 0 ? (
            <div className="empty">No shifts pending production figures.</div>
          ) : (
            pending.map(s => (
              <div className="pending-item" key={s.id}
                onClick={() => { setActiveShift(s); setPlanned(""); setActual(""); setBatchNo(""); setBags(""); setReason(""); }}>
                <div className="pi-top">
                  <span>{s.machine} · {s.shift_date}</span>
                  <span>{s.shift_type}</span>
                </div>
                <div className="pi-sub">Operator: {s.operator ?? "—"} · Job: {s.jobno ?? "—"}</div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "pending" && activeShift && (
        <>
          <button className="back-link" type="button" onClick={() => setActiveShift(null)}>
            ← Back to list
          </button>
          <div className="readonly-block">
            <b>{activeShift.machine}</b> · {activeShift.shift_date} · {activeShift.shift_type} shift
            {activeShift.operator && <> · Operator: {activeShift.operator}</>}
          </div>

          <div className="card">
            <h3>Production figures</h3>
            <div className="row2">
              <div>
                <label>Planned production (bags)</label>
                <input type="number" min="0" placeholder="0" value={planned}
                  onChange={e => setPlanned(e.target.value)} />
              </div>
              <div>
                <label>Actual bags produced</label>
                <input type="number" min="0" placeholder="0" value={actual}
                  onChange={e => setActual(e.target.value)} />
              </div>
            </div>
            <div className="row2">
              <div>
                <label>Batch No.</label>
                <input type="text" placeholder="Batch no." value={batchNo}
                  onChange={e => setBatchNo(e.target.value)} />
              </div>
              <div>
                <label>Bags (final tally)</label>
                <input type="number" min="0" placeholder="0" value={bags}
                  onChange={e => setBags(e.target.value)} />
              </div>
            </div>
            <label>Reason for low production (if any)</label>
            <select value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">— None / target met —</option>
              {LOW_PROD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <button className="btn btn-primary" type="button"
            disabled={submittingFill} onClick={handleFillProduction}>
            {submittingFill ? "Saving…" : "Save production figures"}
          </button>
        </>
      )}
    </>
  );
}
