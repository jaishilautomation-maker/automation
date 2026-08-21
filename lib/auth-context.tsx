"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "./supabase-browser";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "./types";

export type { AppRole };

interface Profile {
  id: string;
  role: AppRole | null;   // null until an admin assigns a factory role
  full_name: string;
  email?: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u: User) => {
    const supabase = createClient();
    const [{ data: profileData }, { data: roleData }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("id", u.id).single(),
      supabase.from("user_roles").select("role").eq("user_id", u.id).order("granted_at", { ascending: false }).limit(1).single(),
    ]);
    if (profileData) {
      setProfile({
        id:        profileData.id,
        full_name: profileData.full_name,
        role:      (roleData?.role as AppRole) ?? null,
        email:     u.email,
      });
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user);
  }, [user, loadProfile]);

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

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
