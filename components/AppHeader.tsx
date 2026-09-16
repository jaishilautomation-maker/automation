"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { FACTORY_NAME } from "@/lib/factory-config";
import { getDemoRole, setDemoRole } from "@/app/(app)/select-module/page";
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

const DEMO_ROLE_LABELS: Partial<Record<AppRole, string>> = {
  production_incharge: "Production",
  chemist:             "Lab / QC",
  stores:              "Stores",
  operator:            "Operator",
};

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const { title, sub } = useModuleTitle();

  // Read demo role from sessionStorage (only relevant for factory_admin)
  const [demoRole, setDemoRoleState] = useState<AppRole | null>(null);
  useEffect(() => {
    if (profile?.role === "factory_admin" || profile?.role === "company_admin") {
      setDemoRoleState(getDemoRole());
    }
  }, [profile?.role]);

  const isAdmin = profile?.role === "factory_admin" || profile?.role === "company_admin";

  const handleLogout = async () => {
    setDemoRole(null);
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const handleSwitchRole = () => {
    setDemoRole(null);
    setDemoRoleState(null);
    router.push("/select-module");
  };

  const displayRole = isAdmin && demoRole
    ? `Admin · ${DEMO_ROLE_LABELS[demoRole] ?? demoRole}`
    : isAdmin
    ? "Admin"
    : (profile?.role ?? "—");

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
        {isAdmin && demoRole && (
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
