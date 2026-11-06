import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  computeReview, saveReview, ReviewError, LAB_ROLES, type ReviewRequest,
} from "@/lib/job-card/phase-b-review";
import { sendLimitExceededEmail } from "@/lib/notifications/limit-exceeded-email";

// =============================================================================
// POST /api/job-card/phase-b
//
//   { action: "preview", ...ReviewRequest }   chemist: compute, write nothing
//   { action: "save",    ...ReviewRequest }   chemist: compute + persist + email
//   { action: "remark", jobCardId, remark }   operator: limit-exceeded remark
//
// Every DB call uses the caller's session (RLS + audit attribution). The
// service role is used only to read the recipients table and to send mail.
// =============================================================================

async function userClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await userClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as ReviewRequest & { action?: string; remark?: string };
    if (!body.jobCardId) return NextResponse.json({ error: "jobCardId required" }, { status: 400 });

    // ---------------- operator: limit-exceeded remark ----------------------
    if (body.action === "remark") {
      const remark = (body.remark ?? "").trim();
      if (!remark) return NextResponse.json({ error: "A remark is required." }, { status: 400 });

      const { error } = await supabase.from("production_job_cards")
        .update({ limit_remark: remark }).eq("id", body.jobCardId);
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });

      const { data: card } = await supabase.from("production_job_cards")
        .select("id, factory_id, lot_no, limit_exceeded_case, limit_remark, phase_b_calc, product_id")
        .eq("id", body.jobCardId).single();
      if (card) {
        const { data: p } = await supabase.from("products").select("name").eq("id", card.product_id).maybeSingle();
        await sendLimitExceededEmail(p?.name ?? "Product", card as never, "remark");
      }
      return NextResponse.json({ ok: true });
    }

    // ---------------- chemist: preview / save -------------------------------
    if (body.action !== "preview" && body.action !== "save") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    if (!(roles ?? []).some(r => LAB_ROLES.includes(String(r.role)))) {
      return NextResponse.json({ error: "Only the chemist can review Phase A." }, { status: 403 });
    }

    const review = await computeReview(supabase, body);

    if (body.action === "preview") {
      return NextResponse.json({
        productName: review.productName, productCode: review.productCode,
        config: review.config, lot: review.card.lot_no, status: review.card.status,
        qc: review.qc, formulaPhase: review.formulaPhase,
        snapshot: review.snapshot, canSave: review.canSave, blockers: review.blockers,
      });
    }

    const saved = await saveReview(supabase, review, user.id);

    let email: { configured: boolean; recipients: number } | null = null;
    if (saved.newlyFlagged) {
      email = await sendLimitExceededEmail(review.productName, {
        id: review.card.id, factory_id: review.card.factory_id, lot_no: review.card.lot_no,
        limit_exceeded_case: saved.snapshot.limit?.case ?? null,
        limit_remark: null, phase_b_calc: saved.snapshot,
      }, "flagged");
    }

    return NextResponse.json({
      ok: true, status: saved.status, snapshot: saved.snapshot, email,
    });
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
