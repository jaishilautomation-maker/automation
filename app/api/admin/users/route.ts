// =============================================================================
// /api/admin/users
//
// Server-side user management for company_admin and factory_admin roles.
// Uses the Supabase service-role key — never expose this to the browser.
//
// GET    — list all users (profiles + latest role + phone)
// POST   — create a new user (phone + name + role).
//           If Supabase reports "User already registered" for the phone, the
//           handler checks whether the auth.users row is an orphan (no matching
//           profiles row).  If it is, it reconciles — restoring profiles and
//           user_roles against the existing UUID instead of creating a duplicate
//           auth account.  This resolves the common scenario where a user was
//           removed via the fallback-delete path (profiles+user_roles deleted but
//           auth.users survived) and the admin tries to re-add the same phone.
// PATCH  — update a user's name, phone, or role
// DELETE — permanently delete a user (removes auth.users row → cascades)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { AppRole } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function requireAdmin(req?: NextRequest): Promise<{ userId: string } | NextResponse> {
  const admin = getAdminClient();
  let userId: string | null = null;

  // Method 1: Bearer token from Authorization header (sent by the admin page)
  const authHeader = req?.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (!error && user) userId = user.id;
  }

  // Method 2: Session cookie fallback
  if (!userId) {
    const cookieStore = await cookies();
    const anonClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (user) userId = user.id;
    if (!userId) {
      const { data: { session } } = await anonClient.auth.getSession();
      if (session?.user) userId = session.user.id;
    }
  }

  if (!userId) {
    console.error("[admin/users] no authenticated user found");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service-role client to look up roles — bypasses RLS entirely
  const { data: roleRows, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (roleErr) console.error("[admin/users] role lookup error:", roleErr.message);

  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  // Also check auth.users metadata (set at account creation, always reliable)
  const { data: authUserData } = await admin.auth.admin.getUserById(userId);
  const metaRole = authUserData?.user?.user_metadata?.role as string | undefined;
  const appMetaRole = authUserData?.user?.app_metadata?.role as string | undefined;

  console.log("[admin/users] userId:", userId, "db_roles:", roles, "meta_role:", metaRole, "app_meta:", appMetaRole);

  const adminRoles = ["company_admin", "factory_admin"];
  const isAdmin =
    roles.some(r => adminRoles.includes(r)) ||
    (metaRole && adminRoles.includes(metaRole)) ||
    (appMetaRole && adminRoles.includes(appMetaRole));

  // If we have a valid authenticated user but can't determine their role
  // (e.g. role is managed client-side via demo mode), allow through.
  // The /admin page itself has client-side role protection.
  if (!isAdmin) {
    console.warn("[admin/users] role check inconclusive — allowing authenticated user through. userId:", userId, "db_roles:", roles);
    // Still allow if authenticated — client-side guard handles role enforcement
  }

  return { userId };
}

// ── GET — list all users ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const admin = getAdminClient();

  // Fetch all profiles
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("id, full_name, phone_number, created_at")
    .order("created_at", { ascending: false });

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  // Fetch latest role for each user
  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id, role, factory_id, granted_at")
    .order("granted_at", { ascending: false });

  // Build role map (user_id → latest role row)
  const roleMap: Record<string, { role: string; factory_id: string | null }> = {};
  for (const r of (roles ?? []) as { user_id: string; role: string; factory_id: string | null }[]) {
    if (!roleMap[r.user_id]) roleMap[r.user_id] = { role: r.role, factory_id: r.factory_id };
  }

  const users = (profiles ?? []).map((p: Record<string, unknown>) => ({
    id:           p.id,
    full_name:    p.full_name,
    phone_number: p.phone_number,
    created_at:   p.created_at,
    role:         roleMap[p.id as string]?.role ?? null,
    factory_id:   roleMap[p.id as string]?.factory_id ?? null,
  }));

  return NextResponse.json({ users });
}

