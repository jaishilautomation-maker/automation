"use client";

// =============================================================================
// Module + Factory selector
// Flow:
//   1. If user has access to only one module → skip step 1
//   2. User picks a module
//   3. If user has access to only one factory for that module → skip step 3
//   4. User picks a factory
//   5. Navigate to the correct landing route
// =============================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  useModule,
  factoriesForModule,
  modulesForUser,
} from "@/lib/module-context";
import { FACTORY_CODE } from "@/lib/factory-config";
import type { ActivityModule, AppRole, Factory } from "@/lib/types";

// ---------------------------------------------------------------------------
// Where each role lands inside each module
// ---------------------------------------------------------------------------
function moduleEntryPath(module: ActivityModule, role: AppRole | null): string {
  if (module === "job_card") {
    // A-20: operator handles production/packing modules, no shift-entry workflow
    if (FACTORY_CODE === "A20") {
      return "/production-job-card";
    }
    // A-20/1 (default)
    if (role === "operator")                          return "/operator";
    if (role === "production_incharge")               return "/production";
    if (role === "chemist" || role === "lab_manager") return "/lab";
    return "/dashboard";
  }
  // lab_qc → activity picker
  return "/lab-qc";
}

// ---------------------------------------------------------------------------
// Module metadata
// ---------------------------------------------------------------------------
const MODULE_META: Record<ActivityModule, {
  title: string; titleHi: string;
  desc: string;  descHi: string;
  icon: string;
}> = {
  job_card: {
    title:   "Job Card",
    titleHi: "जॉब कार्ड",
    desc:    "Operator shift entry, production & lab sign-off, shift records.",
    descHi:  "ऑपरेटर शिफ्ट एन्ट्री, प्रोडक्शन और लैब साइन-ऑफ।",
    icon:    "📋",
  },
  lab_qc: {
    title:   "Lab QC",
    titleHi: "लैब QC",
    desc:    "Raw material receipt, QC testing, batch analysis, product QC.",
    descHi:  "कच्चे माल की रसीद, QC परीक्षण, बैच विश्लेषण।",
    icon:    "🧪",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function SelectModulePage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const {
    accessList,
    loading: moduleLoading,
    setActiveModule,
    setActiveFactory,
  } = useModule();

  // Step tracks where in the two-step flow we are
  const [step, setStep] = useState<"module" | "factory">("module");
  const [pickedModule, setPickedModule] = useState<ActivityModule | null>(null);

  const loading = authLoading || moduleLoading;
  const modules = modulesForUser(accessList, profile?.role ?? null);

  // Auto-advance: single module → skip module pick
  useEffect(() => {
    if (loading) return;
    if (modules.length === 1) {
      setPickedModule(modules[0]);
      setStep("factory");
    }
  }, [loading, modules]);

  // Auto-advance: once pickedModule is set, check factory count
  useEffect(() => {
    if (!pickedModule) return;
    const factories = factoriesForModule(accessList, pickedModule);
    if (factories.length === 0) return; // wait — might still be loading
    if (factories.length === 1) {
      // Only one factory — commit and navigate immediately
      setActiveModule(pickedModule);
      setActiveFactory(factories[0]);
      router.replace(moduleEntryPath(pickedModule, profile?.role ?? null));
    }
  }, [pickedModule, accessList, profile, router, setActiveModule, setActiveFactory]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="module-wrap">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // No access
  // -------------------------------------------------------------------------
  if (modules.length === 0) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <h3 style={{ color: "var(--ink)", textTransform: "none", fontSize: 15 }}>
            No module access yet
          </h3>
          <p className="field-hint" style={{ marginTop: 8 }}>
            Your account is set up but no factory or module has been assigned.
            Ask your admin to assign you a factory role.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 1 — pick module (skipped if only one)
  // -------------------------------------------------------------------------
  if (step === "module") {
    return (
      <div className="module-wrap">
        <div className="module-header">
          <div className="title">JSCI — Job Card &amp; Lab QC</div>
          <div className="sub">
            {profile?.full_name ?? profile?.email} ·{" "}
            <span className="role-pill">{profile?.role ?? "—"}</span>
          </div>
        </div>

        <p className="module-prompt">Select a module to continue / मॉड्यूल चुनें</p>

        <div className="module-grid">
          {modules.map(mod => {
            const meta = MODULE_META[mod];
            return (
              <button
                key={mod}
                className="module-tile"
                type="button"
                onClick={() => {
                  setPickedModule(mod);
                  // factory step will be handled by the useEffect above;
                  // only show the factory picker if there are multiple factories
                  const factories = factoriesForModule(accessList, mod);
                  if (factories.length > 1) setStep("factory");
                  // if factories.length === 1, the effect auto-navigates
                }}
              >
                <div className="module-icon">{meta.icon}</div>
                <div className="module-title">{meta.title} / {meta.titleHi}</div>
                <div className="module-desc">{meta.desc}</div>
                <div className="module-desc" style={{ marginTop: 4 }}>{meta.descHi}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — pick factory
  // -------------------------------------------------------------------------
  const factories: Factory[] = pickedModule
    ? factoriesForModule(accessList, pickedModule)
    : [];

  return (
    <div className="module-wrap">
      <div className="module-header">
        <div className="title">
          {pickedModule ? MODULE_META[pickedModule].icon : ""}{" "}
          {pickedModule ? MODULE_META[pickedModule].title : ""}
        </div>
        <div className="sub">Select factory / फैक्ट्री चुनें</div>
      </div>

      <button
        type="button"
        className="btn-ghost"
        style={{ marginBottom: 16, fontSize: 13 }}
        onClick={() => { setPickedModule(null); setStep("module"); }}
      >
        ← Back to modules
      </button>

      <div className="module-grid">
        {factories.map(factory => (
          <button
            key={factory.id}
            className="module-tile"
            type="button"
            onClick={() => {
              setActiveModule(pickedModule!);
              setActiveFactory(factory);
              router.push(moduleEntryPath(pickedModule!, profile?.role ?? null));
            }}
          >
            <div className="module-icon">🏭</div>
            <div className="module-title">{factory.name}</div>
            <div className="module-desc">{factory.location ?? factory.code}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
