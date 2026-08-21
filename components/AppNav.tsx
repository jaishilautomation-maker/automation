"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function AppNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
  const role = profile?.role;

  // Hide nav on the module selector itself
  if (pathname === "/select-module") return null;

  const links =
    role === "operator"
      ? [
          { href: "/operator",  label: "नई एन्ट्री" },
          { href: "/records",   label: "मेरी एन्ट्री" },
          { href: "/dashboard", label: "डैशबोर्ड" },
        ]
      : role === "production_incharge"
      ? [
          { href: "/production", label: "Pending shifts" },
          { href: "/records",    label: "My submissions" },
          { href: "/dashboard",  label: "Dashboard" },
        ]
      : role === "chemist" || role === "lab_manager"
      ? [
          { href: "/lab",       label: "Pending shifts" },
          { href: "/records",   label: "My submissions" },
          { href: "/dashboard", label: "Dashboard" },
        ]
      : role === "factory_admin" || role === "company_admin"
      ? [
          { href: "/dashboard", label: "Dashboard" },
        ]
      : [];

  return (
    <nav className="app-nav">
      <Link
        href="/select-module"
        aria-current={pathname === "/select-module" ? "page" : undefined}
        title="Switch module"
      >
        ⬅ Modules
      </Link>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
