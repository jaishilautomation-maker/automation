// =============================================================================
// POST /api/qc-exchange/receive
//
// A-20 deployment only. Receives finalized QC records pushed by A-20/1.
//
// Security:
//   1. Verifies HMAC-SHA256 signature in X-QC-Exchange-Sig header.
//      Shared secret: QC_EXCHANGE_SECRET (server-side env var, never public).
//   2. Uses service-role key to write qc_imports — bypasses RLS so normal
//      authenticated users can never write to source_*/test_result/qc_status.
//
// Idempotency:
//   Upserts on UNIQUE(source_factory, source_record_id, version).
//   If the same record arrives again with the same version → no-op (200).
//   If a newer version arrives → marks the previous row status='superseded',
//   sets superseded_by, and inserts the new version. History is preserved.
//
// This endpoint should ONLY be deployed on A-20. On A-20/1 it is present
// in the codebase but gated: if FACTORY_CODE !== "A20" the endpoint returns 404.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { verifyHmacSignature } from "@/lib/qc-exchange/hmac";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_LAB_QC_SUPABASE_URL
           ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Derive a human-readable qc_type label from source_table + payload. */
function deriveQcType(sourceTable: string, payload: Record<string, unknown>): string {
  if (sourceTable === "product_qc") {
    const phase = payload.phase as string | undefined;
    const product = payload.product_name as string | undefined;
    return [product, phase && phase !== "none" ? `Phase ${phase}` : null]
      .filter(Boolean)
      .join(" · ") || "Product QC";
  }
  if (sourceTable === "rm_qc")          return "RM QC";
  if (sourceTable === "batch_analysis") return "Batch Analysis";
  return sourceTable;
}

export async function POST(request: NextRequest) {
  // -------------------------------------------------------------------------
  // Gate: only run on A-20 deployment
  // -------------------------------------------------------------------------
  const factoryCode = process.env.NEXT_PUBLIC_FACTORY_CODE ?? "A20_1";
  if (factoryCode !== "A20") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = process.env.QC_EXCHANGE_SECRET;
  if (!secret) {
    console.error("[qc-exchange/receive] QC_EXCHANGE_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 1. Read raw body (needed for HMAC verification)
  // -------------------------------------------------------------------------
  const bodyText = await request.text();

  // -------------------------------------------------------------------------
  // 2. Verify HMAC signature
  // -------------------------------------------------------------------------
  const incomingSig = request.headers.get("x-qc-exchange-sig") ?? "";
  const valid = await verifyHmacSignature(bodyText, incomingSig, secret);
  if (!valid) {
    console.warn("[qc-exchange/receive] Invalid signature from", request.headers.get("x-qc-exchange-factory"));
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // -------------------------------------------------------------------------
  // 3. Parse payload
  // -------------------------------------------------------------------------
  let body: {
    exchange_id:      string;
    source_factory:   string;
    source_table:     string;
    source_record_id: string;
    payload:          Record<string, unknown>;
    sent_at:          string;
    version:          number;
  };

  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    exchange_id, source_factory, source_table,
    source_record_id, payload, sent_at, version,
  } = body;

  if (!exchange_id || !source_factory || !source_table || !source_record_id || !payload) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // -------------------------------------------------------------------------
  // 4. Compute checksum of payload for integrity auditing
  // -------------------------------------------------------------------------
  const payloadString = JSON.stringify(payload);
  const checksumBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadString)
  );
  const checksum = Array.from(new Uint8Array(checksumBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const admin = getServiceClient();

  // -------------------------------------------------------------------------
  // 5. Check for existing record with same (source_factory, source_record_id)
  // -------------------------------------------------------------------------
  const { data: existing } = await admin
    .from("qc_imports")
    .select("id, version, status")
    .eq("source_factory", source_factory)
    .eq("source_record_id", source_record_id)
    .eq("status", "active")
    .maybeSingle();

  // Idempotent: exact same version already received
  if (existing && existing.version === (version ?? 1)) {
    return NextResponse.json({ received: true, action: "already_exists", id: existing.id });
  }

  // -------------------------------------------------------------------------
  // 6. Insert new qc_imports row
  // -------------------------------------------------------------------------
  const newVersion = (version ?? 1);
  const newRow = {
    exchange_id,
    source_factory,
    source_record_id,
    source_table,
    source_batch_number: payload.batch_number as string | null ?? null,
    material:            payload.material_name as string | null ?? null,
    product:             payload.product_name  as string | null ?? null,
    qc_type:             deriveQcType(source_table, payload),
    test_result:         payload.overall_result as string | null ?? "pending",
    qc_status:           "received",
    tested_at:           payload.test_date  as string | null ?? null,
    finalized_at:        sent_at,
    transferred_at:      new Date().toISOString(),
    payload,
    version:             newVersion,
    status:              "active",
    checksum,
  };

  const { data: inserted, error: insertErr } = await admin
    .from("qc_imports")
    .insert(newRow)
    .select("id")
    .single();

  if (insertErr) {
    // If it's a unique-constraint violation → already received, safe to ack
    if (insertErr.code === "23505") {
      return NextResponse.json({ received: true, action: "duplicate_ignored" });
    }
    console.error("[qc-exchange/receive] Insert error:", insertErr.message);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 7. If a previous version exists, mark it superseded
  // -------------------------------------------------------------------------
  if (existing && existing.version < newVersion) {
    await admin
      .from("qc_imports")
      .update({ status: "superseded", superseded_by: inserted!.id })
      .eq("id", existing.id);
  }

  return NextResponse.json({
    received: true,
    action:   existing ? "version_updated" : "inserted",
    id:       inserted!.id,
    version:  newVersion,
  });
}
