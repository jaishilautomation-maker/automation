/**
 * useEffectiveRole — returns the role the current user is acting as.
 *
 * For normal users: their real profile.role.
 * For factory_admin / company_admin: the demo role selected on the role picker
 * (stored in sessionStorage as jsci_demo_role), or their real role if no demo
 * role is selected yet.
 *
 * Use this instead of profile.role wherever role-gating logic lives in pages.
 */

import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { getDemoRole } from "@/app/(app)/select-module/page";
import type { AppRole } from "./types";

export function useEffectiveRole(): AppRole | null {
  const { profile } = useAuth();
  const [effectiveRole, setEffectiveRole] = useState<AppRole | null>(profile?.role ?? null);

  useEffect(() => {
    const real = profile?.role ?? null;
    if (real === "factory_admin" || real === "company_admin") {
      const demo = getDemoRole();
      setEffectiveRole(demo ?? real);
    } else {
      setEffectiveRole(real);
    }
  }, [profile?.role]);

  return effectiveRole;
}
