/**
 * useEffectiveRole — returns the role the current user is acting as.
 *
 * For normal users: their real profile.role.
 * For factory_admin / company_admin: the demo role selected on the role picker
 * (stored in sessionStorage as jsci_demo_role), or null if none selected.
 *
 * Reacts to a custom "jsci-demo-role-change" window event so every component
 * (AppNav, AppHeader, pages) updates immediately when the role is switched
 * — without a full page reload.
 *
 * Use this instead of profile.role wherever role-gating logic lives.
 */

import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import type { AppRole } from "./types";

const DEMO_ROLE_KEY = "jsci_demo_role";
export const DEMO_ROLE_EVENT = "jsci-demo-role-change";

function readDemoRole(): AppRole | null {
  try {
    return (sessionStorage.getItem(DEMO_ROLE_KEY) as AppRole) ?? null;
  } catch {
    return null;
  }
}

/** Returns the effective role. isAdmin flag tells callers this is an admin
 *  operating in demo mode (so they can show role-switch UI). */
export function useEffectiveRole(): {
  effectiveRole: AppRole | null;
  realRole: AppRole | null;
  isAdmin: boolean;
  demoRole: AppRole | null;
} {
  const { profile } = useAuth();
  const realRole = profile?.role ?? null;
  const isAdmin = realRole === "factory_admin" || realRole === "company_admin";

  const [demoRole, setDemoRoleState] = useState<AppRole | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setDemoRoleState(null);
      return;
    }
    // Initial read
    setDemoRoleState(readDemoRole());

    // React to role switches from anywhere in the app
    const handler = () => setDemoRoleState(readDemoRole());
    window.addEventListener(DEMO_ROLE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(DEMO_ROLE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [isAdmin]);

  const effectiveRole = isAdmin ? (demoRole ?? realRole) : realRole;

  return { effectiveRole, realRole, isAdmin, demoRole };
}
