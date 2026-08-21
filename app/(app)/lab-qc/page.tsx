"use client";

// =============================================================================
// Lab QC — Activity Picker
//
// Replaces the old "Coming soon" placeholder.
// Queries factory_activities WHERE factory_id = activeFactory.id
//                               AND module = 'lab_qc'
//                               AND is_active = true
// and renders one tile per activity.
//
// Activity routes:
//   rm_receipt      → /lab-qc/rm-receipt
//   rm_qc           → /lab-qc/rm-qc
//   hourly_reading  → /lab-qc/hourly-reading
//   batch_analysis  → /lab-qc/batch-analysis
//   product_qc      → /lab-qc/product-qc
//   post_production → /lab-qc/post-production
//   lab_trial       → /lab-qc/lab-trials
// =============================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useModule } from "@/lib/module-context";
import { useAuth } from "@/lib/auth-context";
import type { FactoryActivity } from "@/lib/types";

// ---------------------------------------------------------------------------
// Icon + description for each known activity key
// ---------------------------------------------------------------------------
const ACTIVITY_META: Record<string, { icon: string; desc: string }> = {
  rm_receipt:      { icon: "📦", desc: "Log incoming raw material deliveries" },
  rm_qc:           { icon: "🔬", desc: "Record raw material quality test results" },
  hourly_reading:  { icon: "⏱",  desc: "Log hourly production readings" },
  batch_analysis:  { icon: "📊", desc: "End-of-batch quality and analysis" },
  product_qc:      { icon: "✅", desc: "Final product quality control entry" },
  post_production: { icon: "📅", desc: "Post-production stability & retest" },
  lab_trial:       { icon: "🧫", desc: "Trial batches and experimental products" },
};

// Map activity key → route
function activityRoute(activity: string): string {
  const routes: Record<string, string> = {
    rm_receipt:      "/lab-qc/rm-receipt",
    rm_qc:           "/lab-qc/rm-qc",
    hourly_reading:  "/lab-qc/hourly-reading",
    batch_analysis:  "/lab-qc/batch-analysis",
    product_qc:      "/lab-qc/product-qc",
    post_production: "/lab-qc/post-production",
    lab_trial:       "/lab-qc/lab-trials",
  };
  return routes[activity] ?? `/lab-qc/${activity}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function LabQcPage() {
  const router = useRouter();
  const { activeFactory, activeModule, loading: moduleLoading } = useModule();
  const { loading: authLoading } = useAuth();
  const supabase = createClient();

  const [activities, setActivities] = useState<FactoryActivity[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // If no factory is selected yet, redirect back to the module picker
  useEffect(() => {
    if (moduleLoading || authLoading) return;
    if (!activeFactory || activeModule !== "lab_qc") {
      router.replace("/select-module");
    }
  }, [activeFactory, activeModule, moduleLoading, authLoading, router]);

  // Fetch this factory's enabled Lab QC activities
  useEffect(() => {
    if (!activeFactory) return;

    setFetching(true);
    setError(null);

    supabase
      .from("factory_activities")
      .select("*")
      .eq("factory_id", activeFactory.id)
      .eq("module", "lab_qc")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data, error: err }) => {
        if (err) {
          setError("Failed to load activities. Please refresh.");
        } else {
          setActivities((data ?? []) as FactoryActivity[]);
        }
        setFetching(false);
      });
  }, [activeFactory, supabase]);

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------
  if (moduleLoading || authLoading || !activeFactory) {
    return (
      <div className="module-wrap">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (fetching) {
    return (
      <div className="module-wrap">
        <div className="empty">Loading activities…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--warn)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <h3 style={{ color: "var(--ink)", textTransform: "none", fontSize: 15 }}>
            No Lab QC activities configured
          </h3>
          <p className="field-hint" style={{ marginTop: 8 }}>
            No activities have been enabled for <strong>{activeFactory.name}</strong> yet.
            A factory admin can add activity rows to the{" "}
            <code>factory_activities</code> table.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main picker
  // -------------------------------------------------------------------------
  return (
    <div className="module-wrap">
      <div className="module-header">
        <div className="title">🧪 Lab QC</div>
        <div className="sub">
          {activeFactory.name} · Select an activity
        </div>
      </div>

      <div className="module-grid">
        {activities.map(act => {
          const meta = ACTIVITY_META[act.activity] ?? { icon: "📋", desc: "" };
          return (
            <Link
              key={act.id}
              href={activityRoute(act.activity)}
              className="module-tile"
              style={{ textDecoration: "none" }}
            >
              <div className="module-icon">{meta.icon}</div>
              <div className="module-title">{act.label}</div>
              {meta.desc && (
                <div className="module-desc">{meta.desc}</div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
