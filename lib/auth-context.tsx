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
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "./types";

export type { AppRole };

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

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  profileError: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                 = useState<User | null>(null);
  const [profile, setProfile]           = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<"not_found" | null>(null);
  const [loading, setLoading]           = useState(true);
  const loadingProfile                  = useRef(false);

  const loadProfile = useCallback(async (session: Session) => {
    if (loadingProfile.current) return;
    loadingProfile.current = true;

    try {
      const u = session.user;

      // Create a fresh client and inject the access token directly.
      // This ensures auth.uid() resolves correctly in RLS regardless of
      // cookie timing — the JWT is passed explicitly in the Authorization header.
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token:  session.access_token,
        refresh_token: session.refresh_token,
      });

      const [{ data: profileData }, { data: roleData }] = await Promise.all([
        supabase
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
        console.warn("[auth-context] No profile for", u.id, "— signing out");
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
        phone_number: profileData.phone_number ?? u.phone ?? null,
        role:         (roleData?.role as AppRole) ?? null,
      });
    } finally {
      loadingProfile.current = false;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await loadProfile(session);
  }, [loadProfile]);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session) await loadProfile(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // SIGNED_IN fires after verifyOtp — this is when we load the profile.
        // TOKEN_REFRESHED also carries a valid session.
        // Ignore other events to prevent re-entrant calls.
        if (event === "SIGNED_OUT") {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        if (!session) {
          setLoading(false);
          return;
        }
        setUser(session.user);
        await loadProfile(session);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

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

export function useAuth() {
  return useContext(AuthContext);
}
