// =============================================================================
// POST /api/coa/a20 - Generate COA for Factory A-20 (product based).
//
// Actions (JSON body `action`):
//   products    -> products that have a COA template
//   preview     -> rows for a product + batch from the saved Product QC record
//   next_no     -> next Test Report No. due
//   list        -> COAs already issued
//   preview_pdf -> DRAFT PDF (no number consumed, nothing saved)
//   generate    -> claim number, save snapshot, render PDF, email
//   retry       -> re-send from the stored snapshot
//   download    -> PDF re-rendered from the stored snapshot
//
// Auth: signed in AND chemist / factory_admin / company_admin.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  a20ServiceClient, generateA20Coa, listA20Coas, listA20Products, peekA20NextReportNo,
  previewA20CoaPdf, resolveA20Preview, retryA20CoaSend, type GenerateA20Input,
} from "@/lib/coa/a20/generate";
import { renderA20CoaPdf } from "@/lib/coa/a20/render-pdf";
import type { A20CoaSnapshot } from "@/lib/coa/a20/build";

const ALLOWED_ROLES = ["chemist", "factory_admin", "company_admin"];

async function getUserAndRoles() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, roles: [] as string[] };
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  return { user, roles: (roleRows ?? []).map((r) => r.role as string) };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: NextRequest) {
  const { user, roles } = await getUserAndRoles();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!roles.some((r) => ALLOWED_ROLES.includes(r))) {
    return NextResponse.json({ error: "Forbidden - COA generation is for the Lab (chemist) role." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = str(body.action);
  const factoryId = str(body.factoryId);

  try {
    if (action === "products") {
      return NextResponse.json({ ok: true, products: await listA20Products() });
    }

    if (action === "preview") {
      const productCode = str(body.productCode);
      const batchNumber = str(body.batchNumber).trim();
      if (!factoryId || !productCode || !batchNumber) {
        return NextResponse.json({ error: "factoryId, productCode, batchNumber required" }, { status: 400 });
      }
      return NextResponse.json(await resolveA20Preview(factoryId, productCode, batchNumber));
    }

    if (action === "next_no") {
      return NextResponse.json({ ok: true, nextNo: await peekA20NextReportNo() });
    }

    if (action === "list") {
      if (!factoryId) return NextResponse.json({ error: "factoryId required" }, { status: 400 });
      return NextResponse.json({ ok: true, rows: await listA20Coas(factoryId) });
    }

    if (action === "generate" || action === "preview_pdf") {
      const typedNo = body.testReportNo === undefined || body.testReportNo === null || body.testReportNo === ""
        ? undefined : Number(body.testReportNo);
      if (typedNo !== undefined && (!Number.isInteger(typedNo) || typedNo <= 0)) {
        return NextResponse.json({ ok: false, code: "bad_input", message: "Test Report No. must be a positive whole number." }, { status: 400 });
      }
      const values: Record<string, string> = {};
      if (body.values && typeof body.values === "object") {
        for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) values[k] = str(v);
      }
      const input: GenerateA20Input = {
        factoryId,
        productCode: str(body.productCode),
        batchNumber: str(body.batchNumber),
        coaTitle: str(body.coaTitle),
        coaDate: str(body.coaDate),
        mfgDate: str(body.mfgDate),
        qty: str(body.qty),
        invoiceNo: str(body.invoiceNo),
        invoiceDate: str(body.invoiceDate),
        lorryNo: str(body.lorryNo),
        values,
        testReportNo: typedNo,
        createdBy: user.id,
        checkedBy: str(body.checkedBy),
      };

      if (action === "preview_pdf") {
        const r = await previewA20CoaPdf(input);
        if (!r.ok) return NextResponse.json({ ok: false, message: r.message, problems: r.problems }, { status: 409 });
        return NextResponse.json({ ok: true, pdfBase64: r.pdf.toString("base64") });
      }
      const result = await generateA20Coa(input);
      return NextResponse.json(result, { status: result.ok ? 200 : result.code === "error" ? 500 : 409 });
    }

    if (action === "retry") {
      const coaId = str(body.coaId);
      if (!coaId || !factoryId) return NextResponse.json({ error: "coaId, factoryId required" }, { status: 400 });
      const result = await retryA20CoaSend(coaId, factoryId);
      return NextResponse.json(result, { status: result.ok ? 200 : 500 });
    }

    if (action === "download") {
      const coaId = str(body.coaId);
      if (!coaId || !factoryId) return NextResponse.json({ error: "coaId, factoryId required" }, { status: 400 });
      const { data: row } = await a20ServiceClient()
        .from("coa_documents").select("test_report_no, product_name, batch_no, snapshot")
        .eq("id", coaId).eq("factory_id", factoryId).maybeSingle();
      if (!row?.snapshot) return NextResponse.json({ error: "COA not found" }, { status: 404 });
      const pdf = await renderA20CoaPdf(row.snapshot as A20CoaSnapshot);
      const filename = `COA-${row.test_report_no}-${String(row.product_name).replace(/[^\w-]+/g, "_")}.pdf`;
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
