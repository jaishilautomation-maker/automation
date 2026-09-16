// =============================================================================
// Factory configuration — read from environment variables at build time.
//
// Every Vercel deployment of this codebase represents exactly ONE factory.
// The factory is determined by environment variables, never by a user-facing
// dropdown. This prevents an A-20/1 user from switching the UI context to
// A-20 data (RLS also enforces this at the DB level, but defence-in-depth).
//
// Environment variables (set in Vercel project settings):
//
//   NEXT_PUBLIC_FACTORY_CODE    e.g. "A20_1"  | "A20"
//   NEXT_PUBLIC_FACTORY_NAME    e.g. "Dombivli A-20/1" | "Dombivli A-20"
//
// Both MUST have NEXT_PUBLIC_ prefix — they are embedded into the client
// bundle at build time (safe: factory name/code are not secrets).
//
// If the env vars are absent (local dev, CI, or old deployment without them),
// the defaults below keep the existing A-20/1 behaviour unchanged.
// =============================================================================

/** Internal factory code. Matches the `code` column in the `factories` table. */
export const FACTORY_CODE: string =
  process.env.NEXT_PUBLIC_FACTORY_CODE ?? "A20_1";

/** Human-readable factory name shown in the header and login screen. */
export const FACTORY_NAME: string =
  process.env.NEXT_PUBLIC_FACTORY_NAME ?? "Dombivli A-20/1";

/**
 * Returns true if this deployment is for the given factory code.
 * Use this to show/hide factory-specific UI (e.g. Breakdown Register
 * is only shown for A-20/1 in this phase).
 *
 * @example
 * if (isFactory("A20_1")) { // show breakdown register }
 */
export function isFactory(code: string): boolean {
  return FACTORY_CODE === code;
}

/**
 * The DB factory `code` used in Supabase queries.
 * Migration 006 established that A-20/1 = "DBV_20_1" and A-20 = "DBV_20_2"
 * in the existing DB. This maps the deployment code to the DB code.
 */
export const DB_FACTORY_CODE: string = ((): string => {
  const map: Record<string, string> = {
    A20_1: "DBV_20_1",
    A20:   "DBV_20_2",
  };
  return map[FACTORY_CODE] ?? FACTORY_CODE;
})();
