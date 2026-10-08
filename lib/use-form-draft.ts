// =============================================================================
// useFormDraft — local autosave of in-progress form input (no Save button).
//
// Problem this solves:
//   If a user is part-way through filling a form and the tab/browser closes,
//   the link is lost, or they navigate away, all typed data is gone. Every
//   role (lab, production, operator, stores) hit this.
//
// What it does:
//   - Persists the live form state to localStorage on every change (debounced).
//     localStorage survives tab close AND full browser restart (unlike
//     sessionStorage, which the module/factory picker uses).
//   - On mount, returns any previously saved draft so the page can seed its
//     state and the UI immediately reflects what the user had typed.
//   - Exposes clear() to wipe the draft after a successful submit.
//   - SSR-safe, quota-safe, never throws. Drafts auto-expire after MAX_AGE so
//     stale data does not accumulate across days.
//
// Usage (any form page):
//
//   const draft = useFormDraft<MyState>(
//     draftKey(pathname, activeFactory?.id, user?.id, batchNumber),
//   );
//
//   // 1. Seed initial state from the saved draft (once, on first render):
//   const [values, setValues] = useState<MyState>(() => draft.initial(DEFAULT));
//
//   // 2. Autosave whenever the live state changes:
//   useEffect(() => { draft.save(values); }, [values, draft]);
//
//   // 3. After a successful DB submit, clear it:
//   draft.clear();
//
// For a form built from many separate useState hooks, assemble them into one
// object for save() and seed each useState initializer from draft.restored.
// For a form instance chosen at runtime (opening a specific record), use
// peekDraft(key) inside the open handler to restore that record's draft.
// =============================================================================

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

const PREFIX   = "jsci_draft_v1:";
const MAX_AGE  = 1000 * 60 * 60 * 24 * 7; // 7 days — drafts older than this are discarded
const DEBOUNCE = 400;                       // ms between localStorage writes

interface Envelope<T> {
  savedAt: number; // epoch ms
  data: T;
}

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Build a stable, collision-free draft key. Undefined/empty parts are skipped
 * so the key stays valid before factory/user have loaded. Include a
 * discriminator (batch no / job no / section id) for forms that exist in
 * multiple independent instances under one route.
 */
export function draftKey(...parts: (string | null | undefined)[]): string {
  return PREFIX + parts.filter(p => p != null && p !== "").join("|");
}

/**
 * Imperative one-shot read of a saved draft by key (outside React render).
 * Use when a form instance is chosen at runtime (e.g. opening a specific
 * record) and you need its draft immediately in an event handler.
 */
export function peekDraft<T>(key: string): T | null {
  return parseEnvelope<T>(readRaw(key), key);
}

export interface FormDraftHandle<T> {
  /** The previously saved draft for this key, or null. Read once on mount. */
  restored: T | null;
  /** Returns the saved draft if present, otherwise the provided fallback. */
  initial: (fallback: T) => T;
  /** Persist the current state (debounced). Call on every change. */
  save: (data: T) => void;
  /** Remove the saved draft (call after a successful submit). */
  clear: () => void;
  /** True if a draft was found and restored on mount. */
  hasDraft: boolean;
}

/** Raw localStorage read for a key, or null. Pure, SSR-safe. */
function readRaw(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Parse + validate a stored envelope string into draft data (or null). */
function parseEnvelope<T>(raw: string | null, key: string): T | null {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.savedAt !== "number") return null;
    if (Date.now() - env.savedAt > MAX_AGE) {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      return null;
    }
    return env.data;
  } catch {
    return null;
  }
}

export function useFormDraft<T>(key: string): FormDraftHandle<T> {
  // Read the saved draft via useSyncExternalStore — the React-sanctioned way to
  // read an external store during render (lint-clean, SSR-safe, and it also
  // picks up cross-tab writes via the "storage" event). getSnapshot returns the
  // raw string so React can compare by value and avoid render loops; we parse
  // the raw string into the typed draft after the snapshot is read.
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    const handler = (e: StorageEvent) => { if (e.key === key || e.key === null) onChange(); };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key]);

  const getSnapshot   = useCallback(() => readRaw(key), [key]);
  const getServerSnap = useCallback(() => null, []);

  const rawSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnap);

  // Parse the raw snapshot into typed draft data, memoised by the raw string so
  // `restored` keeps a STABLE identity across renders while storage is unchanged.
  // Without this, `restored` would be a fresh object every render and any effect
  // that depends on it (e.g. a defs-load effect that merges the draft) would
  // loop and wipe the user's input. parseEnvelope is pure (operates on the
  // already-read snapshot string), so memoising it in render is lint-clean.
  const restored = useMemo<T | null>(
    () => parseEnvelope<T>(rawSnapshot, key),
    [rawSnapshot, key],
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((data: T) => {
    if (!canUseStorage()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const env: Envelope<T> = { savedAt: Date.now(), data };
        window.localStorage.setItem(key, JSON.stringify(env));
      } catch {
        // Quota exceeded or serialization error — ignore; never block typing.
      }
    }, DEBOUNCE);
  }, [key]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!canUseStorage()) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  const initial = (fallback: T): T => restored ?? fallback;

  return { restored, initial, save, clear, hasDraft: restored !== null };
}
