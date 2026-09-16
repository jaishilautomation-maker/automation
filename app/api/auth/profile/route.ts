// GET /api/auth/profile
//
// Returns the profiles row + role for the currently authenticated user.
// Auth check: anon client with session cookie (getUser).
// Data fetch: service-role client (bypasses RLS — safe, scoped to auth user id).

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log("[profile-api] service key present:", !!key, "starts with eyJ:", key?.startsWith("eyJ"));
  return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET() {
  // 1. Verify session with anon client (reads cookie)
  const cookieStore = await cookies();
  const anonClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user }, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[profile-api] user.id:", user.id, "user.phone:", user.phone);

  // 2. Fetch profile + role with service-role client (no RLS)
  const admin = getServiceClient();

  const [{ data: profileData, error: profileErr }, { data: roleData, error: roleErr }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, phone_number")
        .eq("id", user.id)
        .single(),
      admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  console.log("[profile-api] profileData:", JSON.stringify(profileData), "err:", profileErr?.message);
  console.log("[profile-api] roleData:", JSON.stringify(roleData), "err:", roleErr?.message);

  if (!profileData) {
    console.log("[profile-api] No profile for id:", user.id);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id:           profileData.id,
    full_name:    profileData.full_name,
    phone_number: profileData.phone_number ?? user.phone ?? null,
    role:         roleData?.role ?? null,
  });
}
