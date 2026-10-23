"use client";

// =============================================================================
// useIdleLogout — full sign-out after a fixed period of inactivity.
//
// After IDLE_LIMIT_MS of no user interaction, the Supabase session is signed
// out and the user is sent to /login (a fresh login is then required). Any
// interaction (pointer / key / touch / scroll) resets the timer.
//
// Robustness details:
//   • "Last activity" is persisted to localStorage, so the timer survives page
//     navigations and even a tab being backgrounded/reopened. On visibility
//     regain or focus we re-check elapsed time immediately — this is what
//     catches the "came back after 2 hours" case: the stored timestamp is old,
//     so we log out right away instead of waiting for a fresh in-page timer.
//   • A single setTimeout is (re)armed to the remaining time; activity debounces
//     the localStorage write to avoid thrashing.
//
// Mounted once, from AuthGate, inside the authenticated app shell.
// =============================================================================

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";

/** Idle limit: 1 hour 30 minutes. */
export const IDLE_LIMIT_MS = 90 * 60 * 1000;

const LAST_ACTIVITY_KEY = "jsci_last_activity";
/** Don't write to localStorage more than once per this interval. */
const WRITE_THROTTLE_MS = 10_000;

function now() {
  return Date.now();
}

function readLastActivity(): number {
  try {
    const v = localStorage.getItem(LAST_ACTIVITY_KEY);
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : now();
  } catch {
    return now();
  }
}

function writeLastActivity(ts: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
  } catch {
    /* ignore storage failures (private mode, etc.) */
  }
}

export function useIdleLogout() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrite = useRef(0);

  const doLogout = useCallback(async () => {
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch { /* ignore */ }
    await signOut();
    router.replace("/login?reason=idle");
  }, [signOut, router]);

  // (Re)arm the timeout to fire at lastActivity + IDLE_LIMIT_MS.
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const elapsed = now() - readLastActivity();
    const remaining = IDLE_LIMIT_MS - elapsed;
    if (remaining <= 0) {
      void doLogout();
      return;
    }
    timer.current = setTimeout(() => { void doLogout(); }, remaining);
  }, [doLogout]);

  // Record activity (throttled) and re-arm the timer.
  const onActivity = useCallback(() => {
    const t = now();
    if (t - lastWrite.current >= WRITE_THROTTLE_MS) {
      lastWrite.current = t;
      writeLastActivity(t);
      arm();
    }
  }, [arm]);

  useEffect(() => {
    // Only run while signed in. When there is no user, clear any pending timer.
    if (!user) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }

    // Seed activity on mount and arm the timer.
    writeLastActivity(now());
    lastWrite.current = now();
    arm();

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown", "keydown", "touchstart", "scroll", "mousemove", "click",
    ];
    for (const ev of activityEvents) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    // On returning to the tab (focus / visibility), re-check elapsed time right
    // away — this is what logs out a session that was idle in the background.
    const onReturn = () => {
      if (document.visibilityState === "visible") arm();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      for (const ev of activityEvents) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [user, arm, onActivity]);
}
