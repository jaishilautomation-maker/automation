"use client";

// =============================================================================
// Operator — Job Card
//
// NEW FLOW (migration 010):
//   Production creates the shift first → Operator fills this form second.
//
// The operator sees shifts created by production where operator_submitted=false.
// They fill in:
//   - Operator name
//   - Machine checkpoints
//   - Hours (start/stop → auto-calculated total)
//   - Signatures (operator + maintenance)
//   Per batch: from_time, to_time, calcifier VFD, blower valves, work description
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PendingShift {
  id: string;
  machine: string;
  shift_date: string;
  shift_type: string;
  jobno: string | null;
}

interface BatchDetail {
  id: string;
  seq: number;
  maal_code: string | null;
  sulphur: string | null;
  oil: string | null;
  // operator fills these:
  from_time: string;
  to_time: string;
  calcifier: string;
  blower_in: string;
  blower_out: string;
  work: string;
}

function calcHours(start: string, stop: string): number {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = stop.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

export default function OperatorPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]           = useState<PendingShift[]>([]);
  const [loadingList, setLoadingList]   = useState(true);
  const [activeShift, setActiveShift]   = useState<PendingShift | null>(null);
  const [batches, setBatches]           = useState<BatchDetail[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Operator-filled shift-level fields
  const [operatorName, setOperatorName] = useState("");
  const [chkClean, setChkClean]         = useState(false);
  const [chkRoller, setChkRoller]       = useState(false);
  const [chkMesh, setChkMesh]           = useState(false);
  const [hrsStart, setHrsStart]         = useState("");
  const [hrsStop, setHrsStop]           = useState("");
  const [sigOp, setSigOp]               = useState("");
  const [sigMaint, setSigMaint]         = useState("");
  const [submitting, setSubmitting]     = useState(false);

  const hoursTotal = calcHours(hrsStart, hrsStop);

  // ---------------------------------------------------------------------------
  // Load shifts pending operator input
  // ---------------------------------------------------------------------------
  const loadPending = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("id, machine, shift_date, shift_type, jobno")
      // production_submitted=true → production created it
      // operator_submitted=false  → operator hasn't filled it yet
      .eq("production_submitted", true)
      .eq("operator_submitted", false)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending((data ?? []) as PendingShift[]);
    setLoadingList(false);
  }, [supabase, showToast]);

  useEffect(() => { loadPending(); }, [loadPending]);

  // ---------------------------------------------------------------------------
  // Open a shift
  // ---------------------------------------------------------------------------
  const openShift = async (shift: PendingShift) => {
    setActiveShift(shift);
    setOperatorName(""); setChkClean(false); setChkRoller(false); setChkMesh(false);
    setHrsStart(""); setHrsStop(""); setSigOp(""); setSigMaint("");
    setLoadingBatches(true);

    const { data, error } = await supabase
      .from("batch_entries")
      .select("*")
      .eq("shift_id", shift.id)
      .order("seq");

    if (error) { showToast("Could not load batch entries.", true); setLoadingBatches(false); return; }

    setBatches(
      (data ?? []).map(r => ({
        id:         r.id,
        seq:        r.seq,
        maal_code:  r.maal_code,
        sulphur:    r.sulphur,
        oil:        r.oil,
        from_time:  r.from_time  ?? "",
        to_time:    r.to_time    ?? "",
        calcifier:  r.calcifier  ?? "",
        blower_in:  r.blower_in  ?? "",
        blower_out: r.blower_out ?? "",
        work:       r.work       ?? "",
      }))
    );
    setLoadingBatches(false);
  };

  const goBack = () => { setActiveShift(null); setBatches([]); };

  const updateBatch = (id: string, field: keyof BatchDetail, val: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b));
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!activeShift || !user) return;
    if (!operatorName.trim()) { showToast("Operator name is required.", true); return; }

    setSubmitting(true);
    try {
      // Update shift with operator fields
      const { error: shiftErr } = await supabase.from("shifts").update({
        operator:            operatorName.trim(),
        checkpoint_cleaning: chkClean,
        checkpoint_roller:   chkRoller,
        checkpoint_mesh:     chkMesh,
        hours_total:         hoursTotal > 0 ? hoursTotal : null,
        sig_operator:        sigOp.trim()   || null,
        sig_maintenance:     sigMaint.trim() || null,
        operator_submitted:  true,           // marks shift ready for production's pending tab
      }).eq("id", activeShift.id);

      if (shiftErr) { showToast("Could not save shift: " + shiftErr.message, true); return; }

      // Update each batch entry with operator's per-batch details
      for (const b of batches) {
        const { error: bErr } = await supabase.from("batch_entries").update({
          from_time:  b.from_time  || null,
          to_time:    b.to_time    || null,
          calcifier:  b.calcifier  || null,
          blower_in:  b.blower_in  || null,
          blower_out: b.blower_out || null,
          work:       b.work       || null,
        }).eq("id", b.id);
        if (bErr) { showToast("Batch update failed: " + bErr.message, true); return; }
      }

      showToast("Shift details submitted ✓");
      goBack();
      loadPending();
    } catch {
      showToast("Network error — try again.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render — pending list
  // ---------------------------------------------------------------------------
  if (!activeShift) {
    return (
      <div className="card">
        <h3>शिफ्ट विवरण भरें</h3>
        <div className="field-hint" style={{ marginBottom: 10 }}>
          Production ने नई entries बनाई हैं — अपना विवरण भरें।
        </div>
        {loadingList ? (
          <div className="empty">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="empty">कोई pending shift नहीं — सब entries भरी हुई हैं।</div>
        ) : (
          pending.map(s => (
            <div className="pending-item" key={s.id} onClick={() => openShift(s)}>
              <div className="pi-top">
                <span>{s.machine} · {s.shift_date}</span>
                <span>{s.shift_type}</span>
              </div>
              <div className="pi-sub">Job: {s.jobno ?? "—"}</div>
            </div>
          ))
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — fill form
  // ---------------------------------------------------------------------------
  return (
    <>
      <button className="back-link" type="button" onClick={goBack}>← Back to list</button>

      <div className="readonly-block">
        <b>{activeShift.machine}</b> · {activeShift.shift_date} · {activeShift.shift_type} shift
        {activeShift.jobno && <> · Job: {activeShift.jobno}</>}
      </div>

      {/* Operator details */}
      <div className="card">
        <h3>शिफ्ट विवरण</h3>
        <label>ऑपरेटर का नाम *</label>
        <input type="text" placeholder="नाम" value={operatorName}
          onChange={e => setOperatorName(e.target.value)} />
      </div>

      {/* Per-batch details */}
      {loadingBatches ? (
        <div className="card"><div className="empty">Loading batch entries…</div></div>
      ) : (
        batches.map((b, i) => (
          <div className="card" key={b.id}>
            <h3>बैच {b.seq}</h3>

            {/* Read-only: production's fields */}
            {(b.maal_code || b.sulphur || b.oil) && (
              <div style={{
                background: "var(--surface-2, #f9f7f4)",
                border: "1px solid var(--line)",
                borderRadius: 6, padding: "8px 12px",
                marginBottom: 12, fontSize: 12,
              }}>
                {b.maal_code && <div><b>माल Code:</b> {b.maal_code}</div>}
                {b.sulphur && <div><b>Sulphur:</b> {b.sulphur}</div>}
                {b.oil && <div><b>Oil:</b> {b.oil}</div>}
              </div>
            )}

            {/* Operator's fields */}
            <div className="row2">
              <div>
                <label>शुरू समय (From)</label>
                <input type="time" value={b.from_time}
                  onChange={e => updateBatch(b.id, "from_time", e.target.value)} />
              </div>
              <div>
                <label>बंद समय (To)</label>
                <input type="time" value={b.to_time}
                  onChange={e => updateBatch(b.id, "to_time", e.target.value)} />
              </div>
            </div>
            <div className="row2">
              <div>
                <label>Calcifier VFD</label>
                <input type="text" value={b.calcifier}
                  onChange={e => updateBatch(b.id, "calcifier", e.target.value)} />
              </div>
              <div>
                <label>Blower Inlet Valve</label>
                <input type="text" value={b.blower_in}
                  onChange={e => updateBatch(b.id, "blower_in", e.target.value)} />
              </div>
            </div>
            <label>Blower Outlet Valve</label>
            <input type="text" value={b.blower_out}
              onChange={e => updateBatch(b.id, "blower_out", e.target.value)} />
            <label>काम का विवरण (Work)</label>
            <textarea rows={2} value={b.work}
              onChange={e => updateBatch(b.id, "work", e.target.value)} />
          </div>
        ))
      )}

      {/* Checkpoints */}
      <div className="card">
        <h3>दैनिक जाँच बिंदु</h3>
        <div className="checkline">
          <input type="checkbox" checked={chkClean} onChange={e => setChkClean(e.target.checked)} />
          <span>मशीन की सफाई</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkRoller} onChange={e => setChkRoller(e.target.checked)} />
          <span>रोलर की जाँच</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkMesh} onChange={e => setChkMesh(e.target.checked)} />
          <span>जाली के कपड़े की जाँच</span>
        </div>
      </div>

      {/* Hours */}
      <div className="card">
        <h3>तास रिडींग</h3>
        <div className="row3">
          <div>
            <label>शुरू समय</label>
            <input type="time" value={hrsStart} onChange={e => setHrsStart(e.target.value)} />
          </div>
          <div>
            <label>बंद समय</label>
            <input type="time" value={hrsStop} onChange={e => setHrsStop(e.target.value)} />
          </div>
          <div>
            <label>कुल घंटे</label>
            <input type="text" disabled value={hoursTotal > 0 ? hoursTotal.toFixed(1) : ""} placeholder="0.0" />
          </div>
        </div>
      </div>

      {/* Signatures */}
      <div className="card">
        <h3>हस्ताक्षर</h3>
        <div className="row2">
          <div>
            <label>ऑपरेटर</label>
            <input type="text" placeholder="नाम" value={sigOp}
              onChange={e => setSigOp(e.target.value)} />
          </div>
          <div>
            <label>मेंटेनन्स इन्चार्ज</label>
            <input type="text" placeholder="नाम" value={sigMaint}
              onChange={e => setSigMaint(e.target.value)} />
          </div>
        </div>
      </div>

      <button className="btn btn-primary" type="button"
        disabled={submitting} onClick={handleSubmit}>
        {submitting ? "सबमिट हो रहा है…" : "शिफ्ट विवरण सबमिट करें"}
      </button>
    </>
  );
}
