// =============================================================================
// Chemist Phase A review - server-side logic (API routes only).
//
// One function, `computeReview`, builds the full review (QC fetch, formulation
// %, Phase B calculation, next-lot compensation). `preview` returns it, `save`
// persists it. All DB access goes through the CALLER's Supabase client, so RLS
// applies and audit_log records the chemist as the author.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcCompensation, calcPhaseB, formulationPctOf, isWaterName,
  type CompensationResult, type PhaseBIngredientInput, type PhaseBResult,
} from "./phase-b-calc";

export const REVIEWABLE_STATUSES = ["phase_a_submitted", "phase_b_ready", "rejected_limit_exceeded"] as const;
export const LAB_ROLES = ["chemist", "lab_manager", "factory_admin", "company_admin"];

export type CompMode = "suggested" | "override" | "none";

export interface ReviewRequest {
  jobCardId: string;
  /** "qc_record" = use the Product QC value fetched by lot; "manual" = concPct typed by the chemist. */
  concSource?: "qc_record" | "manual";
  concPct?: number | null;
  targetPct?: number | null;
  compMode?: CompMode;
  overrideTargetPct?: number | null;
}

export class ReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

interface CardRow {
  id: string;
  factory_id: string;
  product_id: string;
  lot_no: string;
  status: string;
  batch_size_kg: number;
  created_at: string;
  collected_slurry_phase_a_kg: number | null;
  target_active_pct: number | null;
  phase_a_conc_pct: number | null;
  phase_a_conc_source: string | null;
  limit_exceeded_case: number | null;
  compensation: { previousCardId?: string } | null;
  phase_b_calc: PhaseBSnapshot | null;
}

interface FormulaRow {
  id: string;
  phase: string | null;
  order_no: number;
  component_name: string;
  jsc_code: string | null;
  instructed_qty_kg: number;
  reference_batch_size_kg: number;
}

export interface PhaseBSnapshot {
  version: 1;
  inputs: {
    phaseAKg: number;
    concPct: number | null;
    concSource: "qc_record" | "manual";
    qcRecordId: string | null;
    targetPctBase: number | null;
    appliedTargetPct: number | null;
    compMode: CompMode;
  };
  formulation: { id: string; name: string; jscCode: string | null; pct: number; isWater: boolean }[];
  outputs: PhaseBResult | null;
  limit: PhaseBResult["limit"];
  compensation: {
    previousCardId: string;
    previousLot: string;
    previousProducedKg: number;
    previousActiveKg: number;
    previousAchievedPct: number;
    result: CompensationResult;
  } | null;
  errors: string[];
  calculatedBy: string | null;
  calculatedAt: string | null;
}

export interface QcMatch {
  recordId: string;
  batchNo: string | null;
  testDate: string | null;
  concPct: number | null;
  testKey: string;
}

