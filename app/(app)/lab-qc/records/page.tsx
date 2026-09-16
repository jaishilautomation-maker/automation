"use client";

// =============================================================================
// Lab QC — Records
//
// Shows the current user's submitted QC records across all activity types.
// lab_manager / factory_admin / company_admin see all records at their factory.
// chemist sees only their own (filtered by chemist_id).
// =============================================================================

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import Link from "next/link";

type ActivityType = "rm_receipt" | "rm_qc" | "batch_analysis" | "product_qc"
  | "hourly_reading" | "post_production_test" | "lab_trial";

interface RecordRow {
  id: string;
  table: ActivityType;
  label: string;
  date: string;
  batch_number?: string;
  extra?: string;
}

const MANAGER_ROLES = ["lab_manager", "factory_admin", "company_admin"];

export default function LabQcRecordsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);

  const isManager = MANAGER_ROLES.includes(profile?.role ?? "");

  useEffect(() => {
    if (!user || !activeFactory || !profile?.role) return;

    const load = async () => {
      setLoading(true);
      try {
        const all: RecordRow[] = [];
        const factoryFilter = { factory_id: activeFactory.id };
        const ownerFilter   = isManager ? {} : { chemist_id: user.id };

        // rm_qc
        const { data: rmQc } = await supabase
          .from("rm_qc")
          .select("id, test_date, material_id, batch_id, batches(batch_number)")
          .match({ ...factoryFilter, ...ownerFilter })
          .order("test_date", { ascending: false })
          .limit(30);

        (rmQc ?? []).forEach(r => {
          const b = r.batches as { batch_number?: string } | null;
          all.push({
            id: r.id, table: "rm_qc",
            label: "RM QC",
            date: r.test_date,
            batch_number: b?.batch_number,
          });
        });

        // batch_analysis
        const { data: ba } = await supabase
          .from("batch_analysis")
          .select("id, analysis_date, batch_id, batches(batch_number)")
          .match({ ...factoryFilter, ...ownerFilter })
          .order("analysis_date", { ascending: false })
          .limit(30);

        (ba ?? []).forEach(r => {
          const b = r.batches as { batch_number?: string } | null;
          all.push({
            id: r.id, table: "batch_analysis",
            label: "Batch Analysis",
            date: r.analysis_date,
            batch_number: b?.batch_number,
          });
        });

        // product_qc
        const { data: pqc } = await supabase
          .from("product_qc")
          .select("id, test_date, phase, batch_id, batches(batch_number), products(name)")
          .match({ ...factoryFilter, ...ownerFilter })
          .order("test_date", { ascending: false })
          .limit(30);

        (pqc ?? []).forEach(r => {
          const b = r.batches as { batch_number?: string } | null;
          const p = r.products as { name?: string } | null;
          all.push({
            id: r.id, table: "product_qc",
            label: "Product QC",
            date: r.test_date,
            batch_number: b?.batch_number,
            extra: `${p?.name ?? ""}${r.phase !== "none" ? ` · Phase ${r.phase}` : ""}`,
          });
        });

        // lab_trials
        const { data: lt } = await supabase
          .from("lab_trials")
          .select("id, trial_date, trial_code, status")
          .match({ ...factoryFilter, ...{ chemist_id: user.id } })
          .order("trial_date", { ascending: false })
          .limit(20);

        (lt ?? []).forEach(r => {
          all.push({
            id: r.id, table: "lab_trial",
            label: "Lab Trial",
            date: r.trial_date,
            extra: `${r.trial_code} · ${r.status}`,
          });
        });

        // Sort combined list by date desc
        all.sort((a, b) => (b.date > a.date ? 1 : -1));
        setRecords(all);
      } catch {
        showToast("Could not load records.", true);
      } finally {
        setLoading(false);
      }
    };

    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeFactory, profile?.role]);

  const TABLE_ICONS: Record<ActivityType, string> = {
    rm_receipt: "📦", rm_qc: "🔬", hourly_reading: "⏱",
    batch_analysis: "📊", product_qc: "✅",
    post_production_test: "📅", lab_trial: "🧫",
  };

  return (
    <>
      <Link href="/lab-qc" className="back-link">← Activities</Link>

      <div className="card">
        <div className="helper-row">
          <h3 style={{ margin: 0 }}>
            {isManager ? "All QC Records" : "My QC Records"} — {activeFactory?.name}
          </h3>
          <span className="count">{records.length}</span>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : records.length === 0 ? (
          <div className="empty">No records yet for this factory.</div>
        ) : (
          records.map(r => (
            <div key={`${r.table}-${r.id}`} className="pending-item">
              <div className="pi-top">
                <span>
                  {TABLE_ICONS[r.table]} {r.label}
                  {r.batch_number ? ` · ${r.batch_number}` : ""}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{r.date}</span>
              </div>
              {r.extra && <div className="pi-sub">{r.extra}</div>}
            </div>
          ))
        )}
      </div>
    </>
  );
}
