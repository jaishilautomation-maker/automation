"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { AppRole } from "@/lib/types";

// Which modules a role can access
function allowedModules(role: AppRole | null): ("job_card" | "lab_qc")[] {
  if (!role) return [];
  const jobCardRoles: AppRole[] = ["operator", "production_incharge", "factory_admin", "company_admin", "viewer"];
  const labQcRoles:   AppRole[] = ["chemist", "lab_manager", "factory_admin", "company_admin", "viewer"];
  const modules: ("job_card" | "lab_qc")[] = [];
  if (jobCardRoles.includes(role)) modules.push("job_card");
  if (labQcRoles.includes(role))   modules.push("lab_qc");
  return modules;
}

// Where each role lands inside a module
function moduleEntryPath(module: "job_card" | "lab_qc", role: AppRole | null): string {
  if (module === "job_card") {
    if (role === "operator")            return "/operator";
    if (role === "production_incharge") return "/production";
    return "/dashboard";
  }
  // lab_qc
  if (role === "chemist" || role === "lab_manager") return "/lab-qc";
  return "/lab-qc";
}

const MODULE_META = {
  job_card: {
    title:    "Job Card",
    titleHi:  "जॉब कार्ड",
    desc:     "Operator shift entry, production & lab sign-off, shift records.",
    descHi:   "ऑपरेटर शिफ्ट एन्ट्री, प्रोडक्शन और लैब साइन-ऑफ।",
    icon:     "📋",
  },
  lab_qc: {
    title:    "Lab QC",
    titleHi:  "लैब QC",
    desc:     "Raw material receipt, QC testing, batch analysis, product QC.",
    descHi:   "कच्चे माल की रसीद, QC परीक्षण, बैच विश्लेषण।",
    icon:     "🧪",
  },
} as const;

export default function SelectModulePage() {
  const router  = useRouter();
  const { profile, loading } = useAuth();
  const modules = allowedModules(profile?.role ?? null);

  if (loading) {
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

  // Single module — skip the picker entirely, go straight in
  if (modules.length === 1) {
    router.replace(moduleEntryPath(modules[0], profile?.role ?? null));
    return null;
  }

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
              onClick={() => router.push(moduleEntryPath(mod, profile?.role ?? null))}
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