export interface ReviewComputation {
  card: CardRow;
  productName: string;
  productCode: string;
  config: {
    qc_product_code: string; active_ingredient: string; qc_phase_a_test_key: string; default_target_pct: number | null;
  };
  qc: QcMatch | null;
  formulaPhase: string;
  formulaRows: FormulaRow[];
  snapshot: PhaseBSnapshot;
  result: PhaseBResult | null;
  canSave: boolean;
  /** Reasons the review cannot be saved yet (validation). */
  blockers: string[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Pick the Phase B formula group that belongs to this card's batch size. */
function pickPhaseB(rows: FormulaRow[], batchKg: number): { phase: string; rows: FormulaRow[] } | null {
  const b = rows.filter(r => (r.phase ?? "").toUpperCase().startsWith("B"));
  if (!b.length) return null;
  const groups = new Map<string, FormulaRow[]>();
  b.forEach(r => groups.set(r.phase as string, [...(groups.get(r.phase as string) ?? []), r]));
  if (groups.size === 1) { const [phase, rs] = [...groups.entries()][0]; return { phase, rows: rs }; }
  const bySuffix = groups.get(`B_${Math.round(batchKg)}`);
  if (bySuffix) return { phase: `B_${Math.round(batchKg)}`, rows: bySuffix };
  for (const [phase, rs] of groups) {
    if (Math.abs((rs[0]?.reference_batch_size_kg ?? 0) - batchKg) < 0.5) return { phase, rows: rs };
  }
  const [phase, rs] = [...groups.entries()][0];
  return { phase, rows: rs };
}

export async function computeReview(supabase: SupabaseClient, req: ReviewRequest): Promise<ReviewComputation> {
  // ---- card + product + config -------------------------------------------
  const { data: cardData, error: cardErr } = await supabase
    .from("production_job_cards").select("*").eq("id", req.jobCardId).maybeSingle();
  if (cardErr || !cardData) throw new ReviewError("Job card not found.", 404);
  const card = cardData as unknown as CardRow;

  const { data: product } = await supabase
    .from("products").select("code, name").eq("id", card.product_id).maybeSingle();
  if (!product) throw new ReviewError("Product not found.", 404);

  const { data: cfg } = await supabase
    .from("job_card_phase_config").select("*")
    .eq("job_card_product_code", product.code).eq("is_active", true).maybeSingle();
  if (!cfg) throw new ReviewError("This product does not use the Phase A -> chemist -> Phase B workflow.", 400);
  const config = cfg as ReviewComputation["config"];

  if (!(REVIEWABLE_STATUSES as readonly string[]).includes(card.status)) {
    throw new ReviewError(
      card.status === "phase_b_started" || card.status === "submitted"
        ? "Phase B has already started - the calculation is locked."
        : "This job card has not been submitted to the chemist yet.",
      409,
    );
  }

  // ---- formula master (Phase B) -------------------------------------------
  const { data: formula } = await supabase
    .from("product_formula_items").select("*").eq("product_id", card.product_id)
    .order("phase").order("order_no");
  // Products with several Phase B variants (Zinc: B_843 / B_808): the card's own
  // saved items say which variant the operator actually works with.
  const { data: cardItems } = await supabase
    .from("production_job_card_items").select("formula_item_id").eq("job_card_id", card.id);
  const itemIds = new Set(((cardItems ?? []) as { formula_item_id: string }[]).map(i => i.formula_item_id));
  const allFormula = (formula ?? []) as FormulaRow[];
  const bWithItems = allFormula.filter(r => (r.phase ?? "").toUpperCase().startsWith("B") && itemIds.has(r.id));
  const picked = bWithItems.length
    ? pickPhaseB(bWithItems, Number(card.batch_size_kg))
    : pickPhaseB(allFormula, Number(card.batch_size_kg));
  if (!picked) throw new ReviewError("No Phase B formula found in the formula master for this product.", 422);

  const ingredients: PhaseBIngredientInput[] = picked.rows.map(r => ({
    id: r.id,
    name: r.component_name,
    formulationPct: formulationPctOf(Number(r.instructed_qty_kg), Number(r.reference_batch_size_kg)),
    isWater: isWaterName(r.component_name),
  }));

  // ---- Phase A QC record by lot (never blocks) ----------------------------
  let qc: QcMatch | null = null;
  const { data: qcRows } = await supabase.rpc("fn_phase_a_qc_by_lot", {
    p_factory_id: card.factory_id, p_qc_product_code: config.qc_product_code, p_lot: card.lot_no,
  });
  const qcList = (qcRows ?? []) as { id: string; batch_no: string | null; test_date: string | null; test_results: Record<string, unknown> | null }[];
  // newest record that actually carries a usable concentration
  for (const r of qcList) {
    const c = num(r.test_results?.[config.qc_phase_a_test_key]);
    if (c !== null) {
      qc = { recordId: r.id, batchNo: r.batch_no, testDate: r.test_date, concPct: c, testKey: config.qc_phase_a_test_key };
      break;
    }
  }
  if (!qc && qcList[0]) {
    qc = { recordId: qcList[0].id, batchNo: qcList[0].batch_no, testDate: qcList[0].test_date, concPct: null, testKey: config.qc_phase_a_test_key };
  }

  // ---- inputs -------------------------------------------------------------
  const blockers: string[] = [];
  const phaseAKg = num(card.collected_slurry_phase_a_kg) ?? 0;

  let concSource: "qc_record" | "manual" =
    req.concSource ?? (qc?.concPct != null ? "qc_record" : (card.phase_a_conc_source as "manual" | null) ?? "manual");
  let concPct: number | null;
  if (concSource === "qc_record") {
    if (qc?.concPct != null) concPct = qc.concPct;
    else { concSource = "manual"; concPct = num(req.concPct) ?? num(card.phase_a_conc_pct); }
  } else {
    concPct = num(req.concPct) ?? num(card.phase_a_conc_pct);
  }

  const targetBase = num(req.targetPct) ?? num(card.target_active_pct) ?? num(config.default_target_pct);

  // ---- next-lot compensation ---------------------------------------------
  let compensation: PhaseBSnapshot["compensation"] = null;
  const nonWaterPct = ingredients.filter(g => !g.isWater).reduce((s, g) => s + g.formulationPct, 0);
  const { data: prevRows } = await supabase
    .from("production_job_cards")
    .select("id, lot_no, created_at, phase_b_calc, compensation_consumed_by")
    .eq("factory_id", card.factory_id).eq("product_id", card.product_id)
    .eq("lot_rejected", true).eq("limit_exceeded_case", 2)
    .neq("id", card.id).lt("created_at", card.created_at)
    .order("created_at", { ascending: false }).limit(5);
  const prev = ((prevRows ?? []) as { id: string; lot_no: string; phase_b_calc: PhaseBSnapshot | null; compensation_consumed_by: string | null }[])
    .find(p => (p.compensation_consumed_by === null || p.compensation_consumed_by === card.id) && p.phase_b_calc?.outputs);
  if (prev?.phase_b_calc?.outputs && targetBase !== null && concPct !== null && phaseAKg > 0) {
    const o = prev.phase_b_calc.outputs;
    if (o.producedWeightKg != null && o.activeKg != null && o.achievedActivePct != null) {
      const result = calcCompensation({
        previous: { producedWeightKg: o.producedWeightKg, activeKg: o.activeKg, achievedActivePct: o.achievedActivePct },
        phaseAKg, concPct, targetPct: targetBase, nonWaterFormulationPct: nonWaterPct,
      });
      compensation = {
        previousCardId: prev.id, previousLot: prev.lot_no,
        previousProducedKg: o.producedWeightKg, previousActiveKg: o.activeKg, previousAchievedPct: o.achievedActivePct,
        result,
      };
    }
  }

  const compMode: CompMode = !compensation ? "none" : (req.compMode ?? "suggested");
  let applied: number | null = targetBase;
  if (compensation && compMode === "suggested" && compensation.result.suggestedTargetPct != null) {
    applied = compensation.result.suggestedTargetPct;
  } else if (compensation && compMode === "override") {
    applied = num(req.overrideTargetPct);
    if (applied === null) blockers.push("Enter the override target % (or accept the suggested target).");
  }

  // ---- calculate ----------------------------------------------------------
  let result: PhaseBResult | null = null;
  if (phaseAKg <= 0) blockers.push("The operator has not entered the collected Phase A slurry (kg).");
  if (concPct === null) blockers.push("Enter the measured Phase A concentration (%).");
  if (targetBase === null) blockers.push("Enter the target active content (%).");
  if (phaseAKg > 0 && concPct !== null && applied !== null) {
    result = calcPhaseB({ phaseAKg, concPct, targetPct: applied, ingredients });
    if (!result.valid) blockers.push(...result.errors);
  }

  const snapshot: PhaseBSnapshot = {
    version: 1,
    inputs: {
      phaseAKg, concPct, concSource, qcRecordId: concSource === "qc_record" ? qc?.recordId ?? null : null,
      targetPctBase: targetBase, appliedTargetPct: applied, compMode,
    },
    formulation: picked.rows.map((r, i) => ({
      id: r.id, name: r.component_name, jscCode: r.jsc_code, pct: ingredients[i].formulationPct, isWater: ingredients[i].isWater,
    })),
    outputs: result && result.valid ? result : null,
    limit: result?.limit ?? null,
    compensation,
    errors: blockers,
    calculatedBy: null,
    calculatedAt: null,
  };

  return {
    card, productName: product.name, productCode: product.code, config, qc,
    formulaPhase: picked.phase, formulaRows: picked.rows,
    snapshot, result, canSave: blockers.length === 0 && !!result && result.valid, blockers,
  };
}

/** Persist a computed review. Caller has already checked the role. */
export async function saveReview(
  supabase: SupabaseClient, review: ReviewComputation, userId: string,
): Promise<{ status: string; snapshot: PhaseBSnapshot; newlyFlagged: boolean }> {
  if (!review.canSave || !review.result) {
    throw new ReviewError(review.blockers[0] ?? "Review is incomplete.", 422);
  }
  const { card, result, snapshot } = review;
  const now = new Date().toISOString();
  const limit = result.limit;
  const status = limit ? "rejected_limit_exceeded" : "phase_b_ready";
  const finalSnapshot: PhaseBSnapshot = { ...snapshot, calculatedBy: userId, calculatedAt: now };

  // 1. Phase B quantities onto the job card items (Case 1 = no quantities -> 0).
  for (const ing of result.ingredients) {
    const { data: upd, error } = await supabase
      .from("production_job_card_items")
      .update({ instructed_qty_kg: ing.qty ?? 0 })
      .eq("job_card_id", card.id).eq("formula_item_id", ing.id).select("formula_item_id");
    if (error) throw new ReviewError("Could not update Phase B quantities: " + error.message, 500);
    if (!upd || upd.length === 0) {
      throw new ReviewError(`Phase B row "${ing.name}" is missing on the job card. Ask the operator to open and save the card once.`, 409);
    }
  }

  // 2. Compensation bookkeeping: this lot consumes the previous rejected lot.
  const comp = snapshot.compensation;
  const usedCompensation = !!comp && snapshot.inputs.compMode !== "none";
  const oldPrevId = card.compensation?.previousCardId ?? null;
  if (oldPrevId && (!usedCompensation || comp?.previousCardId !== oldPrevId)) {
    await supabase.from("production_job_cards").update({ compensation_consumed_by: null }).eq("id", oldPrevId);
  }
  if (usedCompensation && comp) {
    const { error } = await supabase.from("production_job_cards")
      .update({ compensation_consumed_by: card.id }).eq("id", comp.previousCardId);
    if (error) throw new ReviewError("Could not link the previous lot: " + error.message, 500);
  }

  // 3. The card itself (status + snapshot in one UPDATE).
  const { error: upErr } = await supabase.from("production_job_cards").update({
    status,
    phase_a_conc_pct: snapshot.inputs.concPct,
    phase_a_conc_source: snapshot.inputs.concSource,
    phase_a_qc_record_id: snapshot.inputs.qcRecordId,
    target_active_pct: snapshot.inputs.targetPctBase,
    applied_target_pct: snapshot.inputs.appliedTargetPct,
    phase_b_calc: finalSnapshot,
    phase_b_calculated_at: now,
    phase_b_calculated_by: userId,
    limit_exceeded_case: limit ? limit.case : null,
    lot_rejected: !!limit,
    compensation: usedCompensation && comp
      ? {
          previousCardId: comp.previousCardId, previousLot: comp.previousLot,
          mode: snapshot.inputs.compMode,
          suggestedTargetPct: comp.result.suggestedTargetPct,
          appliedTargetPct: snapshot.inputs.appliedTargetPct,
          maxAchievablePct: comp.result.maxAchievablePct,
          feasible: comp.result.feasible, message: comp.result.message,
        }
      : null,
  }).eq("id", card.id);
  if (upErr) throw new ReviewError(upErr.message, 500);

  const newlyFlagged = !!limit && (card.status !== "rejected_limit_exceeded" || card.limit_exceeded_case !== limit.case);
  return { status, snapshot: finalSnapshot, newlyFlagged };
}
