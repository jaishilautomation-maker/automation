// =============================================================================
// Phase B auto-calculation (A-20 job cards with a Phase A -> chemist -> Phase B
// workflow, e.g. Sulphur SC, Zinc SC).
//
// Pure functions only: no I/O, no imports. Used by the chemist review API (the
// authoritative calculation) and by the chemist page (live preview), so both
// always agree.
//
// Full precision is kept internally. Rounding is a DISPLAY concern (fmtKg);
// every comparison below uses the unrounded numbers.
//
//   active_kg     = phaseA_kg x conc% / 100
//   target_weight = active_kg / (target% / 100)
//   phaseB_total  = target_weight - phaseA_kg
//   qty(i)        = formulation%(i) / 100 x target_weight   (non-water only)
//   water         = phaseB_total - sum(non-water qty)        (never negative)
// =============================================================================

/** Float-noise guard for equality-boundary comparisons (kg). Not a rounding step. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Lot number normalisation (shared with Product QC lookups)
// ---------------------------------------------------------------------------

/** trim + collapse internal whitespace. Case is preserved for display/storage. */
export function normalizeLot(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/** Comparison key: normalised AND lower-cased. Matches the SQL fn_norm_lot(). */
export function lotKey(raw: string | null | undefined): string {
  return normalizeLot(raw).toLowerCase();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseBIngredientInput {
  /** product_formula_items.id */
  id: string;
  name: string;
  /** % of FINAL batch weight = instructed_qty / reference_batch_size x 100 */
  formulationPct: number;
  isWater: boolean;
}

export interface PhaseBInputs {
  phaseAKg: number;
  concPct: number;
  targetPct: number;
  ingredients: PhaseBIngredientInput[];
}

export interface PhaseBIngredientResult {
  id: string;
  name: string;
  isWater: boolean;
  formulationPct: number;
  /** Unrounded kg. null when no quantities can be produced (Case 1). */
  qty: number | null;
}

export type LimitCase = 1 | 2;

export interface PhaseBLimit {
  case: LimitCase;
  message: string;
}

export interface PhaseBResult {
  valid: boolean;
  errors: string[];
  activeKg: number | null;
  targetWeight: number | null;
  phaseBTotal: number | null;
  ingredients: PhaseBIngredientResult[];
  /** Sum of non-water quantities (Case 2 and normal). null for Case 1. */
  nonWaterSum: number | null;
  /** Water to add (>= 0). null for Case 1. */
  water: number | null;
  /** Non-water kg required vs. room available in Phase B (Case 2). */
  neededKg: number | null;
  availableKg: number | null;
  /** active_kg / (phaseA + sum(qty)). Computed for Case 2 and normal. */
  achievedActivePct: number | null;
  /** Produced lot weight = phaseA + sum(qty incl. water). null for Case 1. */
  producedWeightKg: number | null;
  limit: PhaseBLimit | null;
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

export function validatePhaseBInputs(i: PhaseBInputs): string[] {
  const errors: string[] = [];
  if (!(Number.isFinite(i.phaseAKg) && i.phaseAKg > 0)) errors.push("Phase A weight must be greater than 0.");
  if (!(Number.isFinite(i.concPct) && i.concPct > 0 && i.concPct <= 100)) {
    errors.push("Phase A concentration must be greater than 0 and at most 100%.");
  }
  if (!(Number.isFinite(i.targetPct) && i.targetPct > 0 && i.targetPct <= 100)) {
    errors.push("Target active content must be greater than 0 and at most 100%.");
  }
  return errors;
}

function emptyResult(errors: string[]): PhaseBResult {
  return {
    valid: false, errors,
    activeKg: null, targetWeight: null, phaseBTotal: null, ingredients: [],
    nonWaterSum: null, water: null, neededKg: null, availableKg: null,
    achievedActivePct: null, producedWeightKg: null, limit: null,
  };
}

export function calcPhaseB(input: PhaseBInputs): PhaseBResult {
  const errors = validatePhaseBInputs(input);
  if (errors.length) return emptyResult(errors);

  const { phaseAKg, concPct, targetPct, ingredients } = input;
  const activeKg = (phaseAKg * concPct) / 100;
  const targetWeight = activeKg / (targetPct / 100);
  const phaseBTotal = targetWeight - phaseAKg;

  // Case 1: concentration at or below target - no diluent can fix it.
  if (targetWeight <= phaseAKg + EPS) {
    return {
      valid: true, errors: [],
      activeKg, targetWeight, phaseBTotal,
      ingredients: ingredients.map(g => ({
        id: g.id, name: g.name, isWater: g.isWater, formulationPct: g.formulationPct, qty: null,
      })),
      nonWaterSum: null, water: null, neededKg: null, availableKg: phaseBTotal,
      achievedActivePct: null, producedWeightKg: null,
      limit: {
        case: 1,
        message:
          "LIMIT EXCEEDED: Phase A concentration is at or below the target active content. " +
          "Adding Phase B cannot reach the target, so no Phase B quantities are issued.",
      },
    };
  }

  const nonWater = ingredients.filter(g => !g.isWater);
  const rows: PhaseBIngredientResult[] = ingredients.map(g => ({
    id: g.id, name: g.name, isWater: g.isWater, formulationPct: g.formulationPct,
    qty: g.isWater ? 0 : (g.formulationPct / 100) * targetWeight,
  }));
  const nonWaterSum = nonWater.reduce((s, g) => s + (g.formulationPct / 100) * targetWeight, 0);

  // Case 2: the fixed-% ingredients alone do not fit in Phase B.
  const exceeded = nonWaterSum > phaseBTotal + EPS;
  const water = exceeded ? 0 : Math.max(0, phaseBTotal - nonWaterSum);
  rows.forEach(r => { if (r.isWater) r.qty = water; });

  const producedWeightKg = phaseAKg + nonWaterSum + water;
  const achievedActivePct = (activeKg / producedWeightKg) * 100;

  return {
    valid: true, errors: [],
    activeKg, targetWeight, phaseBTotal,
    ingredients: rows,
    nonWaterSum, water,
    neededKg: nonWaterSum, availableKg: phaseBTotal,
    achievedActivePct, producedWeightKg,
    limit: exceeded
      ? {
          case: 2,
          message:
            "LIMIT EXCEEDED: the Phase B ingredients at their formulation % need more than the " +
            "room available in Phase B. Water is set to 0; every other ingredient stays at its " +
            "exact formulation %. The target active content cannot be reached.",
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Next-lot compensation
// ---------------------------------------------------------------------------

export interface CompensationSource {
  /** W1 = Phase A + sum(Phase B qty) of the rejected lot. */
  producedWeightKg: number;
  activeKg: number;
  achievedActivePct: number;
}

export interface CompensationInputs {
  previous: CompensationSource;
  phaseAKg: number;
  concPct: number;
  /** The DESIRED blended average (base target, not a previously compensated one). */
  targetPct: number;
  /** Sum of non-water formulation % (of final batch weight). */
  nonWaterFormulationPct: number;
}

export interface CompensationResult {
  valid: boolean;
  active2Kg: number | null;
  /** Total blended weight both lots must reach for the desired average. */
  blendTotalKg: number | null;
  phaseB2TotalKg: number | null;
  lot2WeightKg: number | null;
  suggestedTargetPct: number | null;
  /** c2 x (1 - sum(non-water %)/100): best % lot 2 can reach with water = 0. */
  maxAchievablePct: number | null;
  feasible: boolean;
  message: string | null;
}

export function calcCompensation(i: CompensationInputs): CompensationResult {
  const bad = validatePhaseBInputs({
    phaseAKg: i.phaseAKg, concPct: i.concPct, targetPct: i.targetPct, ingredients: [],
  });
  const none: CompensationResult = {
    valid: false, active2Kg: null, blendTotalKg: null, phaseB2TotalKg: null, lot2WeightKg: null,
    suggestedTargetPct: null, maxAchievablePct: null, feasible: false, message: bad[0] ?? null,
  };
  if (bad.length) return none;

  const active2Kg = (i.phaseAKg * i.concPct) / 100;
  const blendTotalKg = (i.previous.activeKg + active2Kg) / (i.targetPct / 100);
  const phaseB2TotalKg = blendTotalKg - i.previous.producedWeightKg - i.phaseAKg;
  const maxAchievablePct = i.concPct * (1 - i.nonWaterFormulationPct / 100);

  if (!(phaseB2TotalKg > EPS)) {
    return {
      valid: true, active2Kg, blendTotalKg, phaseB2TotalKg, lot2WeightKg: null,
      suggestedTargetPct: null, maxAchievablePct, feasible: false,
      message: "cannot be compensated in one lot: the next lot's concentration is too low to bring the blend up to the target.",
    };
  }

  const lot2WeightKg = i.phaseAKg + phaseB2TotalKg;
  const suggestedTargetPct = (active2Kg / lot2WeightKg) * 100;
  const feasible = suggestedTargetPct <= maxAchievablePct + EPS;
  return {
    valid: true, active2Kg, blendTotalKg, phaseB2TotalKg, lot2WeightKg,
    suggestedTargetPct, maxAchievablePct, feasible,
    message: feasible
      ? null
      : "cannot be compensated in one lot: the suggested target is above the maximum this lot can reach with water = 0.",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Display kg to 2 dp. Never used for comparisons. */
export function fmtKg(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
}

export function fmtPct(v: number | null | undefined, dp = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp);
}

/** Water is identified by name (the formula master has no water flag). */
export function isWaterName(name: string): boolean {
  return name.trim().toLowerCase() === "water";
}

/**
 * Formulation % of FINAL batch weight from a formula-master row:
 * instructed_qty / reference_batch_size x 100.
 */
export function formulationPctOf(instructedQtyKg: number, referenceBatchKg: number): number {
  return referenceBatchKg > 0 ? (instructedQtyKg / referenceBatchKg) * 100 : 0;
}