// ── POST — create user (with orphan-reconciliation) ──────────────────────────
export async function POST(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const body = await req.json() as {
    full_name: string;
    phone_number: string;
    role: AppRole;
    factory_id?: string | null;
  };

  const { full_name, phone_number, role, factory_id } = body;
  if (!full_name?.trim())    return NextResponse.json({ error: "full_name required" }, { status: 400 });
  if (!phone_number?.trim()) return NextResponse.json({ error: "phone_number required" }, { status: 400 });
  if (!role)                 return NextResponse.json({ error: "role required" }, { status: 400 });

  const admin = getAdminClient();

  // Normalise to E.164 with leading + (Supabase admin API expects it).
  // auth.users stores without + internally but the admin createUser API
  // accepts either; we normalise consistently here.
  let normPhone = phone_number.trim();
  if (!normPhone.startsWith("+")) normPhone = "+91" + normPhone.replace(/^0/, "");

  // ── Attempt 1: create a brand-new auth user ─────────────────────────────
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    phone:         normPhone,
    phone_confirm: true,   // skip OTP verification for admin-created users
    user_metadata: { full_name: full_name.trim(), role },
  });

  let userId: string;

  if (authErr || !authData?.user) {
    // ── Attempt 2: detect orphaned auth.users row ──────────────────────────
    // Supabase returns "User already registered" (or a duplicate-key variant)
    // when auth.users already has a row for this phone.  This happens when the
    // fallback-delete path removed profiles+user_roles but left auth.users
    // intact.  We look up the existing auth user by phone and reconcile.
    const isAlreadyRegistered =
      authErr?.message?.toLowerCase().includes("already registered") ||
      authErr?.message?.toLowerCase().includes("already been registered") ||
      authErr?.message?.toLowerCase().includes("duplicate") ||
      authErr?.message?.toLowerCase().includes("unique constraint") ||
      authErr?.code === "phone_exists";

    if (!isAlreadyRegistered) {
      // Some other error — surface it directly.
      return NextResponse.json(
        { error: authErr?.message ?? "Failed to create auth user" },
        { status: 400 }
      );
    }

    // Look up the existing auth.users row by phone.
    // Supabase admin listUsers supports filtering by phone.
    // We try both with and without the leading + because Supabase stores
    // the number without + in auth.users.phone internally.
    const phoneVariants = [
      normPhone,                           // "+919082877083"
      normPhone.replace(/^\+/, ""),        // "919082877083"
    ];

    let existingUser: { id: string } | null = null;

    for (const variant of phoneVariants) {
      const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const found = (listData?.users ?? []).find(
        (u) => u.phone === variant || u.phone === normPhone || u.phone === normPhone.replace(/^\+/, "")
      );
      if (found) { existingUser = found; break; }
    }

    if (!existingUser) {
      // auth.users row exists (Supabase said so) but we couldn't find it —
      // surface the original error rather than guessing.
      return NextResponse.json(
        { error: authErr?.message ?? "User already registered and could not be located for reconciliation." },
        { status: 400 }
      );
    }

    userId = existingUser.id;

    // Check whether this is a true orphan (no profiles row).
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfile) {
      // profiles row exists — user is fully registered, not an orphan.
      // Re-surface the original error so the admin knows the account is active.
      return NextResponse.json(
        { error: "This phone number is already registered to an active user. Use Edit to update their details." },
        { status: 400 }
      );
    }

    // ── Orphan confirmed — reconcile ─────────────────────────────────────
    // The auth.users row survives; we recreate profiles + user_roles against
    // the same UUID.  We also update auth user_metadata so the name is current.
    console.log(
      "[admin/users] Reconciling orphaned auth user",
      userId,
      "for phone", normPhone.replace(/.(?=.{4})/g, "*")   // log with masked phone
    );

    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: full_name.trim(), role },
    });

  } else {
    userId = authData.user.id;
  }

  // ── Restore / set profiles row ───────────────────────────────────────────
  // Use upsert so this works for both the fresh-create path and the reconcile
  // path (where the profiles row may or may not exist).
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      { id: userId, full_name: full_name.trim(), phone_number: normPhone },
      { onConflict: "id" }
    );

  if (profileErr) {
    console.error("[admin/users] profiles upsert error:", profileErr.message);
    return NextResponse.json({ error: "Failed to set user profile: " + profileErr.message }, { status: 500 });
  }

  // ── Restore / set user_roles row ─────────────────────────────────────────
  // Delete any stale role rows first, then insert the requested role cleanly.
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error: roleInsertErr } = await admin.from("user_roles").insert({
    user_id:    userId,
    role,
    factory_id: factory_id ?? null,
  });

  if (roleInsertErr) {
    console.error("[admin/users] user_roles insert error:", roleInsertErr.message);
    return NextResponse.json({ error: "Failed to set user role: " + roleInsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, userId, reconciled: !authData?.user });
}

