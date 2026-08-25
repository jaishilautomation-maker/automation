"use client";

// =============================================================================
// ModuleContext — tracks the active module and factory for the current session.
//
// Responsibilities:
//   1. Load all (factory, module, role) combinations the current user holds
//      from user_roles + factories.
//   2. Persist the last selection to sessionStorage so navigating between
//      pages within a session doesn't reset the context.
//   3. Expose setActiveModule / setActiveFactory so select-module can write,
//      and AppNav / page components can read.
// =============================================================================

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { createClient } from "./supabase-browser";
import { useAuth } from "./auth-context";
import type { ActivityModule, Factory, AppRole } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single (factory, module) pair the user is allowed to access. */
export interface UserAccess {
  factory: Factory;
  module: ActivityModule | null; // null = both modules
  role: AppRole;
}

interface ModuleContextValue {
  /** All (factory, module) pairs this user may access. */
  accessList: UserAccess[];
  /** The module the user selected on the module picker. */
  activeModule: ActivityModule | null;
  /** The factory the user selected on the module picker. */
  activeFactory: Factory | null;
  /** True while the initial access list is loading. */
  loading: boolean;
  /** Set by the module/factory picker page after the user makes a choice. */
  setActiveModule: (m: ActivityModule) => void;
  setActiveFactory: (f: Factory) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ModuleContext = createContext<ModuleContextValue>({
  accessList: [],
  activeModule: null,
  activeFactory: null,
  loading: true,
  setActiveModule: () => {},
  setActiveFactory: () => {},
});

// ---------------------------------------------------------------------------
// Storage helpers (sessionStorage — survives navigation, cleared on tab close)
// ---------------------------------------------------------------------------

const SESSION_MODULE_KEY  = "jsci_active_module";
const SESSION_FACTORY_KEY = "jsci_active_factory";

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sessionStorage unavailable (SSR, private mode quota) — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [accessList, setAccessList]     = useState<UserAccess[]>([]);
  const [activeModule, _setActiveModule] = useState<ActivityModule | null>(null);
  const [activeFactory, _setActiveFactory] = useState<Factory | null>(null);
  const [loading, setLoading]           = useState(true);

  // Persisting setters — update state AND sessionStorage atomically
  const setActiveModule = useCallback((m: ActivityModule) => {
    _setActiveModule(m);
    writeSession(SESSION_MODULE_KEY, m);
  }, []);

  const setActiveFactory = useCallback((f: Factory) => {
    _setActiveFactory(f);
    writeSession(SESSION_FACTORY_KEY, f);
  }, []);

