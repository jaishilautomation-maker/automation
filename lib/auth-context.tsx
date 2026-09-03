"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { createClient } from "./supabase-browser";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "./types";

export type { AppRole };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Profile {
  id: string;
  role: AppRole | null;
  full_name: string;
  phone_number: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  profileError: "not_found" | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  profileError: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                 = useState<User | null>(null);
  const [profile, setProfile]           = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<"not_found" | null>(null);
  const [loading, setLoading]           = useState(true);

  // Prevent re-entrant loadProfile calls
  const loadingProfile = useRef(false);

  // ── Profile loader ─────────────────────────────────────────────────────────
  // Fetches via /api/auth/profile (service-role, bypasses RLS timing issues).
  const loadProfile = useCallback(async (u: User) => {
    if (loadingProfile.current) return;
    loadingProfile.current = true;

    try {
      const resp = await fetch("/api/auth/profile", { credentials: "include" });

      if (resp.status === 404) {
        // No profiles row — not an admin-provisioned account
        console.warn("[auth-context] No profile found for user", u.id, "— signing out.");
        const supabase = createClient();
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setProfileError("not_found");
        return;
      }

      if (!resp.ok) {
        // 401 or server error — leave profile null, don't sign out
        console.error("[auth-context] /api/auth/profile returned", resp.status);
        return;
      }

      const data = await resp.json() as Profile;
      setProfileError(null);
      setProfile(data);
    } finally {
      loadingProfile.current = false;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const supabase = createClient();
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) await loadProfile(u);
  }, [loadProfile]);

  // ── Session bootstrap + live subscription ─────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) await loadProfile(session.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await loadProfile(session.user);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  // ── Sign-out ───────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setProfileError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, profile, profileError, loading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth() {
  return useContext(AuthContext);
}
