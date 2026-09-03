"use client";

// =============================================================================
// AuthContext — session state for the entire app.
//
// Auth method: phone number + WhatsApp OTP (Supabase phone auth).
//   - signInWithOtp({ phone }) + verifyOtp({ phone, token, type: "sms" })
//     are called directly from the login page — no auth helpers needed here.
//   - This context observes the resulting session via onAuthStateChange and
//     loads the profile once the session is live.
//
// Profile lookup strategy:
//   After a successful OTP verification, Supabase gives us a User object whose
//   u.phone is the E.164 number used to log in.  We look up the profiles row
//   by phone_number (the column added in migration 023) rather than by id,
//   because admin-provisioned accounts are created with the phone pre-set —
//   the profiles.id will always match auth.users.id (FK constraint), but
//   checking by phone_number is the right signal that this person was
//   intentionally provisioned.
//
//   - Profile found  → proceed, load role from user_roles.
//   - Profile NOT found → sign out immediately, set profileError so the login
//     page can show "Account not found — contact admin".  This is the
//     admin-provisioned-only guard: even if someone creates a Supabase auth
//     user manually (e.g. via the seed script without inserting a profiles row),
//     they cannot proceed past login.
// =============================================================================

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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
  role: AppRole | null; // null until an admin assigns a factory role
  full_name: string;
  phone_number: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /** Set when OTP succeeds but no profiles row matches the phone number. */
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
  const [user, setUser]               = useState<User | null>(null);
  const [profile, setProfile]         = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<"not_found" | null>(null);
  const [loading, setLoading]         = useState(true);

  // ── Profile loader ────────────────────────────────────────────────────────
  // Looks up profiles by phone_number (E.164) AND by id (FK) in parallel —
  // uses whichever has data.  The phone_number lookup is the canonical path
  // for OTP-login users; the id fallback handles edge cases like admin accounts
  // that were created before migration 023.
  const loadProfile = useCallback(async (u: User) => {
    const supabase = createClient();

    // The phone on the auth.users row is the E.164 used during OTP sign-in
    const userPhone = u.phone ?? null;

    // Run profile lookup and role fetch concurrently
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
      // No profiles row → this phone number was never provisioned by an admin.
      // Sign out so the session doesn't linger, then surface the error to the
      // login page via profileError state.
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
    if (user) await loadProfile(user);
  }, [user, loadProfile]);

  // ── Session bootstrap + live subscription ─────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) await loadProfile(u);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        await loadProfile(u);
      } else {
        setProfile(null);
        // Don't clear profileError here — login page needs to read it after
        // the forced sign-out in loadProfile above.
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
