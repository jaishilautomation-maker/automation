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
  material_id?: string | null;
  product_id?: string | null;
  phase?: string | null;
}

interface DetailField {
  label: string;
  value: string;
}

interface DetailData {
  meta: [string, string][];
  fields: DetailField[];
  remarks: string | null;
}

const MANAGER_ROLES = ["lab_manager", "factory_admin", "company_admin"];

export default function LabQcRecordsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { activeFactory } = useModule();
  const supabase = createClient();

  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail expand state — keyed by `${table}-${id}`
  const [expandedKey, setExpandedKey]     = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailCache, setDetailCache]     = useState<Record<string, DetailData>>({});

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
            material_id: r.material_id,
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
          .select("id, test_date, phase, product_id, batch_id, batches(batch_number), products(name)")
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
            product_id: r.product_id,
            phase: r.phase,
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

  // -------------------------------------------------------------------------
  // Fetch full record detail on expand (test_results + friendly labels from
  // qc_test_definitions). Cached per record so re-expanding is instant.
  // -------------------------------------------------------------------------
  const toggleDetail = async (r: RecordRow) => {
    const key = `${r.table}-${r.id}`;
    if (expandedKey === key) { setExpandedKey(null); return; }
    setExpandedKey(key);
    if (detailCache[key]) return; // already fetched

    setLoadingDetail(true);
    try {
      let meta: [string, string][] = [];
      let testResults: Record<string, unknown> = {};
      let remarks: string | null = null;
      let defs: { test_key: string; label: string; unit: string | null }[] = [];

      if (r.table === "rm_qc") {
        const { data } = await supabase
          .from("rm_qc")
          .select("test_date, appearance, appearance_ok, test_results, remarks, chemist_id")
          .eq("id", r.id).maybeSingle();
        if (data) {
          testResults = (data.test_results ?? {}) as Record<string, unknown>;
          remarks = data.remarks;
          meta = [
            ["Test Date", data.test_date],
            ["Appearance", data.appearance ?? "—"],
            ["Appearance OK", data.appearance_ok === true ? "Yes" : data.appearance_ok === false ? "No" : "—"],
          ];
        }
        if (r.material_id) {
          const { data: d } = await supabase.from("qc_test_definitions")
            .select("test_key, label, unit").eq("material_id", r.material_id).eq("phase", "none");
          defs = d ?? [];
        }
      } else if (r.table === "batch_analysis") {
        const { data } = await supabase
          .from("batch_analysis")
          .select("analysis_date, appearance, appearance_ok, test_results, remarks")
          .eq("id", r.id).maybeSingle();
        if (data) {
          testResults = (data.test_results ?? {}) as Record<string, unknown>;
          remarks = data.remarks;
          meta = [
            ["Analysis Date", data.analysis_date],
            ["Appearance", data.appearance ?? "—"],
            ["Appearance OK", data.appearance_ok === true ? "Yes" : data.appearance_ok === false ? "No" : "—"],
          ];
        }
        const { data: mat } = await supabase.from("materials").select("id").eq("code", "SULPHUR_POWDER").maybeSingle();
        if (mat) {
          const { data: d } = await supabase.from("qc_test_definitions")
            .select("test_key, label, unit").eq("material_id", mat.id).eq("phase", "B");
          defs = d ?? [];
        }
      } else if (r.table === "product_qc") {
        const { data } = await supabase
          .from("product_qc")
          .select("test_date, appearance, appearance_ok, overall_result, test_results, remarks")
          .eq("id", r.id).maybeSingle();
        if (data) {
          testResults = (data.test_results ?? {}) as Record<string, unknown>;
          remarks = data.remarks;
          meta = [
            ["Test Date", data.test_date],
            ["Appearance", data.appearance ?? "—"],
            ["Appearance OK", data.appearance_ok === true ? "Yes" : data.appearance_ok === false ? "No" : "—"],
            ["Overall Result", data.overall_result ?? "—"],
          ];
        }
        if (r.product_id) {
          const { data: d } = await supabase.from("qc_test_definitions")
            .select("test_key, label, unit").eq("product_id", r.product_id).eq("phase", r.phase ?? "none");
          defs = d ?? [];
        }
      } else if (r.table === "lab_trial") {
        const { data } = await supabase
          .from("lab_trials")
          .select("trial_date, objective, appearance, appearance_ok, conclusion, status, test_results, remarks")
          .eq("id", r.id).maybeSingle();
        if (data) {
          testResults = (data.test_results ?? {}) as Record<string, unknown>;
          remarks = data.remarks;
          meta = [
            ["Trial Date", data.trial_date],
            ["Objective", data.objective ?? "—"],
            ["Appearance", data.appearance ?? "—"],
            ["Status", data.status],
            ["Conclusion", data.conclusion ?? "—"],
          ];
        }
      }

      const defByKey = new Map(defs.map(d => [d.test_key, d]));
      const fields: DetailField[] = Object.entries(testResults).map(([key, val]) => {
        const def = defByKey.get(key);
        const label = def?.label ?? key.replace(/_/g, " ");
        const unit = def?.unit ? ` ${def.unit}` : "";
        return { label, value: val != null ? `${val}${unit}` : "—" };
      });

      setDetailCache(prev => ({ ...prev, [key]: { meta, fields, remarks } }));
    } catch {
      showToast("Could not load record details.", true);
    } finally {
      setLoadingDetail(false);
    }
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
          records.map(r => {
            const key = `${r.table}-${r.id}`;
            const isOpen = expandedKey === key;
            const detail = detailCache[key];
            return (
              <div key={key} className="pending-item" style={{ cursor: "pointer" }}>
                <div className="pi-top" onClick={() => toggleDetail(r)}>
                  <span>
                    {TABLE_ICONS[r.table]} {r.label}
                    {r.batch_number ? ` · ${r.batch_number}` : ""}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    {r.date} {isOpen ? "▲" : "▼"}
                  </span>
                </div>
                {r.extra && <div className="pi-sub">{r.extra}</div>}

                {isOpen && (
                  <div style={{
                    marginTop: 10, paddingTop: 10,
                    borderTop: "1px solid var(--line)",
                  }}>
                    {loadingDetail && !detail ? (
                      <div className="field-hint">Loading details…</div>
                    ) : detail ? (
                      <>
                        {detail.meta.length > 0 && (
                          <table style={{ width: "100%", fontSize: 13, marginBottom: 10 }}>
                            <tbody>
                              {detail.meta.map(([k, v]) => (
                                <tr key={k}>
                                  <td style={{ color: "var(--ink-soft)", padding: "3px 8px 3px 0", whiteSpace: "nowrap" }}>{k}</td>
                                  <td style={{ fontWeight: 600 }}>{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {detail.fields.length > 0 ? (
                          <table style={{ width: "100%", fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", color: "var(--ink-soft)", fontWeight: 600, padding: "3px 8px 3px 0" }}>Parameter</th>
                                <th style={{ textAlign: "left", color: "var(--ink-soft)", fontWeight: 600 }}>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.fields.map(f => (
                                <tr key={f.label} style={{ borderTop: "1px solid var(--line)" }}>
                                  <td style={{ padding: "4px 8px 4px 0" }}>{f.label}</td>
                                  <td style={{ fontWeight: 600 }}>{f.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="field-hint">No test parameters recorded.</div>
                        )}
                        {detail.remarks && (
                          <div style={{ marginTop: 10, fontSize: 13 }}>
                            <span style={{ color: "var(--ink-soft)" }}>Remarks: </span>
                            {detail.remarks}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