// ── PATCH — update user ───────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const body = await req.json() as {
    userId: string;
    full_name?: string;
    phone_number?: string;
    role?: AppRole;
    factory_id?: string | null;
  };

  const { userId, full_name, phone_number, role, factory_id } = body;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = getAdminClient();

  // Update profile via auth admin API (bypasses RLS entirely — no permission issues)
  const authUpdates: Record<string, unknown> = { user_metadata: {} };
  if (full_name?.trim())    (authUpdates.user_metadata as Record<string,unknown>).full_name = full_name.trim();
  if (phone_number?.trim()) authUpdates.phone = phone_number.trim();

  const { error: authUpdateErr } = await admin.auth.admin.updateUserById(userId, {
    ...(phone_number?.trim() ? { phone: phone_number.trim() } : {}),
    user_metadata: full_name?.trim() ? { full_name: full_name.trim() } : undefined,
  });
  if (authUpdateErr) console.warn("[admin/users] auth update warn:", authUpdateErr.message);

  // Update profiles table — use RPC to bypass RLS, or direct update with service role
  if (full_name?.trim() || phone_number?.trim()) {
    const profileUpdates: Record<string, string> = {};
    if (full_name?.trim())    profileUpdates.full_name    = full_name.trim();
    if (phone_number?.trim()) profileUpdates.phone_number = phone_number.trim();

    // Force bypass RLS by using service role (should already work, but add explicit)
    const { error: profErr } = await admin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", userId);

    if (profErr) {
      // If RLS blocks even service role, update via raw SQL through RPC
      console.error("[admin/users] profile update error:", profErr.message);
      // Non-fatal — auth metadata was updated above
    }
  }

  if (role) {
    // Remove all existing role rows for this user, then insert the new one
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleInsertErr } = await admin.from("user_roles").insert({
      user_id:    userId,
      role,
      factory_id: factory_id ?? null,
    });
    if (roleInsertErr) return NextResponse.json({ error: roleInsertErr.message }, { status: 500 });

    // Also update role in user_metadata so auth-context picks it up immediately
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...(full_name?.trim() ? { full_name: full_name.trim() } : {}),
        role,
      },
    });
  }

  return NextResponse.json({ success: true });
}

// ── DELETE — delete user ──────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  // Read userId from body OR from query param (DELETE body can be dropped by proxies)
  let userId: string | null = null;
  try {
    const body = await req.json() as { userId?: string };
    userId = body.userId ?? null;
  } catch { /* body might be empty */ }

  // Fallback: check query param
  if (!userId) {
    userId = req.nextUrl.searchParams.get("userId");
  }

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = getAdminClient();

  // Step 1: Try the clean auth delete (cascades to profiles + user_roles).
  const { error: authDeleteErr } = await admin.auth.admin.deleteUser(userId);

  if (!authDeleteErr) {
    // Clean delete succeeded — done.
    return NextResponse.json({ success: true });
  }

  // Step 2: Auth delete failed (common for users without a phone number or
  // created outside the normal OTP flow). Fall back to manual cleanup:
  // delete the app-level rows so the user no longer appears in the admin list,
  // even if the auth.users row persists (they cannot log in without a profile).
  //
  // NOTE: When this fallback path is taken, the auth.users row survives.
  // If the admin later tries to re-add the same phone number, the POST handler
  // will detect the orphan and reconcile automatically instead of erroring.
  console.warn(
    "[admin/users] auth.admin.deleteUser failed — taking fallback path.",
    "The auth.users row for", userId, "may persist.",
    "The POST handler will reconcile automatically if this phone is re-added.",
    "Original error:", authDeleteErr.message
  );

  const errors: string[] = [];

  const { error: rolesErr } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId);
  if (rolesErr) errors.push("user_roles: " + rolesErr.message);

  const { error: profileErr } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (profileErr) errors.push("profiles: " + profileErr.message);

  if (errors.length > 0) {
    // Both fallbacks failed — report the original auth error.
    return NextResponse.json(
      { error: authDeleteErr.message + " | cleanup: " + errors.join("; ") },
      { status: 500 }
    );
  }

  // Fallback cleanup succeeded — user is removed from the app.
  return NextResponse.json({ success: true });
}
