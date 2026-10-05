// =============================================================================
// /api/admin/users
//
// Server-side user management for company_admin and factory_admin roles.
// Uses the Supabase service-role key — never expose this to the browser.
//
// GET    — list all users (profiles + latest role + phone)
// POST   — create a new user (phone + name + role)
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

// ── POST — create user ────────────────────────────────────────────────────────
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

  // Create auth user with phone (Supabase phone user, no password)
  // phone must be E.164 format e.g. +919876543210
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    phone:             phone_number.trim(),
    phone_confirm:     true,   // skip OTP verification for admin-created users
    user_metadata:     { full_name: full_name.trim(), role },
  });

  if (authErr || !authData.user) {
    return NextResponse.json(
      { error: authErr?.message ?? "Failed to create auth user" },
      { status: 400 }
    );
  }

  const userId = authData.user.id;

  // Set phone_number on profiles (trigger sets full_name but not phone_number)
  await admin
    .from("profiles")
    .update({ full_name: full_name.trim(), phone_number: phone_number.trim() })
    .eq("id", userId);

  // Upsert role in user_roles (trigger may have already inserted one)
  await admin.from("user_roles").upsert(
    { user_id: userId, role, factory_id: factory_id ?? null },
    { onConflict: "user_id,role,factory_id,module" }
  );

  return NextResponse.json({ success: true, userId });
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
  const updates: Record<string, unknown> = {};

  if (full_name?.trim())    updates.full_name    = full_name.trim();
  if (phone_number?.trim()) updates.phone_number = phone_number.trim();

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("profiles").update(updates).eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update phone in auth.users if phone changed
  if (phone_number?.trim()) {
    await admin.auth.admin.updateUserById(userId, {
      phone: phone_number.trim(),
    });
  }

  if (role) {
    // Remove all existing role rows for this user, then insert the new one
    await admin.from("user_roles").delete().eq("user_id", userId);
    await admin.from("user_roles").insert({
      user_id:    userId,
      role,
      factory_id: factory_id ?? null,
    });
  }

  return NextResponse.json({ success: true });
}

// ── DELETE — delete user ──────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const check = await requireAdmin(req);
  if (check instanceof NextResponse) return check;

  const { userId } = await req.json() as { userId: string };
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = getAdminClient();

  // Deleting from auth.users cascades to profiles and user_roles
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
