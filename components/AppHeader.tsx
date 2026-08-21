"use client";

import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function useModuleTitle(): { title: string; sub: string } {
  const pathname = usePathname();
  if (pathname.startsWith("/lab-qc")) {
    return { title: "Lab QC — JSCI", sub: "JSCI/LAB/01 · Rev 01" };
  }
  if (
    pathname.startsWith("/operator") ||
    pathname.startsWith("/production") ||
    pathname.startsWith("/lab") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/records")
  ) {
    return { title: "Job Card — Pulveriser", sub: "JSCI/PROD/02 · Rev 02" };
  }
  return { title: "JSCI", sub: "Job Card & Lab QC" };
}

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const router   = useRouter();
  const { title, sub } = useModuleTitle();

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="app-header">
      <div>
        <div className="title">{title}</div>
        <div className="sub">{sub}</div>
      </div>
      <div className="user-badge">
        <div className="who">
          <b>{profile?.full_name ?? profile?.email ?? "—"}</b>
          <span className="role-pill">{profile?.role ?? "—"}</span>
        </div>
        <button className="logout-btn" type="button" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
