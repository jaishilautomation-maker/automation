// =============================================================================
// POST /api/coa/generate
//
// Chemist-only (A-20/1) COA generation + preview + retry-send + PDF download.
// Discriminated by `action` in the JSON body:
//
//   action: "preview"  → resolve rows for the live preview table. Does NOT
//                        consume a report number or write anything.
//   action: "generate" → full pipeline: claim number, save snapshot, render
//                        PDF, email (To+Cc), log. Returns the new COA id + no.
//   action: "retry"    → re-send an existing COA from its snapshot (no new no.)
//   action: "download" → return the PDF bytes (base64) re-rendered from the
//                        stored snapshot (one-time download button).
//
// Auth: must be signed in AND hold the `chemist` (or admin) role. RLS on
// coa_documents is the backstop, but we gate here too for a clean 403.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateCoa, retryCoaSend, type GenerateCoaInput } from "@/lib/coa/generate-coa";
import { resolveCoaPreview } from "@/lib/coa/preview";
import { renderCoaPdf, type CoaSnapshot } from "@/lib/coa/render-coa-pdf";
import { createClient } from "@supabase/supabase-js";

const CHEMIST_ROLES = ["chemist", "factory_admin", "company_admin"];

async function getUserAndRole() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, roles: [] as string[], supabase };

  // Resolve the user's roles (user_roles) via the user-scoped client (RLS lets
  // a user read their own roles).
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r) => r.role as string);
  return { user, roles, supabase };
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const { user, roles } = await getUserAndRole();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!roles.some((r) => CHEMIST_ROLES.includes(r))) {
    return NextResponse.json({ error: "Forbidden — COA generation is for the Lab (chemist) role." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  if (action === "preview") {
    const factoryId = String(body.factoryId ?? "");
    const partyCode = String(body.partyCode ?? "");
    const batchNumbers = Array.isArray(body.batchNumbers) ? (body.batchNumbers as string[]).map(String) : [];
    if (!factoryId || !partyCode || batchNumbers.length === 0) {
      return NextResponse.json({ error: "factoryId, partyCode, batchNumbers required" }, { status: 400 });
    }
    try {
      const result = await resolveCoaPreview(factoryId, partyCode, batchNumbers);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
    }
  }

  // ── GENERATE ───────────────────────────────────────────────────────────────
  if (action === "generate") {
    const input: GenerateCoaInput = {
      factoryId:    String(body.factoryId ?? ""),
      partyCode:    String(body.partyCode ?? ""),
      shipTo:       String(body.shipTo ?? ""),
      docLabel:     (body.docLabel === "Challan No." ? "Challan No." : "Invoice No."),
      docValue:     String(body.docValue ?? ""),
      vehicleNo:    String(body.vehicleNo ?? ""),
      quantityMt:   Number(body.quantityMt ?? NaN),
      batchNumbers: Array.isArray(body.batchNumbers) ? (body.batchNumbers as string[]).map(String) : [],
      createdBy:    user.id,
      checkedBy:    String(body.checkedBy ?? ""),
    };
    const result = await generateCoa(input);
    const status = result.ok ? 200 : (result.code === "error" ? 500 : 409);
    return NextResponse.json(result, { status });
  }

  // ── RETRY SEND ──────────────────────────────────────────────────────────
  if (action === "retry") {
    const coaId = String(body.coaId ?? "");
    const factoryId = String(body.factoryId ?? "");
    if (!coaId || !factoryId) return NextResponse.json({ error: "coaId, factoryId required" }, { status: 400 });
    const result = await retryCoaSend(coaId, factoryId);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  // ── DOWNLOAD (regenerate PDF from the stored snapshot) ────────────────────
  if (action === "download") {
    const coaId = String(body.coaId ?? "");
    const factoryId = String(body.factoryId ?? "");
    if (!coaId || !factoryId) return NextResponse.json({ error: "coaId, factoryId required" }, { status: 400 });
    const db = serviceClient();
    const { data: row } = await db
      .from("coa_documents")
      .select("test_report_no, customer_name, snapshot, factory_id")
      .eq("id", coaId)
      .eq("factory_id", factoryId)
      .maybeSingle();
    if (!row || !row.snapshot) return NextResponse.json({ error: "COA not found" }, { status: 404 });
    try {
      const pdf = await renderCoaPdf(row.snapshot as CoaSnapshot);
      const filename = `COA-${row.test_report_no}-${String(row.customer_name).replace(/[^\w-]+/g, "_")}.pdf`;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