  // Load the user's access list from user_roles JOIN factories.
  //
  // FACTORY_CODE fast-path: if this deployment has a fixed factory code
  // (NEXT_PUBLIC_FACTORY_CODE is set), skip the DB query for factories entirely.
  // Load the factory row by code, then build the access list from the user's role
  // in auth-context. This eliminates the "No module access" problem caused by
  // user_roles rows having factory_id=NULL (self-registration default).
  const loadAccessList = useCallback(async (userId: string) => {
    const supabase = createClient();
    setLoading(true);
    try {
      // ── Fast path: deployment-scoped factory ────────────────────────────
      const deploymentCode = process.env.NEXT_PUBLIC_FACTORY_CODE;
      if (deploymentCode) {
        const { data: factoryRow } = await supabase
          .from("factories")
          .select("id, code, name, location, is_active, created_at")
          .eq("code", deploymentCode === "A20_1" ? "DBV_20_1" : deploymentCode === "A20" ? "DBV_20_2" : deploymentCode)
          .eq("is_active", true)
          .maybeSingle();

        if (factoryRow) {
          // Get the user's role from user_roles (any row for this user)
          const { data: roleRow } = await supabase
            .from("user_roles")
            .select("role, module")
            .eq("user_id", userId)
            .order("granted_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const role = (roleRow?.role ?? "operator") as AppRole;
          const module = (roleRow?.module ?? null) as ActivityModule | null;

          const list: UserAccess[] = [{
            factory: factoryRow as unknown as Factory,
            module,
            role,
          }];
          setAccessList(list);

          // Restore or set defaults from sessionStorage
          const savedModule  = readSession<ActivityModule>(SESSION_MODULE_KEY);
          const savedFactory = readSession<Factory>(SESSION_FACTORY_KEY);
          if (savedModule)  _setActiveModule(savedModule);
          if (savedFactory && savedFactory.id === (factoryRow as unknown as Factory).id) {
            _setActiveFactory(savedFactory);
          } else {
            _setActiveFactory(factoryRow as unknown as Factory);
            writeSession(SESSION_FACTORY_KEY, factoryRow);
          }
          return;
        }
      }

      // ── Standard path: multi-factory deployment ──────────────────────────
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          role,
          module,
          factory_id,
          factories (
            id, code, name, location, is_active, created_at
          )
        `)
        .eq("user_id", userId);

      if (error) throw error;

      const list: UserAccess[] = [];
      for (const row of data ?? []) {
        if (!row.factory_id || !row.factories) continue;
        const factory = row.factories as unknown as Factory;
        if (factory.is_active) {
          list.push({
            factory,
            module: row.module as ActivityModule | null,
            role: row.role as AppRole,
          });
        }
      }

      // company_admin — load all active factories
      const hasNullFactory = (data ?? []).some(r => !r.factory_id);
      if (hasNullFactory) {
        const { data: allFactories } = await supabase
          .from("factories")
          .select("*")
          .eq("is_active", true)
          .order("code");

        for (const f of allFactories ?? []) {
          list.push({
            factory: f as Factory,
            module: null,
            role: "company_admin",
          });
        }
      }

      setAccessList(list);

      const savedModule  = readSession<ActivityModule>(SESSION_MODULE_KEY);
      const savedFactory = readSession<Factory>(SESSION_FACTORY_KEY);

      const validModule  = savedModule
        && list.some(a => a.module === null || a.module === savedModule);
      const validFactory = savedFactory
        && list.some(a => a.factory.id === savedFactory.id);

      if (validModule)  _setActiveModule(savedModule!);
      if (validFactory) _setActiveFactory(savedFactory!);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAccessList([]);
      _setActiveModule(null);
      _setActiveFactory(null);
      setLoading(false);
      return;
    }
    loadAccessList(user.id);
  }, [user, authLoading, loadAccessList]);

  return (
    <ModuleContext.Provider
      value={{
        accessList,
        activeModule,
        activeFactory,
        loading,
        setActiveModule,
        setActiveFactory,
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useModule() {
  return useContext(ModuleContext);
}

// ---------------------------------------------------------------------------
// Derived helpers (used by select-module and AppNav)
// ---------------------------------------------------------------------------

/** Unique factories the user can access for a given module (or all if null). */
export function factoriesForModule(
  accessList: UserAccess[],
  module: ActivityModule | null
): Factory[] {
  const seen = new Set<string>();
  const result: Factory[] = [];
  for (const a of accessList) {
    if (module === null || a.module === null || a.module === module) {
      if (!seen.has(a.factory.id)) {
        seen.add(a.factory.id);
        result.push(a.factory);
      }
    }
  }
  return result;
}

/**
 * Unique modules the user can access, derived from their role(s).
 *
 * Uses profileRole (from auth-context) as the authoritative single role
 * for the user, rather than deriving from all accessList entries.
 * This prevents stale or extra user_roles rows from granting unintended access.
 *
 * Rules:
 *  - operator / production_incharge  → job_card only
 *  - chemist / lab_manager           → job_card + lab_qc
 *  - factory_admin / company_admin / viewer → both
 *
 * Falls back to accessList-based derivation if profileRole is null.
 */
export function modulesForUser(
  accessList: UserAccess[],
  profileRole?: AppRole | null
): ActivityModule[] {
  const seen = new Set<ActivityModule>();

  // If we have a definitive role from the auth profile, use that alone.
  const role = profileRole ?? null;
  if (role) {
    switch (role) {
      case "operator":
      case "production_incharge":
        seen.add("job_card");
        break;
      case "chemist":
      case "lab_manager":
        seen.add("job_card");
        seen.add("lab_qc");
        break;
      case "factory_admin":
      case "company_admin":
      case "viewer":
        seen.add("job_card");
        seen.add("lab_qc");
        break;
    }
    return (["job_card", "lab_qc"] as ActivityModule[]).filter(m => seen.has(m));
  }

  // Fallback: derive from all accessList entries (e.g. company_admin with null factory).
  for (const a of accessList) {
    if (a.module !== null) {
      seen.add(a.module);
      continue;
    }
    switch (a.role) {
      case "operator":
      case "production_incharge":
        seen.add("job_card");
        break;
      case "chemist":
      case "lab_manager":
        seen.add("job_card");
        seen.add("lab_qc");
        break;
      default:
        seen.add("job_card");
        seen.add("lab_qc");
    }
  }

  return (["job_card", "lab_qc"] as ActivityModule[]).filter(m => seen.has(m));
}
