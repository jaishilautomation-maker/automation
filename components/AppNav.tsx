"use client";

// =============================================================================
// AppNav — role + module aware navigation sidebar.
//
// Job Card links: operator / production_incharge / lab-sign-off / dashboard
// Lab QC links:   lab-qc activity picker / lab-qc records / dashboard
//
// The active module is read from ModuleContext (set on the select-module page).
// If no module has been chosen yet (e.g. first visit after login), the nav
// falls back to role-based inference so returning users are never stuck.
// =============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useModule } from "@/lib/module-context";

export default function AppNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { activeModule } = useModule();
  const role = profile?.role;

  // Hide nav on the module/factory selector itself
  if (pathname === "/select-module") return null;

  // Determine the effective module:
  //   1. Use the explicit context selection if available.
  //   2. Otherwise infer from the current path (handles direct URL access).
  //   3. Fall back to role-based default.
  const inferredModule =
    activeModule ??
    (pathname.startsWith("/lab-qc") ? "lab_qc" : "job_card");

  // -------------------------------------------------------------------------
  // Build link sets per module + role
  // -------------------------------------------------------------------------

  let links: { href: string; label: string }[] = [];

  if (inferredModule === "lab_qc") {
    // Lab QC — all QC roles land on the activity picker (/lab-qc)
    // then drill into sub-routes; records and search are shared
    links = [
      { href: "/lab-qc",          label: "Activities" },
      { href: "/lab-qc/records",  label: "My records" },
      { href: "/lab-qc/search",   label: "Search" },
      { href: "/dashboard",       label: "Dashboard" },
    ];

    // Managers and admins get a link back to all records (not just their own)
    if (
      role === "lab_manager" ||
      role === "factory_admin" ||
      role === "company_admin"
    ) {
      links = [
        { href: "/lab-qc",          label: "Activities" },
        { href: "/lab-qc/records",  label: "Records" },
        { href: "/lab-qc/search",   label: "Search" },
        { href: "/dashboard",       label: "Dashboard" },
      ];
    }
  } else {
    // Job Card
    if (role === "operator") {
      links = [
        { href: "/operator",  label: "नई एन्ट्री" },
        { href: "/records",   label: "मेरी एन्ट्री" },
        { href: "/dashboard", label: "डैशबोर्ड" },
      ];
    } else if (role === "production_incharge") {
      links = [
        { href: "/production",  label: "Pending shifts" },
        { href: "/breakdown",   label: "Breakdown Register" },
        { href: "/maintenance", label: "Preventive Maintenance" },
        { href: "/records",     label: "My submissions" },
        { href: "/dashboard",   label: "Dashboard" },
      ];
    } else if (role === "chemist" || role === "lab_manager") {
      // Job Card lab sign-off (different from Lab QC module)
      links = [
        { href: "/lab",       label: "Pending shifts" },
        { href: "/records",   label: "My submissions" },
        { href: "/dashboard", label: "Dashboard" },
      ];
    } else if (role === "factory_admin" || role === "company_admin") {
      links = [
        { href: "/dashboard", label: "Dashboard" },
      ];
    }
  }

  return (
    <nav className="app-nav">
      {/* Always show a back-to-modules link */}
      <Link
        href="/select-module"
        aria-current={pathname === "/select-module" ? "page" : undefined}
        title="Switch module / factory"
      >
        ⬅ Modules
      </Link>

      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href || pathname.startsWith(href + "/") ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
