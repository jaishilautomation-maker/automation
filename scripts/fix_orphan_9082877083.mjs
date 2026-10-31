// =============================================================================
// scripts/fix_orphan_9082877083.mjs
//
// One-time repair: restores the missing profiles + user_roles rows for
// phone number 9082877083 on the A-20/1 Supabase project.
//
// Background:
//   When the user was deleted via the admin panel, the fallback-delete path
//   removed profiles + user_roles but left the auth.users row intact (orphan).
//   This causes:
//     - Login → OTP delivers → "Account not found" (no profiles row)
//     - Admin re-add → "User already registered" (auth.users row survives)
//
// What this script does:
//   1. Finds the existing auth.users row for +919082877083
//   2. Upserts the profiles row (full_name + phone_number)
//   3. Inserts a user_roles row with the role you choose below
//   4. Updates auth user_metadata with the current name + role
//
// Usage:
//   node scripts/fix_orphan_9082877083.mjs          # apply fix (live)
//   node scripts/fix_orphan_9082877083.mjs --dry    # preview only, no writes
//
// Credentials are read from .env.a20_1 (already in the repo, not committed).
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DRY  = process.argv.includes("--dry");

// ── .env parser ───────────────────────────────────────────────────────────────
function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = {
  ...loadEnv(join(ROOT, ".env.a20_1")),
  ...loadEnv(join(ROOT, ".env.a20_1.local")), // optional secret override
};

const SUPABASE_URL     = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.a20_1");
  process.exit(1);
}

// Safety guard — refuse to run against any project that isn't A-20/1
const A20_1_REF = "dezwaxrtxpszxsmrxpkm";
if (!SUPABASE_URL.includes(A20_1_REF)) {
  console.error(`ABORT: URL "${SUPABASE_URL}" is not the A-20/1 project (${A20_1_REF}).`);
  process.exit(1);
}

// ── User details to restore ───────────────────────────────────────────────────
// Adjust FULL_NAME and ROLE to whatever the admin wants for this account.
// Valid roles: operator | stores | chemist | lab_manager | production_incharge
//              factory_admin | company_admin | viewer
const PHONE     = "+919082877083";  // E.164
const FULL_NAME = "Test User 2";    // will be updated by admin later if needed
const ROLE      = process.env.ROLE ?? "stores"; // pass ROLE=stores node script.mjs

// Known UUID from the dry-run scan — used as a fast-path lookup fallback
// so we don't need to page through all auth users if listUsers paginates oddly.
const KNOWN_UUID = "9fc259d9-ee72-4ff0-a551-039e5b85bac5";

// ── Supabase client (service role — bypasses RLS) ─────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Find auth.users row by phone ──────────────────────────────────────────────
// Supabase stores phone WITHOUT the leading '+' in auth.users.phone.
// We compare against both forms just in case. Stops at the first match.
async function findAuthUserByPhone(phone) {
  const bare = phone.replace(/^\+/, ""); // "919082877083"
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      console.error("  ERROR listing users page", page, ":", error.message);
      // If we already found the user in a prior call but the loop continued,
      // the error is on a subsequent page — not critical if we already have a hit.
      return null;
    }
    const users = data?.users ?? [];
    const hit = users.find((u) => u.phone === bare || u.phone === phone);
    if (hit) return hit;           // found — stop immediately
    if (users.length < 100) break; // last page — nothing more to scan
    page++;
  }
  return null;
}

