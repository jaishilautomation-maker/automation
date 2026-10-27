import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

// This page runs on the server. It cannot read sessionStorage.
// For local dev (no NEXT_PUBLIC_FACTORY_CODE), the process-select page
// passes the chosen process as a query param: /?process=A20_1 or /?process=A20
// We use that to continue. If no param and no env var, show the picker.

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ process?: string }>;
}) {
  const params = await searchParams;
  const processParam = params.process;

  // ── Local dev: no env var set ─────────────────────────────────────────────
  if (!process.env.NEXT_PUBLIC_FACTORY_CODE) {
    // If no process chosen yet, show the picker
    if (!processParam) {
      redirect("/process-select");
    }
    // Process chosen via query param — fall through to auth check below.
    // The factory-config.ts client-side code reads sessionStorage for the
    // actual factory context; the query param just lets us pass the server gate.
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Preserve the process param through login so it's available after redirect
    if (processParam) {
      redirect(`/login?process=${encodeURIComponent(processParam)}`);
    }
    redirect("/login");
  }

  redirect("/select-module");
}
