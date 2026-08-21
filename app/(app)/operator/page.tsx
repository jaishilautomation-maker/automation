"use client";

import { useState, useCallback, useId } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import BatchEntryBlock, { type BatchEntry } from "@/components/BatchEntryBlock";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function calcHours(start: string, stop: string): number {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = stop.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // overnight
  return diff / 60;
}

function makeBlankBatch(id: string): BatchEntry {
  return { id, from: "", to: "", material: "", calcifier: "", blowerIn: "", blowerOut: "", work: "" };
}

export default function OperatorPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();
  const uid = useId();

  const [machine, setMachine]     = useState("M1");
  const [jobno, setJobno]         = useState("");
  const [operator, setOperator]   = useState("");
  const [date, setDate]           = useState(todayISO());
  const [shiftType, setShiftType] = useState<"Day" | "Night" | "">("");
  const [batches, setBatches]     = useState<BatchEntry[]>([makeBlankBatch(`${uid}-0`)]);
  const [chkClean, setChkClean]   = useState(false);
  const [chkRoller, setChkRoller] = useState(false);
  const [chkMesh, setChkMesh]     = useState(false);
  const [hrsStart, setHrsStart]   = useState("");
  const [hrsStop, setHrsStop]     = useState("");
  const [sigOp, setSigOp]         = useState("");
  const [sigMaint, setSigMaint]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  const addBatch = useCallback(() => {
    if (batches.length >= 4) { showToast("एक शिफ्ट में अधिकतम 4 बैच एन्ट्री", true); return; }
    setBatches(prev => [...prev, makeBlankBatch(`${uid}-${Date.now()}`)]);
  }, [batches.length, uid, showToast]);

  const removeBatch = useCallback((id: string) => {
    setBatches(prev => prev.filter(b => b.id !== id));
  }, []);

  const changeBatch = useCallback((id: string, field: keyof BatchEntry, value: string) => {
    setBatches(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  }, []);

  const hoursTotal = calcHours(hrsStart, hrsStop);

  const reset = () => {
    setJobno(""); setOperator(""); setShiftType(""); setDate(todayISO());
    setBatches([makeBlankBatch(`${uid}-r${Date.now()}`)]);
    setChkClean(false); setChkRoller(false); setChkMesh(false);
    setHrsStart(""); setHrsStop("");
    setSigOp(""); setSigMaint("");
  };

  const handleSubmit = async () => {
    if (!user) { showToast("Session expired — sign in again", true); return; }
    if (!shiftType) { showToast("शिफ्ट चुनें (दिन/रात)", true); return; }
    if (!operator.trim()) { showToast("ऑपरेटर का नाम डालें", true); return; }
    if (batches.length === 0) { showToast("कम से कम एक बैच एन्ट्री जोड़ें", true); return; }

    setSubmitting(true);
    try {
      // Resolve factory_id from the user's role row (null = no factory assigned yet)
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("factory_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      const factoryId = roleRow?.factory_id ?? null;

      const { data: insertedShift, error: shiftErr } = await supabase
        .from("shifts")
        .insert({
          user_id: user.id,
          factory_id: factoryId,
          machine,
          jobno,
          operator,
          shift_date: date,
          shift_type: shiftType,
          checkpoint_cleaning: chkClean,
          checkpoint_roller: chkRoller,
          checkpoint_mesh: chkMesh,
          hours_total: hoursTotal,
          sig_operator: sigOp.trim(),
          sig_maintenance: sigMaint.trim(),
          production_submitted: false,
          lab_submitted: false,
        })
        .select()
        .single();

      if (shiftErr || !insertedShift) {
        showToast("सबमिट नहीं हो सका: " + (shiftErr?.message ?? "unknown error"), true);
        return;
      }

      const batchRows = batches.map((b, i) => ({
        shift_id: insertedShift.id,
        seq: i + 1,
        from_time: b.from,
        to_time: b.to,
        material: b.material,
        calcifier: b.calcifier,
        blower_in: b.blowerIn,
        blower_out: b.blowerOut,
        work: b.work,
      }));

      const { error: batchErr } = await supabase.from("batch_entries").insert(batchRows);
      if (batchErr) {
        showToast("शिफ्ट सेव हुई, पर बैच विवरण सेव नहीं हुआ: " + batchErr.message, true);
      } else {
        showToast("शिफ्ट एन्ट्री सबमिट हो गई ✓");
        reset();
      }
    } catch {
      showToast("नेटवर्क में समस्या — फिर कोशिश करें।", true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Shift details */}
      <div className="card">
        <h3>शिफ्ट विवरण</h3>
        <div className="row2">
          <div>
            <label>मशीन नंबर</label>
            <select value={machine} onChange={e => setMachine(e.target.value)}>
              <option value="M1">M1</option>
              <option value="M2">M2</option>
            </select>
          </div>
          <div>
            <label>जॉब नंबर</label>
            <input type="text" placeholder="जैसे JB-0451" value={jobno} onChange={e => setJobno(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>ऑपरेटर</label>
            <input type="text" placeholder="ऑपरेटर का नाम" value={operator} onChange={e => setOperator(e.target.value)} />
          </div>
          <div>
            <label>तारीख</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <label>शिफ्ट</label>
        <div className="chip-group">
          {(["Day", "Night"] as const).map(s => (
            <div
              key={s}
              className={`chip${shiftType === s ? " selected" : ""}`}
              onClick={() => setShiftType(s)}
            >
              {s === "Day" ? "दिन (सुबह 8 - रात 8)" : "रात (रात 8 - सुबह 8)"}
            </div>
          ))}
        </div>
      </div>

      {/* Batch entries */}
      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>बैच एन्ट्री</h3>
          <span className="count">{batches.length} / 4</span>
        </div>
        {batches.map((b, i) => (
          <BatchEntryBlock
            key={b.id}
            batch={b}
            index={i}
            onRemove={removeBatch}
            onChange={changeBatch}
          />
        ))}
        <button className="btn btn-ghost" type="button" onClick={addBatch}>
          + बैच एन्ट्री जोड़ें
        </button>
        <div className="small-note">
          इस शिफ्ट में इस्तेमाल हर माल/लॉट के लिए एक एन्ट्री जोड़ें (अधिकतम 4)।
        </div>
      </div>

      {/* Daily checkpoints */}
      <div className="card">
        <h3>दैनिक जाँच बिंदु</h3>
        <div className="checkline">
          <input type="checkbox" checked={chkClean} onChange={e => setChkClean(e.target.checked)} />
          <span>मशीन की सफाई</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkRoller} onChange={e => setChkRoller(e.target.checked)} />
          <span>रोलर की जाँच करना</span>
        </div>
        <div className="checkline">
          <input type="checkbox" checked={chkMesh} onChange={e => setChkMesh(e.target.checked)} />
          <span>जाली के कपड़े की जाँच करना</span>
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
            <label>कुल घंटे (ऑटो)</label>
            <input type="text" disabled value={hoursTotal > 0 ? hoursTotal.toFixed(1) : ""} placeholder="0.0" />
          </div>
        </div>
        <div className="field-hint">कुल घंटे = बंद समय − शुरू समय, अपने आप गणना होती है।</div>
      </div>

      {/* Signatures */}
      <div className="card">
        <h3>हस्ताक्षर</h3>
        <div className="sig-grid">
          <div>
            <label>ऑपरेटर</label>
            <input type="text" placeholder="नाम" value={sigOp} onChange={e => setSigOp(e.target.value)} />
          </div>
          <div>
            <label>मेंटेनन्स इन्चार्ज</label>
            <input type="text" placeholder="नाम" value={sigMaint} onChange={e => setSigMaint(e.target.value)} />
          </div>
        </div>
        <div className="field-hint">टाइप किया गया नाम और समय ही डिजिटल हस्ताक्षर के रूप में दर्ज होता है।</div>
      </div>

      <button
        className="btn btn-primary"
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? "सबमिट हो रहा है…" : "शिफ्ट एन्ट्री सबमिट करें"}
      </button>
    </>
  );
}
