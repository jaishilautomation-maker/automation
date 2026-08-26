import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// =============================================================================
// API Route: Create a batch + insert hourly_readings / batch_analysis
// Uses service role to bypass RLS on hourly_readings which only allows
// operator/production_incharge — but lab chemists also need to insert.
// =============================================================================

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key);
}

async function getAuthUser(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action, payload } = body;

    const service = getServiceClient();

    // ---------------------------------------------------------------------------
    // Action: ensure_batch — find or create a SULPHUR_POWDER batch
    // ---------------------------------------------------------------------------
    if (action === "ensure_batch") {
      const { batch_number, factory_id } = payload;
      if (!batch_number || !factory_id) {
        return NextResponse.json({ error: "batch_number and factory_id required" }, { status: 400 });
      }

      // Check existing
      const { data: existing } = await service
        .from("batches")
        .select("id")
        .eq("factory_id", factory_id)
        .eq("batch_number", batch_number)
        .eq("batch_type", "fg")
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ batch_id: existing.id, created: false });
      }

      // Get material — A-20/1 uses SULPHUR_CRUDE, A-20 uses SULPHUR_POWDER
      // Try SULPHUR_CRUDE first (A-20/1 factory), fallback to SULPHUR_POWDER
      let mat = null;
      const { data: crudeMat } = await service
        .from("materials")
        .select("id")
        .eq("code", "SULPHUR_CRUDE")
        .maybeSingle();

      if (crudeMat) {
        mat = crudeMat;
      } else {
        const { data: powderMat } = await service
          .from("materials")
          .select("id")
          .eq("code", "SULPHUR_POWDER")
          .maybeSingle();
        mat = powderMat;
      }

      if (!mat) {
        return NextResponse.json({ error: "Sulphur material not found" }, { status: 500 });
      }

      const { data: newBatch, error: batchErr } = await service
        .from("batches")
        .insert({
          batch_number,
          factory_id,
          material_id: mat.id,
          product_id: null,
          batch_type: "fg",
          production_date: new Date().toISOString().slice(0, 10),
          quantity: null,
          unit: "kg",
          source_batch_id: null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (batchErr || !newBatch) {
        return NextResponse.json({ error: batchErr?.message ?? "Could not create batch" }, { status: 500 });
      }

      return NextResponse.json({ batch_id: newBatch.id, created: true });
    }

    // ---------------------------------------------------------------------------
    // Action: insert_hourly_reading
    // ---------------------------------------------------------------------------
    if (action === "insert_hourly_reading") {
      const { batch_id, factory_id, reading_time, test_results, remarks } = payload;
      if (!batch_id || !factory_id) {
        return NextResponse.json({ error: "batch_id and factory_id required" }, { status: 400 });
      }

      const { data: newRow, error } = await service
        .from("hourly_readings")
        .insert({
          batch_id,
          factory_id,
          recorded_by: user.id,
          reading_time,
          test_results: test_results ?? {},
          remarks: remarks || null,
        })
        .select("id")
        .single();

      if (error || !newRow) {
        return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
      }

      return NextResponse.json({ id: newRow.id });
    }

    // ---------------------------------------------------------------------------
    // Action: insert_batch_analysis
    // ---------------------------------------------------------------------------
    if (action === "insert_batch_analysis") {
      const { batch_id, factory_id, analysis_date, appearance, appearance_ok, test_results, remarks } = payload;
      if (!batch_id || !factory_id) {
        return NextResponse.json({ error: "batch_id and factory_id required" }, { status: 400 });
      }

      const { data: newRow, error } = await service
        .from("batch_analysis")
        .insert({
          batch_id,
          factory_id,
          chemist_id: user.id,
          analysis_date,
          appearance: appearance || null,
          appearance_ok: appearance_ok ?? null,
          test_results: test_results ?? {},
          remarks: remarks || null,
        })
        .select("id")
        .single();

      if (error || !newRow) {
        return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
      }

      return NextResponse.json({ id: newRow.id });
    }

    // ---------------------------------------------------------------------------
    // Action: update_batch_analysis
    // ---------------------------------------------------------------------------
    if (action === "update_batch_analysis") {
      const { id, analysis_date, appearance, appearance_ok, test_results, remarks } = payload;
      if (!id) {
        return NextResponse.json({ error: "id required" }, { status: 400 });
      }

      const { error } = await service
        .from("batch_analysis")
        .update({
          analysis_date,
          appearance: appearance || null,
          appearance_ok: appearance_ok ?? null,
          test_results: test_results ?? {},
          remarks: remarks || null,
          updated_by: user.id,
        })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