async function run() {
  console.log("=".repeat(60));
  console.log("A-20/1 orphan repair: phone", PHONE.replace(/.(?=.{4})/g, "*"));
  console.log("Target :", SUPABASE_URL);
  console.log("Mode   :", DRY ? "DRY RUN — no writes" : "LIVE");
  console.log("=".repeat(60));

  // 1. Find the orphaned auth.users row — try direct UUID lookup first (fast),
  //    then fall back to phone scan if UUID doesn't match.
  console.log("\nStep 1: Looking up auth.users row for this phone...");
  let authUser = null;

  // Fast path: we already know the UUID from a prior dry-run
  if (KNOWN_UUID) {
    const { data: byId, error: idErr } = await admin.auth.admin.getUserById(KNOWN_UUID);
    if (!idErr && byId?.user) {
      const u = byId.user;
      const bare = PHONE.replace(/^\+/, "");
      if (u.phone === bare || u.phone === PHONE) {
        authUser = u;
        console.log("  FOUND via UUID fast-path: id =", u.id);
      } else {
        console.log("  UUID", KNOWN_UUID, "exists but phone differs:", u.phone, "— falling back to scan");
      }
    }
  }

  // Slow path: scan all auth users by phone
  if (!authUser) {
    authUser = await findAuthUserByPhone(PHONE);
  }

  if (!authUser) {
    console.error("\nNOT FOUND: No auth.users row exists for", PHONE);
    console.error("This means the user was fully deleted (auth row included).");
    console.error("The admin can add the number fresh — no orphan exists.");
    process.exit(0);
  }

  console.log("  FOUND: id =", authUser.id);
  console.log("  email:", authUser.email ?? "(none)");
  console.log("  phone:", authUser.phone);
  console.log("  created_at:", authUser.created_at);
  console.log("  confirmed_at:", authUser.phone_confirmed_at ?? "(not confirmed)");

  // 2. Check whether profiles row already exists
  console.log("\nStep 2: Checking profiles table...");
  const { data: existingProfile, error: profCheckErr } = await admin
    .from("profiles")
    .select("id, full_name, phone_number")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profCheckErr) {
    console.error("  ERROR querying profiles:", profCheckErr.message);
    process.exit(1);
  }

  if (existingProfile) {
    console.log("  profiles row ALREADY EXISTS:");
    console.log("    full_name   :", existingProfile.full_name);
    console.log("    phone_number:", existingProfile.phone_number);
    console.log("\nThe account is NOT an orphan — it has a profiles row.");
    console.log("If login still fails, check user_roles and RLS policies.");
  } else {
    console.log("  profiles row MISSING — orphan confirmed.");
  }

  // 3. Check user_roles
  console.log("\nStep 3: Checking user_roles...");
  const { data: existingRoles } = await admin
    .from("user_roles")
    .select("id, role, factory_id")
    .eq("user_id", authUser.id);

  if (existingRoles && existingRoles.length > 0) {
    console.log("  Existing roles:", JSON.stringify(existingRoles));
  } else {
    console.log("  No user_roles rows found.");
  }

  if (DRY) {
    console.log("\n[DRY RUN] Would perform the following writes:");
    if (!existingProfile) {
      console.log("  INSERT/UPSERT profiles SET full_name =", FULL_NAME, ", phone_number =", PHONE);
    }
    console.log("  DELETE user_roles WHERE user_id =", authUser.id);
    console.log("  INSERT user_roles (user_id, role) VALUES (", authUser.id, ",", ROLE, ")");
    console.log("  UPDATE auth.users SET user_metadata.full_name =", FULL_NAME, ", role =", ROLE);
    console.log("\nRe-run without --dry to apply.");
    return;
  }

  // 4. Upsert the profiles row (ON CONFLICT id DO UPDATE)
  console.log("\nStep 4: Upserting profiles row...");
  const { error: profileUpsertErr } = await admin
    .from("profiles")
    .upsert(
      {
        id:           authUser.id,
        full_name:    FULL_NAME,
        phone_number: PHONE,
      },
      { onConflict: "id" }
    );

  if (profileUpsertErr) {
    console.error("  ERROR upserting profile:", profileUpsertErr.message);
    process.exit(1);
  }
  console.log("  profiles row upserted OK.");

  // 5. Delete stale role rows then insert the new one
  console.log("\nStep 5: Restoring user_roles...");
  const { error: delRoleErr } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", authUser.id);

  if (delRoleErr) {
    console.error("  WARN: could not clear old roles:", delRoleErr.message);
    // non-fatal — proceed to insert
  } else {
    console.log("  Cleared old role rows (if any).");
  }

  const { error: insertRoleErr } = await admin
    .from("user_roles")
    .insert({ user_id: authUser.id, role: ROLE, factory_id: null });

  if (insertRoleErr) {
    console.error("  ERROR inserting role:", insertRoleErr.message);
    process.exit(1);
  }
  console.log("  user_roles row inserted:", ROLE);

  // 6. Sync auth user_metadata so auth-context picks up name+role immediately
  console.log("\nStep 6: Updating auth user metadata...");
  const { error: metaErr } = await admin.auth.admin.updateUserById(authUser.id, {
    phone_confirm: true,
    user_metadata: { full_name: FULL_NAME, role: ROLE },
  });

  if (metaErr) {
    console.error("  WARN: metadata update failed:", metaErr.message);
    // non-fatal — profile+role are the authoritative source
  } else {
    console.log("  Metadata updated OK.");
  }

  // 7. Verify the final state
  console.log("\nStep 7: Verifying final state...");
  const { data: finalProfile } = await admin
    .from("profiles")
    .select("id, full_name, phone_number")
    .eq("id", authUser.id)
    .single();

  const { data: finalRoles } = await admin
    .from("user_roles")
    .select("role, factory_id")
    .eq("user_id", authUser.id);

  console.log("  profiles :", JSON.stringify(finalProfile));
  console.log("  roles    :", JSON.stringify(finalRoles));

  console.log("\n" + "=".repeat(60));
  console.log("DONE. The phone number", PHONE, "is now restored.");
  console.log("The user can log in and will receive role:", ROLE);
  console.log("The admin can change the name/role at any time via the");
  console.log("Admin panel → Edit user.");
  console.log("=".repeat(60));
}

run().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
