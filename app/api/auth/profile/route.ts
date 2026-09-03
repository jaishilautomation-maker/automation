// GET /api/auth/profile
//
// Returns the profiles row + role for the currently authenticated user.
// Uses the service-role client to bypass RLS — safe because we verify
// the session first and only return data for the authenticated user's own id.
//
// This avoids the RLS timing issue where auth.uid() is null on the first
// client-side query immediately after verifyOtp fires onAuthStateChange.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  // 1. Verify the caller has a valid session
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Fetch profile + role via service role (bypasses RLS)
  const admin = getServiceClient();
  const userPhone = user.phone ?? null;

  const [{ data: profileData }, { data: roleData }] = await Promise.all([
    userPhone
      ? admin
          .from("profiles")
          .select("id, full_name, phone_number")
          .or(`phone_number.eq.${userPhone},id.eq.${user.id}`)
          .limit(1)
          .maybeSingle()
      : admin
          .from("profiles")
          .select("id, full_name, phone_number")
          .eq("id", user.id)
          .maybeSingle(),
    admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profileData) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id:           profileData.id,
    full_name:    profileData.full_name,
    phone_number: profileData.phone_number ?? userPhone,
    role:         roleData?.role ?? null,
  });
}
