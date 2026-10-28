// =============================================================================
// scripts/seed_a20_users.mjs
//
// Creates the A-20 (DBV_20) user accounts in Supabase, mirroring the logic of
// the /api/admin/users POST route:
//   1. auth.admin.createUser({ phone, phone_confirm, user_metadata })
//   2. profiles.update({ full_name, phone_number })
//   3. user_roles.upsert({ user_id, role })
//
// Reads credentials from .env.a20 (public) with an optional .env.a20.local
// override for the service-role key (keeps the secret out of git).
//
// Usage:
//   node scripts/seed_a20_users.mjs          # create users
//   node scripts/seed_a20_users.mjs --dry    # print what would happen, no writes
//
// This script targets the A-20 project ONLY (rpnlybjxdbyjprycjyye).
// It refuses to run against any other Supabase URL as a safety guard.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DRY = process.argv.includes("--dry");

// Expected A-20 project ref — guard so we never touch A-20/1 by accident.
const EXPECTED_PROJECT_REF = "rpnlybjxdbyjprycjyye";

// ── minimal .env parser ───────────────────────────────────────────────────────
function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

// .env.a20.local overrides .env.a20 (so the secret can live in the gitignored file)
const env = {
  ...loadEnv(join(ROOT, ".env.a20")),
  ...loadEnv(join(ROOT, ".env.a20.local")),
};

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Fill them in .env.a20 / .env.a20.local first.");
  process.exit(1);
}
if (SERVICE_KEY.includes("REPLACE_WITH")) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is still a placeholder. Put the real A-20 key in .env.a20.local.");
  process.exit(1);
}
if (!URL.includes(EXPECTED_PROJECT_REF)) {
  console.error(`Refusing to run: URL (${URL}) is not the A-20 project (${EXPECTED_PROJECT_REF}).`);
  process.exit(1);
}

// ── Users to create ───────────────────────────────────────────────────────────
// Phones normalized to E.164 (+91 India). role must be a valid AppRole.
const USERS = [
  // ── Factory / operators (image 1) ──
  { full_name: "Anil S Pawar",     phone: "+918149209689", role: "factory_admin" }, // MANAGER
  { full_name: "Sunil Pawar",      phone: "+919004000776", role: "stores" },        // STORES EXECUTIVE
  { full_name: "Nivas Patil",      phone: "+919623453188", role: "stores" },        // STORE OFFICER
  { full_name: "Jay Yadav",        phone: "+917666953507", role: "operator" },      // SLURRY OPERATOR
  { full_name: "Haridas Patekar",  phone: "+919673983877", role: "operator" },      // PACKING OPERATOR
  { full_name: "Raj Narayan",      phone: "+919004502002", role: "operator" },      // SLURRY OPERATOR

  // ── Chemist / lab (image 2) ──
  { full_name: "Narendra Mahajan", phone: "+917506685655", role: "chemist" },       // QA Head -> chemist (per request)
  { full_name: "Ganesh Rathod",    phone: "+918369629433", role: "chemist" },       // Chemist
  { full_name: "Sachin Kochre",    phone: "+918308769077", role: "chemist" },       // Chemist
  { full_name: "Sagar Pawse",      phone: "+919653106564", role: "chemist" },       // Chemist
];

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

// Find an existing auth user by phone. Supabase stores phone without the
// leading '+', so compare against both forms. Pages through the user list.
async function findUserByPhone(phone) {
  const bare = phone.replace(/^\+/, "");
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find(
      (x) => x.phone === phone || x.phone === bare
    );
    if (hit) return hit;
    if (data.users.length < 100) return null; // last page
  }
  return null;
}

async function run() {
  console.log(`Target: ${URL}`);
  console.log(`Mode:   ${DRY ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Users:  ${USERS.length}\n`);

  let ok = 0, skipped = 0, failed = 0;

  for (const u of USERS) {
    const label = `${u.full_name} (${u.phone}) [${u.role}]`;

    if (DRY) {
      console.log(`DRY  would create: ${label}`);
      continue;
    }

    // 1. Create auth user (or find the existing one from a prior partial run)
    let userId = null;
    let reused = false;

    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      phone: u.phone,
      phone_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    });

    if (authErr || !authData?.user) {
      const msg = authErr?.message ?? "unknown";
      if (/already.*registered|already exists|phone.*exists/i.test(msg)) {
        // A prior run created the auth user but may have failed before the
        // profile/role were written. Find them and backfill below.
        const existing = await findUserByPhone(u.phone);
        if (!existing) {
          console.error(`FAIL ${label} — phone registered but user not found`);
          failed++;
          continue;
        }
        userId = existing.id;
        reused = true;
        // Ensure metadata (full_name + role) is set on the existing user.
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { full_name: u.full_name, role: u.role },
        });
      } else {
        console.error(`FAIL ${label} — ${msg}`);
        failed++;
        continue;
      }
    } else {
      userId = authData.user.id;
    }

    // 2. Set profile fields. NOTE: the A-20 profiles table uses column `phone`
    //    (the A-20/1 schema uses `phone_number`). The trigger seeds full_name
    //    but not phone.
    const { error: profErr } = await admin
      .from("profiles")
      .update({ full_name: u.full_name, phone: u.phone })
      .eq("id", userId);
    if (profErr) console.warn(`  warn profile update: ${profErr.message}`);

    // 3. Upsert role
    const { error: roleErr } = await admin.from("user_roles").upsert(
      { user_id: userId, role: u.role, factory_id: null },
      { onConflict: "user_id,role,factory_id,module" }
    );
    if (roleErr) {
      console.error(`FAIL ${label} — role upsert: ${roleErr.message}`);
      failed++;
      continue;
    }

    console.log(`${reused ? "FIX " : "OK  "} ${label} — ${userId}`);
    ok++;
  }

  console.log(`\nDone. created=${ok} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
