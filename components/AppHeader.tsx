"use client";

import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useEffectiveRole } from "@/lib/use-effective-role";
import { FACTORY_NAME } from "@/lib/factory-config";
import { setDemoRole } from "@/app/(app)/select-module/page";
import type { AppRole } from "@/lib/types";

function useModuleTitle(): { title: string; sub: string } {
  const pathname = usePathname();

  if (pathname.startsWith("/lab-qc")) {
    return {
      title: `Lab QC — JSCI · ${FACTORY_NAME}`,
      sub:   "JSCI/LAB/01 · Rev 01",
    };
  }
  if (
    pathname.startsWith("/pulveriser")  ||
    pathname.startsWith("/operator")    ||
    pathname.startsWith("/stores")      ||
    pathname.startsWith("/production")  ||
    pathname.startsWith("/breakdown")   ||
    pathname.startsWith("/maintenance") ||
    pathname.startsWith("/lab")         ||
    pathname.startsWith("/dashboard")   ||
    pathname.startsWith("/records")
  ) {
    return {
      title: `Job Card — JSCI · ${FACTORY_NAME}`,
      sub:   "JSCI/PROD/02 · Rev 02",
    };
  }
  return {
    title: `JSCI · ${FACTORY_NAME}`,
    sub:   "Job Card & Lab QC",
  };
}

const ROLE_LABELS: Partial<Record<AppRole, string>> = {
  production_incharge: "Production",
  chemist:             "Lab / QC",
  lab_manager:         "Lab Manager",
  stores:              "Stores",
  operator:            "Operator",
  factory_admin:       "Admin",
  company_admin:       "Admin",
  viewer:              "Viewer",
};

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const { isAdmin, demoRole } = useEffectiveRole();
  const router = useRouter();
  const { title, sub } = useModuleTitle();

  const handleLogout = async () => {
    setDemoRole(null);
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const handleSwitchRole = () => {
    // select-module clears the demo role on mount
    router.push("/select-module");
  };

  // Role pill: for admins show "Admin · <demo role>", else the plain role
  const displayRole = isAdmin
    ? demoRole
      ? `Admin · ${ROLE_LABELS[demoRole] ?? demoRole}`
      : "Admin"
    : (ROLE_LABELS[profile?.role as AppRole] ?? profile?.role ?? "—");

  return (
    <header className="app-header">
      <div>
        <div className="title">{title}</div>
        <div className="sub">{sub}</div>
      </div>
      <div className="user-badge">
        <div className="who">
          <b>{profile?.full_name ?? "—"}</b>
          <span className="role-pill">{displayRole}</span>
        </div>
        {isAdmin && (
          <button
            className="btn btn-ghost"
            type="button"
            style={{ fontSize: 12, padding: "4px 10px", marginRight: 6 }}
            onClick={handleSwitchRole}
          >
            ⇄ Switch Role
          </button>
        )}
        <button className="logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
