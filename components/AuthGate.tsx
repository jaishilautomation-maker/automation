"use client";

// =============================================================================
// AuthGate — client-side guard for the (app) route group.
//
// The (app) layout has no server-side auth gate, so before this component a
// deep link into /dashboard, /lab-qc, etc. with an expired/missing session just
// sat on a loading spinner (or rendered a broken page) and never sent the user
// to login. AuthGate fixes that:
//
//   • while auth is still resolving → show a spinner (bounded by the 10s safety
//     timeout in auth-context, so it can never hang forever),
//   • once auth has resolved with NO user (signed out or session expired) →
//     redirect to /login,
//   • otherwise → render the app.
//
// It also hosts the idle-logout watcher (useIdleLogout) so an inactive session
// is signed out after the configured idle window.
// =============================================================================

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useIdleLogout } from "@/lib/use-idle-logout";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Arm the inactivity watcher (full logout after the idle window).
  useIdleLogout();

  // Redirect to login once auth has resolved with no user.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${next}`);
    }
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <div className="module-wrap">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  if (!user) {
    // Redirect is in flight; render nothing rather than a broken shell.
    return (
      <div className="module-wrap">
        <div className="empty">Redirecting to login…</div>
      </div>
    );
  }

  return <>{children}</>;
}
