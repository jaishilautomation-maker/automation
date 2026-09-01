"use client";

// =============================================================================
// Module + Factory router
//
// A-20/1 deployment (FACTORY_CODE=A20_1):
//   The factory is fixed — no picker shown. Navigate immediately by role:
//     operator            → /operator
//     production_incharge → /pulveriser/production
//     chemist/lab_manager → choose Job Card or Lab QC (two tiles)
//     admin/viewer        → /dashboard
//
// A-20 deployment (FACTORY_CODE=A20):
//   Same fast-path — operator → /production-job-card, no picker.
//   chemist/lab_manager → module choice.
//
// Multi-factory deployments (no FACTORY_CODE set):
//   Full two-step module → factory picker (original behaviour, kept intact).
// =============================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  useModule,
  factoriesForModule,
  modulesForUser,
} from "@/lib/module-context";
import { FACTORY_CODE, FACTORY_NAME, DB_FACTORY_CODE } from "@/lib/factory-config";
import type { ActivityModule, AppRole, Factory } from "@/lib/types";

// Is this a factory-scoped deployment?
const IS_FACTORY_SCOPED = !!(
  process.env.NEXT_PUBLIC_FACTORY_CODE &&
  process.env.NEXT_PUBLIC_FACTORY_CODE !== ""
);

// ---------------------------------------------------------------------------
// Landing route per role per module
// ---------------------------------------------------------------------------
function landingPath(module: ActivityModule, role: AppRole | null): string {
  if (module === "job_card") {
    if (FACTORY_CODE === "A20") return "/production-job-card";
    if (role === "operator")                          return "/operator";
    if (role === "stores")                            return "/pulveriser/stores";
    if (role === "production_incharge")               return "/pulveriser/production";
    if (role === "chemist" || role === "lab_manager") return "/lab";
    return "/dashboard";
  }
  return "/lab-qc";
}

// ---------------------------------------------------------------------------
// Module metadata (used when lab user sees two tiles)
// ---------------------------------------------------------------------------
const MODULE_META: Record<ActivityModule, { title: string; desc: string; icon: string }> = {
  job_card: {
    title: "Job Card",
    desc:  "Shift sign-off, lab submission.",
    icon:  "📋",
  },
  lab_qc: {
    title: "Lab QC",
    desc:  "Raw material QC, batch analysis, product QC.",
    icon:  "🧪",
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
    activeFactory,
    loading: moduleLoading,
    setActiveModule,
    setActiveFactory,
  } = useModule();

  const [step, setStep] = useState<"module" | "factory">("module");
  const [pickedModule, setPickedModule] = useState<ActivityModule | null>(null);

  const loading = authLoading || moduleLoading;
  const role    = profile?.role ?? null;
  const modules = modulesForUser(accessList, role);

  // ──────────────────────────────────────────────────────────────────────────
  // FAST PATH: deployment-scoped factory
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (!IS_FACTORY_SCOPED) return;
    if (!activeFactory) return;  // module-context hasn't resolved the factory yet

    // Roles that go directly without showing any picker
    const directRoles: AppRole[] = [
      "operator", "stores", "production_incharge",
      "factory_admin", "company_admin", "viewer",
    ];

    if (role && directRoles.includes(role)) {
      setActiveModule("job_card");
      router.replace(landingPath("job_card", role));
      return;
    }

    // chemist / lab_manager: if they only have one module, go directly
    if (modules.length === 1) {
      setActiveModule(modules[0]);
      router.replace(landingPath(modules[0], role));
      return;
    }

    // chemist / lab_manager with both modules: stay on this page and show
    // the two-tile module picker (factory is already resolved, skip that step)
  }, [loading, activeFactory, role, modules, router, setActiveModule]);

  // ──────────────────────────────────────────────────────────────────────────
  // STANDARD PATH: multi-factory deployment auto-advance
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (IS_FACTORY_SCOPED) return; // handled above
    if (loading) return;
    if (modules.length === 1) {
      setPickedModule(modules[0]);
      setStep("factory");
    }
  }, [loading, modules]);

  useEffect(() => {
    if (IS_FACTORY_SCOPED) return;
    if (!pickedModule) return;
    const factories = factoriesForModule(accessList, pickedModule);
    if (factories.length === 0) return;
    if (factories.length === 1) {
      setActiveModule(pickedModule);
      setActiveFactory(factories[0]);
      router.replace(landingPath(pickedModule, role));
    }
  }, [pickedModule, accessList, role, router, setActiveModule, setActiveFactory]);

  // ──────────────────────────────────────────────────────────────────────────
  // Render states
  // ──────────────────────────────────────────────────────────────────────────

  if (loading || (IS_FACTORY_SCOPED && !activeFactory)) {
    return (
      <div className="module-wrap">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div className="module-wrap">
        <div className="module-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <h3 style={{ color: "var(--ink)", textTransform: "none", fontSize: 15 }}>
            No access yet
          </h3>
          <p className="field-hint" style={{ marginTop: 8 }}>
            Your account is set up but no role has been assigned yet.
            Ask your admin to grant you access.
          </p>
        </div>
      </div>
    );
  }

  // ── Factory-scoped: show module picker for lab roles only ─────────────────
  if (IS_FACTORY_SCOPED) {
    // If we get here the role is chemist/lab_manager with multiple modules
    return (
      <div className="module-wrap">
        <div className="module-header">
          <div className="title">JSCI · {FACTORY_NAME}</div>
          <div className="sub">
            {profile?.full_name ?? profile?.email} ·{" "}
            <span className="role-pill">{role ?? "—"}</span>
          </div>
        </div>

        <p className="module-prompt">Select a module to continue</p>

        <div className="module-grid">
          {modules.map(mod => {
            const meta = MODULE_META[mod];
            return (
              <button
                key={mod}
                className="module-tile"
                type="button"
                onClick={() => {
                  setActiveModule(mod);
                  // activeFactory already resolved by module-context fast-path
                  router.push(landingPath(mod, role));
                }}
              >
                <div className="module-icon">{meta.icon}</div>
                <div className="module-title">{meta.title}</div>
                <div className="module-desc">{meta.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Standard path: module picker ──────────────────────────────────────────
  if (step === "module") {
    return (
      <div className="module-wrap">
        <div className="module-header">
          <div className="title">JSCI — Job Card &amp; Lab QC</div>
          <div className="sub">
            {profile?.full_name ?? profile?.email} ·{" "}
            <span className="role-pill">{role ?? "—"}</span>
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
                  const factories = factoriesForModule(accessList, mod);
                  if (factories.length > 1) setStep("factory");
                }}
              >
                <div className="module-icon">{meta.icon}</div>
                <div className="module-title">{meta.title}</div>
                <div className="module-desc">{meta.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Standard path: factory picker ────────────────────────────────────────
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
              router.push(landingPath(pickedModule!, role));
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
