"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";

interface ShiftRow {
  id: string;
  shift_date: string;
  machine: string;
  shift_type: string;
  operator: string | null;
  production_submitted: boolean;
  lab_submitted: boolean;
}

export default function RecordsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const supabase = createClient();

  const [records, setRecords]   = useState<ShiftRow[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!user || !profile?.role) return;

    const load = async () => {
      setLoading(true);
      let query = supabase
        .from("shifts")
        .select("id, shift_date, machine, shift_type, operator, production_submitted, lab_submitted")
        .order("created_at", { ascending: false });

      if (profile.role === "operator")            query = query.eq("user_id", user.id);
      if (profile.role === "production_incharge") query = query.eq("production_user_id", user.id);
      // Lab users see all shifts — both pending sign-off and ones they've completed.
      // (lab_user_id is only set after they submit, so filtering by it would hide pending work)
      // No extra filter needed — RLS already scopes to their factory.

      const { data, error } = await query;
      if (error) showToast("Could not load: " + error.message, true);
      else setRecords(data ?? []);
      setLoading(false);
    };

    load();
  }, [user, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading =
    profile?.role === "operator"
      ? "मेरी सबमिट की गई एन्ट्री"
      : profile?.role === "chemist" || profile?.role === "lab_manager"
      ? "All Job Card Shifts"
      : "My submissions";

  return (
    <div className="card">
      <h3>{heading}</h3>
      {loading ? (
        <div className="empty">Loading…</div>
      ) : records.length === 0 ? (
        <div className="empty">No submissions yet.</div>
      ) : (
        records.map(r => (
          <div className="batch-block" key={r.id}>
            <span className="batch-label">
              {r.shift_date} · {r.machine} · {r.shift_type}
            </span>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Operator: <b>{r.operator ?? "—"}</b>
              <br />
              Status:{" "}
              <span className={`badge ${r.production_submitted ? "ok" : "warn"}`}>
                Prod {r.production_submitted ? "✓" : "pending"}
              </span>{" "}
              <span className={`badge ${r.lab_submitted ? "ok" : "warn"}`}>
                Lab {r.lab_submitted ? "✓" : "pending"}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
