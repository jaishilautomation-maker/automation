// =============================================================================
// Next.js 16 Proxy (Middleware) — route protection
//
// In Next.js 16, the middleware/proxy file must be named "proxy.ts" at the
// repo root with a DEFAULT export. The previous version exported a named
// function `proxy` which Next.js never invoked — this is the fix.
//
// What it does:
//   1. Creates a server Supabase client with cookie forwarding (required for
//      @supabase/ssr to refresh the session on every request).
//   2. Calls supabase.auth.getUser() to validate the session server-side.
//   3. Redirects unauthenticated requests to /login.
//   4. Redirects authenticated users away from /login back to /.
//
// The matcher excludes static assets so this does not run on _next/* files.
// =============================================================================

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export default async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // ---------------------------------------------------------------------------
  // Resolve Supabase credentials.
  // Supports both the new dual-DB env var names and the legacy single-DB names
  // so existing deployments without the new vars keep working unchanged.
  // ---------------------------------------------------------------------------
  const supabaseUrl =
    process.env.NEXT_PUBLIC_JOB_CARD_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_JOB_CARD_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!supabaseUrl || !supabaseKey) {
    // Env vars missing — let the request through; client-side auth will redirect
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Validate session (also refreshes the cookie if near expiry)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes — do not require authentication
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/index.html";

  // Unauthenticated → redirect to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated on login page → redirect to app root
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
