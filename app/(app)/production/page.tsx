"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

interface Shift {
  id: string;
  machine: string;
  shift_date: string;
  shift_type: string;
  operator: string | null;
  jobno: string | null;
}

export default function ProductionPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]           = useState<Shift[]>([]);
  const [loadingList, setLoadingList]   = useState(true);
  const [activeShift, setActiveShift]   = useState<Shift | null>(null);
  const [planned, setPlanned]           = useState("");
  const [actual, setActual]             = useState("");
  const [batchNo, setBatchNo]           = useState("");
  const [bags, setBags]                 = useState("");
  const [reason, setReason]             = useState("");
  const [sigProd, setSigProd]           = useState("");
  const [submitting, setSubmitting]     = useState(false);

  const loadPending = async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("id, machine, shift_date, shift_type, operator, jobno")
      .eq("production_submitted", false)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending(data ?? []);
    setLoadingList(false);
  };

  useEffect(() => { loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFill = (shift: Shift) => {
    setActiveShift(shift);
    setPlanned(""); setActual(""); setBatchNo(""); setBags(""); setReason(""); setSigProd("");
  };

  const goBack = () => setActiveShift(null);

  const handleSubmit = async () => {
    if (!activeShift || !user) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("shifts")
      .update({
        planned: parseFloat(planned) || 0,
        actual:  parseFloat(actual)  || 0,
        batch_no: batchNo.trim(),
        bags:    parseFloat(bags)    || 0,
        reason,
        sig_production: sigProd.trim(),
        production_submitted: true,
        production_user_id: user.id,
      })
      .eq("id", activeShift.id);

    if (error) showToast("Could not submit: " + error.message, true);
    else { showToast("Production details submitted ✓"); goBack(); loadPending(); }
    setSubmitting(false);
  };

  if (activeShift) {
    return (
      <>
        <button className="back-link" onClick={goBack}>← Back to list</button>
        <div className="readonly-block">
          <b>{activeShift.machine}</b> · {activeShift.shift_date} · {activeShift.shift_type} shift<br />
          Operator: {activeShift.operator ?? "—"} · Job: {activeShift.jobno ?? "—"}
        </div>

        <div className="card">
          <h3>Production details</h3>
          <div className="row2">
            <div>
              <label>Planned production (bags)</label>
              <input type="number" min="0" placeholder="0" value={planned} onChange={e => setPlanned(e.target.value)} />
            </div>
            <div>
              <label>Actual bags produced</label>
              <input type="number" min="0" placeholder="0" value={actual} onChange={e => setActual(e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Batch no.</label>
              <input type="text" placeholder="Batch no." value={batchNo} onChange={e => setBatchNo(e.target.value)} />
            </div>
            <div>
              <label>Bags (final tally)</label>
              <input type="number" min="0" placeholder="0" value={bags} onChange={e => setBags(e.target.value)} />
            </div>
          </div>
          <label>Reason for low production (if any)</label>
          <select value={reason} onChange={e => setReason(e.target.value)}>
            <option value="">-- None / target met --</option>
            <option value="Jaali bharna">1. Mesh clogging</option>
            <option value="Machine kharab">2. Machine breakdown</option>
            <option value="Bijli band">3. Power failure</option>
            <option value="Kacha maal">4. Raw material issue</option>
            <option value="Roller jam">5. Roller jam</option>
            <option value="Nitrogen unit">6. Nitrogen unit issue</option>
          </select>
          <label>Production incharge</label>
          <input type="text" placeholder="Name" value={sigProd} onChange={e => setSigProd(e.target.value)} />
        </div>

        <button
          className="btn btn-primary"
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Submitting…" : "Submit production details"}
        </button>
      </>
    );
  }

  return (
    <div className="card">
      <h3>Shifts pending production input</h3>
      {loadingList ? (
        <div className="empty">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="empty">No shifts pending production input.</div>
      ) : (
        pending.map(s => (
          <div className="pending-item" key={s.id} onClick={() => openFill(s)}>
            <div className="pi-top">
              <span>{s.machine} · {s.shift_date}</span>
              <span>{s.shift_type}</span>
            </div>
            <div className="pi-sub">
              Operator: {s.operator ?? "—"} · Job: {s.jobno ?? "—"}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
