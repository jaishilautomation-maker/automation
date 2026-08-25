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

interface LabBatch {
  id: string;
  seq: number;
  material: string | null;
  from_time: string | null;
  to_time: string | null;
  sulphur: string;
  oil: string;
  bag: string;
  packing: string;
  qc: string;
  stores: string;
}

export default function LabPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [pending, setPending]         = useState<Shift[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [labBatches, setLabBatches]   = useState<LabBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [sigQC, setSigQC]             = useState("");
  const [submitting, setSubmitting]   = useState(false);

  const loadPending = async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from("shifts")
      .select("id, machine, shift_date, shift_type, operator, jobno")
      // operator_submitted=true → operator has filled their part
      // lab_submitted=false    → lab hasn't done theirs yet
      .eq("operator_submitted", true)
      .eq("lab_submitted", false)
      .order("created_at", { ascending: false });
    if (error) showToast("Could not load: " + error.message, true);
    else setPending(data ?? []);
    setLoadingList(false);
  };

  useEffect(() => { loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFill = async (shift: Shift) => {
    setActiveShift(shift);
    setSigQC("");
    setLoadingBatches(true);
    const { data, error } = await supabase
      .from("batch_entries")
      .select("*")
      .eq("shift_id", shift.id)
      .order("seq");
    if (error) showToast("Could not load batch entries.", true);
    setLabBatches(
      (data ?? []).map(r => ({
        id: r.id,
        seq: r.seq,
        material: r.material,
        from_time: r.from_time,
        to_time: r.to_time,
        sulphur: r.sulphur ?? "",
        oil: r.oil ?? "",
        bag: r.bag ?? "",
        packing: r.packing ?? "",
        qc: r.qc ?? "",
        stores: r.stores ?? "",
      }))
    );
    setLoadingBatches(false);
  };

  const goBack = () => { setActiveShift(null); setLabBatches([]); };

  const updateBatchField = (id: string, field: keyof LabBatch, value: string) => {
    setLabBatches(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const handleSubmit = async () => {
    if (!activeShift || !user) return;
    setSubmitting(true);
    try {
      for (const b of labBatches) {
        const { error } = await supabase.from("batch_entries").update({
          sulphur: b.sulphur,
          oil: b.oil,
          bag: b.bag,
          packing: b.packing,
          qc: b.qc,
          stores: b.stores,
        }).eq("id", b.id);
        if (error) throw error;
      }
      const { error: shiftErr } = await supabase.from("shifts").update({
        sig_qc: sigQC.trim(),
        lab_submitted: true,
        lab_user_id: user.id,
      }).eq("id", activeShift.id);
      if (shiftErr) throw shiftErr;

      showToast("Lab / QC details submitted ✓");
      goBack();
      loadPending();
    } catch (e: unknown) {
      showToast("Could not submit: " + (e instanceof Error ? e.message : String(e)), true);
    } finally {
      setSubmitting(false);
    }
  };

  if (activeShift) {
    return (
      <>
        <button className="back-link" onClick={goBack}>← Back to list</button>
        <div className="readonly-block">
          <b>{activeShift.machine}</b> · {activeShift.shift_date} · {activeShift.shift_type} shift<br />
          Operator: {activeShift.operator ?? "—"} · Job: {activeShift.jobno ?? "—"}
        </div>

        {loadingBatches ? (
          <div className="empty">Loading batches…</div>
        ) : (
          labBatches.map((b, i) => (
            <div className="card" key={b.id}>
              <h3>Batch {i + 1} — {b.material ?? "material n/a"} ({b.from_time ?? "—"} to {b.to_time ?? "—"})</h3>
              <div className="row2">
                <div>
                  <label>Sulphur supplier / lot / date</label>
                  <input type="text" value={b.sulphur} onChange={e => updateBatchField(b.id, "sulphur", e.target.value)} />
                </div>
                <div>
                  <label>Oil supplier / batch / qty</label>
                  <input type="text" value={b.oil} onChange={e => updateBatchField(b.id, "oil", e.target.value)} />
                </div>
              </div>
              <div className="row2">
                <div>
                  <label>Finished goods bag</label>
                  <input type="text" value={b.bag} onChange={e => updateBatchField(b.id, "bag", e.target.value)} />
                </div>
                <div>
                  <label>Packing size</label>
                  <input type="text" value={b.packing} onChange={e => updateBatchField(b.id, "packing", e.target.value)} />
                </div>
              </div>
              <div className="row2">
                <div>
                  <label>QC incharge</label>
                  <input type="text" value={b.qc} onChange={e => updateBatchField(b.id, "qc", e.target.value)} />
                </div>
                <div>
                  <label>Stores incharge</label>
                  <input type="text" value={b.stores} onChange={e => updateBatchField(b.id, "stores", e.target.value)} />
                </div>
              </div>
            </div>
          ))
        )}

        <div className="card">
          <h3>QC sign-off</h3>
          <label>QC incharge</label>
          <input type="text" placeholder="Name" value={sigQC} onChange={e => setSigQC(e.target.value)} />
        </div>

        <button
          className="btn btn-primary"
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting ? "Submitting…" : "Submit lab / QC details"}
        </button>
      </>
    );
  }

  return (
    <div className="card">
      <h3>Shifts pending lab / QC sign-off</h3>
      <div className="field-hint" style={{ marginBottom: 10 }}>
        These shifts have been filled by both Production and Operator.
      </div>
      {loadingList ? (
        <div className="empty">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="empty">No shifts pending lab / QC input.</div>
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
