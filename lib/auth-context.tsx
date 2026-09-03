"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { createClient } from "./supabase-browser";
import type { Session, User } from "@supabase/supabase-js";
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

  // ── Profile loader ─────────────────────────────────────────────────────────
  // Receives the full session so we can call setSession() before querying —
  // this guarantees auth.uid() is set on the client and RLS passes.
  const loadProfile = useCallback(async (session: Session) => {
    const supabase = createClient();
    const u = session.user;

    // Set the session explicitly so RLS (auth.uid()) works correctly even
    // when this runs immediately inside onAuthStateChange before cookies persist.
    await supabase.auth.setSession({
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
    });

    const userPhone = u.phone ?? null;

    const [{ data: profileData }, { data: roleData }] = await Promise.all([
      userPhone
        ? supabase
            .from("profiles")
            .select("id, full_name, phone_number")
            .or(`phone_number.eq.${userPhone},id.eq.${u.id}`)
            .limit(1)
            .maybeSingle()
        : supabase
            .from("profiles")
            .select("id, full_name, phone_number")
            .eq("id", u.id)
            .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.id)
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!profileData) {
      console.warn(
        "[auth-context] No profiles row found for user",
        u.id,
        "phone",
        userPhone,
        "— signing out.",
      );
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setProfileError("not_found");
      return;
    }

    setProfileError(null);
    setProfile({
      id:           profileData.id,
      full_name:    profileData.full_name,
      phone_number: profileData.phone_number ?? userPhone,
      role:         (roleData?.role as AppRole) ?? null,
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await loadProfile(session);
  }, [loadProfile]);

  // ── Session bootstrap + live subscription ─────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session) await loadProfile(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session) {
        await loadProfile(session);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

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
