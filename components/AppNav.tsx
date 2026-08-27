"use client";

// =============================================================================
// AppNav — role + module + factory aware navigation sidebar.
//
// Factory A-20/1 (FACTORY_CODE=A20_1):
//   operator          → A-20/1 shift entry (/operator)
//   production_incharge → production sign-off + Breakdown + PM
//   chemist/lab_manager → lab sign-off (job_card) + Lab QC (lab_qc)
//
// Factory A-20 (FACTORY_CODE=A20):
//   operator          → Production Job Card + Packing Maintenance + Packing Breakdown
//   chemist/lab_manager → Lab QC only
//
// FACTORY_CODE is embedded at build time from NEXT_PUBLIC_FACTORY_CODE.
// Fallback: "A20_1" keeps the existing behaviour unchanged.
// =============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";
import { FACTORY_CODE, FACTORY_NAME } from "@/lib/factory-config";

const IS_FACTORY_SCOPED = !!(
  process.env.NEXT_PUBLIC_FACTORY_CODE &&
  process.env.NEXT_PUBLIC_FACTORY_CODE !== ""
);
const isA20 = FACTORY_CODE === "A20";

export default function AppNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { activeModule } = useModule();
  const role = profile?.role;

  // Hide nav on the module/factory selector itself
  if (pathname === "/select-module") return null;

  // Determine the effective module from context → path → default
  const inferredModule =
    activeModule ??
    (pathname.startsWith("/lab-qc") ? "lab_qc" : "job_card");

  // -------------------------------------------------------------------------
  // Build link sets per factory / module / role
  // -------------------------------------------------------------------------
  let links: { href: string; label: string }[] = [];

  if (inferredModule === "lab_qc") {
    // Lab QC — identical nav on both factory deployments
    links = [
      { href: "/lab-qc",              label: "Activities" },
      { href: "/lab-qc/records",      label: "My records" },
      { href: "/lab-qc/qc-imports",   label: "QC Imports" },
      { href: "/lab-qc/search",       label: "Search" },
      { href: "/dashboard",           label: "Dashboard" },
    ];
    if (role === "lab_manager" || role === "factory_admin" || role === "company_admin") {
      links = [
        { href: "/lab-qc",              label: "Activities" },
        { href: "/lab-qc/records",      label: "Records" },
        { href: "/lab-qc/qc-imports",   label: "QC Imports" },
        { href: "/lab-qc/search",       label: "Search" },
        { href: "/dashboard",           label: "Dashboard" },
      ];
    }
  } else if (isA20) {
    // ── A-20 job_card module ──
    // operator on A-20 handles all three production / packing modules
    if (role === "operator") {
      links = [
        { href: "/production-job-card", label: "Production Job Card" },
        { href: "/packing-maintenance", label: "Packing Maintenance" },
        { href: "/packing-breakdown",   label: "Packing Breakdown" },
        { href: "/dashboard",           label: "Dashboard" },
      ];
    } else if (role === "factory_admin" || role === "company_admin") {
      links = [
        { href: "/production-job-card", label: "Production Job Card" },
        { href: "/packing-maintenance", label: "Packing Maintenance" },
        { href: "/packing-breakdown",   label: "Packing Breakdown" },
        { href: "/dashboard",           label: "Dashboard" },
      ];
    }
  } else {
    // ── A-20/1 job_card module (default) ──
    if (role === "operator") {
      links = [
        { href: "/pulveriser/operator", label: "Pulveriser Job Card" },
        { href: "/operator",  label: "नई एन्ट्री" },
        { href: "/pulveriser/records", label: "Job Card Records" },
        { href: "/records",   label: "मेरी एन्ट्री" },
        { href: "/dashboard", label: "डैशबोर्ड" },
      ];
    } else if (role === "production_incharge") {
      links = [
        { href: "/pulveriser/production", label: "New Pulveriser Job Card" },
        { href: "/production",  label: "Pending shifts" },
        { href: "/breakdown",   label: "Breakdown Register" },
        { href: "/maintenance", label: "Preventive Maintenance" },
        { href: "/pulveriser/records", label: "Job Card Records" },
        { href: "/records",     label: "My submissions" },
        { href: "/dashboard",   label: "Dashboard" },
      ];
    } else if (role === "chemist" || role === "lab_manager") {
      links = [
        { href: "/pulveriser/lab", label: "Pulveriser QC Review" },
        { href: "/lab",       label: "Pending shifts" },
        { href: "/pulveriser/records", label: "Job Card Records" },
        { href: "/records",   label: "My submissions" },
        { href: "/dashboard", label: "Dashboard" },
      ];
    } else if (role === "factory_admin" || role === "company_admin") {
      links = [
        { href: "/pulveriser/records", label: "Pulveriser Job Cards" },
        { href: "/dashboard", label: "Dashboard" },
      ];
    }
  }

  return (
    <nav className="app-nav">
      {/* Factory-scoped: show factory name instead of "⬅ Modules" back link.
          Lab users still get a "⬅ Modules" link since they have two modules. */}
      {IS_FACTORY_SCOPED && role !== "chemist" && role !== "lab_manager" ? (
        <span style={{ fontSize: 11, color: "var(--ink-soft)", padding: "6px 0", display: "block" }}>
          {FACTORY_NAME}
        </span>
      ) : (
        <Link
          href="/select-module"
          aria-current={pathname === "/select-module" ? "page" : undefined}
          title="Switch module / factory"
        >
          ⬅ Modules
        </Link>
      )}

      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || pathname.startsWith(href + "/")
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
