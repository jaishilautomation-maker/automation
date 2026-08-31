// =============================================================================
// JSCI Unified QC + Job Card System — TypeScript Types
// Derived from 001_initial_schema.sql (v1.0) — reconciled 2026-08-21
// =============================================================================

// ---------------------------------------------------------------------------
// Enums  (match Postgres ENUM names exactly)
// ---------------------------------------------------------------------------

export type ActivityModule = "job_card" | "lab_qc";

export type AppRole =
  | "company_admin"
  | "factory_admin"
  | "lab_manager"
  | "chemist"
  | "production_incharge"
  | "operator"
  | "stores"          // A-20/1 pulveriser: issues oil to the batch (migration 016b/017)
  | "viewer";

/** Phase A / B apply to Sulphur SC and Zinc SC; all others use 'none'. */
export type QcPhase = "A" | "B" | "none";

export type BatchType = "rm" | "wip" | "fg" | "trial";

export type QuantityUnit = "kg" | "L" | "MT" | "bags" | "drums";

/** Valid values for attachments.entity_type */
export type AttachmentEntityType =
  | "rm_receipt"
  | "rm_qc"
  | "batch_analysis"
  | "product_qc"
  | "post_production_test"
  | "lab_trial"
  | "hourly_reading";

/** Valid values for lab_trials.status */
export type LabTrialStatus = "ongoing" | "completed" | "abandoned";

// ---------------------------------------------------------------------------
// Core / Auth tables
// ---------------------------------------------------------------------------

/** factories — 4 sites: DBV_20_1, DBV_20, NSK, SNP */
export interface Factory {
  id: string;            // uuid
  code: string;          // e.g. 'DBV_20_1'
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;    // timestamptz → ISO string
}

/**
 * factory_activities — which activities are valid at which factory+module.
 * Adding a new activity = one INSERT here, zero code changes.
 */
export interface FactoryActivity {
  id: string;
  factory_id: string;
  module: ActivityModule;
  activity: string;      // internal key: 'rm_receipt' | 'rm_qc' | 'hourly_reading' | etc.
  label: string;         // display name shown in the UI picker
  sort_order: number;
  is_active: boolean;
}

/** profiles — extends auth.users with display data */
export interface Profile {
  id: string;            // matches auth.users.id
  full_name: string;
  phone: string | null;
  employee_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * user_roles — join table.
 * One person can hold different roles at different factories / modules.
 * factory_id is NULL only for company_admin (spans all factories).
 * module is NULL means both modules within that factory.
 */
export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  factory_id: string | null;
  module: ActivityModule | null;
  granted_by: string | null;
  granted_at: string;
}

// ---------------------------------------------------------------------------
// Job Card module
// ---------------------------------------------------------------------------

/**
 * shifts — operator shift entry record.
 * The Job Card flow: operator creates → production_incharge fills in
 * production fields → chemist/lab_manager fills in QC fields.
 */
export interface Shift {
  id: string;
  factory_id: string | null;
  shift_date: string;               // ISO date
  shift_type: string;               // 'Day' | 'Night'
  machine: string | null;
  jobno: string | null;
  operator: string | null;

  // Checkpoints (operator entry)
  checkpoint_cleaning: boolean;
  checkpoint_roller: boolean;
  checkpoint_mesh: boolean;

  // Hours
  hours_total: number | null;

  // Production fields (filled by production_incharge)
  planned: number | null;
  actual: number | null;
  bags: number | null;
  batch_no: string | null;
  reason: string | null;

  // Signatures
  sig_operator: string | null;
  sig_maintenance: string | null;
  sig_production: string | null;
  sig_qc: string | null;

  // Workflow flags
  production_submitted: boolean;
  lab_submitted: boolean;

  // Ownership
  user_id: string | null;           // operator who created
  production_user_id: string | null;
  lab_user_id: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * batch_entries — one row per batch block within a shift.
 * Operator fills material/time/valve fields; chemist fills lab fields.
 */
export interface BatchEntry {
  id: string;
  shift_id: string;
  seq: number;

  // Operator fields
  from_time: string | null;
  to_time: string | null;
  material: string | null;
  calcifier: string | null;
  blower_in: string | null;
  blower_out: string | null;
  work: string | null;

  // Lab / QC fields (filled later)
  sulphur: string | null;
  oil: string | null;
  bag: string | null;
  packing: string | null;
  qc: string | null;
  stores: string | null;

  // Legacy fields kept for backwards compatibility
  batch_no: string | null;
  bags: number | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Lab QC module — master / definition tables
// ---------------------------------------------------------------------------

/**
 * materials — 6 raw materials.
 * codes: SULPHUR_CRUDE, SULPHUR_POWDER, ZINC_OXIDE,
 *        CALCIUM_CHLORIDE, TEBUCONAZOLE, BORIC_POWDER
 */
export interface Material {
  id: string;
  code: string;          // e.g. 'SULPHUR_CRUDE'
  name: string;
  description: string | null;
  is_active: boolean;
}

/**
 * products — 5 regular + 6 trial-only products.
 * is_trial_only = true → hidden from Product QC picker, visible in Lab Trials.
 */
export interface Product {
  id: string;
  code: string;          // e.g. 'SULPHUR_SC'
  name: string;
  description: string | null;
  is_trial_only: boolean;
  is_active: boolean;
}

/**
 * qc_test_definitions — master dynamic form driver.
 * The UI fetches rows matching material_id OR product_id + phase
 * and renders exactly those fields — nothing is hardcoded in the frontend.
 *
 * Exactly one of material_id / product_id is non-null (CHECK enforced by DB).
 * formula is a JS-compatible expression; sibling test_key values are variables.
 */
export interface QcTestDefinition {
  id: string;
  material_id: string | null;   // set for RM QC forms
  product_id: string | null;    // set for Product QC forms
  phase: QcPhase;               // 'A' | 'B' | 'none'
  test_key: string;             // snake_case key matching JSONB key in test_results
  label: string;
  unit: string | null;          // '%', 'g/cm³', 'mL', etc.
  input_type: string;           // 'number' | 'text' | 'select' | 'boolean' | 'photo' | 'date'
  options: string[] | null;     // for input_type = 'select'
  formula: string | null;       // null = user-entered; non-null = calculated
  is_calculated: boolean;
  sort_order: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Lab QC module — batch / traceability tables
// ---------------------------------------------------------------------------

/**
 * batches — central traceability record.
 * Every QC result links here via batch_id.
 * source_batch_id is the self-referential FK for the
 * Factory A 20/1 → Factory A 20 Sulphur Powder chain.
 */
export interface Batch {
  id: string;
  batch_number: string;
  lot_number: string | null;
  factory_id: string;
  material_id: string | null;
  product_id: string | null;
  batch_type: BatchType;
  production_date: string;      // ISO date
  machine: string | null;
  quantity: number | null;
  unit: QuantityUnit | null;
  source_batch_id: string | null;  // links to batches.id for read-through
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * rm_receipts — raw material delivery records.
 * One row per delivery event; batch_id links to batches for traceability.
 */
export interface RmReceipt {
  id: string;
  batch_id: string;
  factory_id: string;           // denormalised for RLS efficiency
  supplier_name: string;
  invoice_number: string | null;
  vehicle_number: string | null;
  received_date: string;        // ISO date
  received_by: string;          // auth.users.id
  quantity: number;
  unit: QuantityUnit;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Lab QC module — QC result tables
// ---------------------------------------------------------------------------

/**
 * rm_qc — raw material QC results.
 * test_results JSONB keys must match qc_test_definitions.test_key.
 *
 * Special case — Sulphur Powder at Factory A 20:
 * NO row is inserted here. The frontend queries v_rm_qc_with_source
 * which resolves the 20/1 record via batches.source_batch_id and
 * displays it read-only (is_read_through = true on that view).
 */
export interface RmQc {
  id: string;
  batch_id: string;
  factory_id: string;
  material_id: string;
  chemist_id: string;
  test_date: string;            // ISO date
  appearance: string | null;
  appearance_ok: boolean | null;
  test_results: Record<string, unknown>;  // JSONB — keys = test_key values
  remarks: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * hourly_readings — Sulphur Powder production hourly log (Factory A 20/1).
 * Append-only (no updated_at column — corrections via audit_log).
 */
export interface HourlyReading {
  id: string;
  batch_id: string;
  factory_id: string;
  recorded_by: string;
  reading_time: string;         // timestamptz → ISO string
  test_results: Record<string, unknown>;
  remarks: string | null;
  created_at: string;
}

/**
 * batch_analysis — end-of-batch Sulphur Powder quality analysis.
 * UNIQUE (batch_id) — one analysis per batch; re-opening = UPDATE, not INSERT.
 */
export interface BatchAnalysis {
  id: string;
  batch_id: string;
  factory_id: string;
  chemist_id: string;
  analysis_date: string;        // ISO date
  appearance: string | null;
  appearance_ok: boolean | null;
  test_results: Record<string, unknown>;
  remarks: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * product_qc — product QC results, phase-aware.
 * UNIQUE (batch_id, product_id, phase).
 * overall_result is computed by fn_evaluate_product_qc() trigger — never
 * calculated in frontend JS.
 */
export interface ProductQc {
  id: string;
  batch_id: string;
  factory_id: string;
  product_id: string;
  phase: QcPhase;
  chemist_id: string;
  test_date: string;            // ISO date
  appearance: string | null;
  appearance_ok: boolean | null;
  test_results: Record<string, unknown>;
  overall_result: string | null; // 'pass' | 'fail' | null (set by DB trigger)
  remarks: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * post_production_tests — stability / retest tracking.
 * product_qc_id is NULLABLE — workflow not yet confirmed with company.
 * Tighten to NOT NULL in a future migration once confirmed.
 */
export interface PostProductionTest {
  id: string;
  product_qc_id: string | null; // nullable FK to product_qc
  batch_id: string;
  factory_id: string;
  chemist_id: string;
  test_date: string;
  test_results: Record<string, unknown>;
  remarks: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * lab_trials — trial records, including trial-only products.
 * batch_id and product_id are nullable: a trial may not have a formal batch
 * or named product yet.
 */
export interface LabTrial {
  id: string;
  batch_id: string | null;
  factory_id: string;
  product_id: string | null;
  trial_code: string;
  trial_date: string;
  chemist_id: string;
  objective: string | null;
  appearance: string | null;
  appearance_ok: boolean | null;
  test_results: Record<string, unknown>;
  conclusion: string | null;
  status: LabTrialStatus;
  remarks: string | null;
  submitted_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ---------------------------------------------------------------------------
// Supporting tables
// ---------------------------------------------------------------------------

/**
 * attachments — polymorphic photo/document store.
 * entity_type + entity_id point to any QC table row.
 * Storage path convention: {factory_code}/{entity_type}/{entity_id}/{uuid}.jpg
 */
export interface Attachment {
  id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  factory_id: string;           // denormalised for RLS
  storage_path: string;         // Supabase Storage object path
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
}

/**
 * audit_log — immutable change history.
 * Written exclusively by fn_audit_log() DB trigger; never by application code.
 * id is bigserial (number), not uuid.
 */
export interface AuditLog {
  id: number;
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: string | null;
  factory_id: string | null;
  changed_at: string;
}

// ---------------------------------------------------------------------------
// View shapes (returned by Supabase .from('v_...'))
// ---------------------------------------------------------------------------

/** Row returned by the v_unified_search view (full-text search bar) */
export interface UnifiedSearchRow {
  batch_id: string;
  batch_number: string;
  lot_number: string | null;
  factory_id: string;
  factory_name: string;
  batch_type: BatchType;
  production_date: string;
  material_id: string | null;
  material_name: string | null;
  product_id: string | null;
  product_name: string | null;
  created_by_name: string | null;
}

/** Row returned by the v_rm_qc_with_source view (Sulphur Powder read-through) */
export interface RmQcWithSource {
  batch_id: string;
  batch_number: string;
  batch_factory_id: string;
  source_batch_id: string | null;
  source_batch_number: string | null;
  source_factory_id: string | null;
  rm_qc_id: string | null;
  chemist_id: string | null;
  test_date: string | null;
  appearance: string | null;
  appearance_ok: boolean | null;
  test_results: Record<string, unknown> | null;
  remarks: string | null;
  submitted_at: string | null;
  is_read_through: boolean;
}

/** Row returned by the v_factory_qc_summary view (dashboard) */
export interface FactoryQcSummary {
  factory_id: string;
  factory_name: string;
  test_date: string;
  product_name: string;
  total_tests: number;
  passed: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Database type map — used by the Supabase client generic
// e.g. createBrowserClient<Database>(url, key)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      // Core / auth
      factories: {
        Row: Factory;
        Insert: Omit<Factory, "id" | "created_at">;
        Update: Partial<Omit<Factory, "id">>;
      };
      factory_activities: {
        Row: FactoryActivity;
        Insert: Omit<FactoryActivity, "id">;
        Update: Partial<Omit<FactoryActivity, "id">>;
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id">>;
      };
      user_roles: {
        Row: UserRole;
        Insert: Omit<UserRole, "id" | "granted_at">;
        Update: Partial<Omit<UserRole, "id">>;
      };
      // Job Card
      shifts: {
        Row: Shift;
        Insert: Omit<Shift, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Shift, "id">>;
      };
      batch_entries: {
        Row: BatchEntry;
        Insert: Omit<BatchEntry, "id">;
        Update: Partial<Omit<BatchEntry, "id">>;
      };
      // Pulveriser Job Card (Form JSCI/PROD/02) — migration 015
      pulveriser_job_cards: {
        Row: PulveriserJobCard;
        Insert: Omit<PulveriserJobCard, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<PulveriserJobCard, "id">>;
      };
      pulveriser_hourly_readings: {
        Row: PulveriserHourlyReading;
        Insert: Omit<PulveriserHourlyReading, "id" | "created_at">;
        Update: Partial<Omit<PulveriserHourlyReading, "id">>;
      };
      pulveriser_job_card_reviews: {
        Row: PulveriserJobCardReview;
        Insert: Omit<PulveriserJobCardReview, "id" | "reviewed_at">;
        Update: never;  // append-only
      };
      // VFD / oil-dosing standard master (Form JSCI/PRD/10) — migration 017
      vfd_parameters: {
        Row: VfdParameter;
        Insert: Omit<VfdParameter, "id">;
        Update: Partial<Omit<VfdParameter, "id">>;
      };
      // Lab QC — master data
      materials: {
        Row: Material;
        Insert: Omit<Material, "id">;
        Update: Partial<Omit<Material, "id">>;
      };
      products: {
        Row: Product;
        Insert: Omit<Product, "id">;
        Update: Partial<Omit<Product, "id">>;
      };
      qc_test_definitions: {
        Row: QcTestDefinition;
        Insert: Omit<QcTestDefinition, "id">;
        Update: Partial<Omit<QcTestDefinition, "id">>;
      };
      // Lab QC — batch / traceability
      batches: {
        Row: Batch;
        Insert: Omit<Batch, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Batch, "id">>;
      };
      rm_receipts: {
        Row: RmReceipt;
        Insert: Omit<RmReceipt, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<RmReceipt, "id">>;
      };
      // Lab QC — QC results
      rm_qc: {
        Row: RmQc;
        Insert: Omit<RmQc, "id" | "submitted_at" | "updated_at">;
        Update: Partial<Omit<RmQc, "id">>;
      };
      hourly_readings: {
        Row: HourlyReading;
        Insert: Omit<HourlyReading, "id" | "created_at">;
        Update: Partial<Omit<HourlyReading, "id">>;
      };
      batch_analysis: {
        Row: BatchAnalysis;
        Insert: Omit<BatchAnalysis, "id" | "submitted_at" | "updated_at">;
        Update: Partial<Omit<BatchAnalysis, "id">>;
      };
      product_qc: {
        Row: ProductQc;
        Insert: Omit<ProductQc, "id" | "submitted_at" | "updated_at">;
        Update: Partial<Omit<ProductQc, "id">>;
      };
      post_production_tests: {
        Row: PostProductionTest;
        Insert: Omit<PostProductionTest, "id" | "submitted_at" | "updated_at">;
        Update: Partial<Omit<PostProductionTest, "id">>;
      };
      lab_trials: {
        Row: LabTrial;
        Insert: Omit<LabTrial, "id" | "submitted_at" | "updated_at">;
        Update: Partial<Omit<LabTrial, "id">>;
      };
      // Supporting
      attachments: {
        Row: Attachment;
        Insert: Omit<Attachment, "id" | "uploaded_at">;
        Update: Partial<Omit<Attachment, "id">>;
      };
      audit_log: {
        Row: AuditLog;
        Insert: never;  // written only by DB trigger
        Update: never;  // blocked by DB rule
      };
    };
    Views: {
      v_unified_search: { Row: UnifiedSearchRow };
      v_rm_qc_with_source: { Row: RmQcWithSource };
      v_factory_qc_summary: { Row: FactoryQcSummary };
    };
    Enums: {
      activity_module: ActivityModule;
      app_role: AppRole;
      qc_phase: QcPhase;
      batch_type: BatchType;
      quantity_unit: QuantityUnit;
      pulveriser_status: PulveriserStatus;
    };
  };
}

// ---------------------------------------------------------------------------
// Breakdown Register (Form JSCI/PROD/04) — A-20/1 only
// ---------------------------------------------------------------------------

/** Machine options for the breakdown_register machine_name column. */
export const BREAKDOWN_MACHINES = [
  "M1",
  "M2",
  "N2 30Nm",
  "N2 50Nm",
  "CP Air Comp",
  "CT Air Comp",
  "AT Air Comp",
  "Forklift",
  "Screening Machine",
  "Crusher",
] as const;

export type BreakdownMachine = typeof BREAKDOWN_MACHINES[number];

/**
 * breakdown_register — one row per breakdown event.
 * sr_no is auto-incremented per (factory_id, machine_name) by DB trigger.
 * Append-only: no UPDATE/DELETE for production_incharge.
 */
export interface BreakdownEntry {
  id: string;
  factory_id: string;
  machine_name: BreakdownMachine;
  sr_no: number;
  start_at: string;            // timestamptz ISO
  finish_at: string | null;    // null = still ongoing
  nature_of_breakdown: string | null;
  repair_carried_out: string | null;
  parts_replaced: string | null;
  corrective_action: string | null;
  remarks: string | null;
  created_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Preventive Maintenance (Form JSCI/PROD/06) — A-20/1 only
// ---------------------------------------------------------------------------

/**
 * pm_schedule_items — static checklist seeded by migration 013.
 * Each row is one maintenance task for one machine component.
 */
export interface PmScheduleItem {
  id: string;
  factory_id: string;
  sr_no: number;
  machine: string;
  component: string;
  task: string;
  frequency_weeks: number;
}

/**
 * pm_completions — one row per "Mark done" action.
 * Append-only.
 */
export interface PmCompletion {
  id: string;
  schedule_item_id: string;
  completed_at: string;        // timestamptz ISO
  completed_by: string;        // auth.users.id
  notes: string | null;
}

/**
 * Derived view of a schedule item with its computed due status.
 * Built in the UI layer from pm_schedule_items + latest pm_completion.
 */
export interface PmItemWithStatus {
  item: PmScheduleItem;
  lastDoneAt: string | null;
  nextDueAt: string;           // ISO date string
  status: "ok" | "due_soon" | "overdue";
}

// ---------------------------------------------------------------------------
// QC Exchange — A-20/1 exchange log + A-20 imports
// ---------------------------------------------------------------------------

/** qc_exchange_log — A-20/1 side. Tracks outbound QC sync attempts. */
export interface QcExchangeLog {
  id: string;
  source_table: string;        // 'product_qc' | 'rm_qc' | 'batch_analysis'
  source_record_id: string;
  factory_id: string;
  payload: Record<string, unknown>;
  status: "SYNC_PENDING" | "SYNC_SENT" | "SYNC_FAILED";
  attempt_count: number;
  last_attempted_at: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** qc_imports — A-20 side. Received QC records from A-20/1. */
export interface QcImport {
  id: string;
  exchange_id: string;
  source_factory: string;
  source_record_id: string;
  source_table: string;
  source_batch_number: string | null;
  material: string | null;
  product: string | null;
  qc_type: string | null;
  test_result: string | null;
  qc_status: "received" | "reviewed" | "rejected";
  tested_at: string | null;
  finalized_at: string | null;
  transferred_at: string;
  payload: Record<string, unknown>;
  version: number;
  superseded_by: string | null;
  status: "active" | "superseded";
  checksum: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// A-20 — Materials (extended with jsc_code)
// ---------------------------------------------------------------------------

/** materials — A-20 version adds jsc_code for JSC-1..JSC-73 master */
export interface MaterialA20 extends Material {
  jsc_code: string | null;   // e.g. 'JSC-1'; null for Water, Sulphur etc.
}

// ---------------------------------------------------------------------------
// A-20 Module A — Production Job Card
// ---------------------------------------------------------------------------

/**
 * product_formula_items — master recipe.
 * One row per component per product (per phase where applicable).
 * instructed_qty_kg is at reference_batch_size_kg scale.
 * UI scales to the operator's actual batch_size_kg.
 */
export interface ProductFormulaItem {
  id: string;
  product_id: string;
  phase: string | null;            // 'A' | 'B' | null (single-phase)
  order_no: number;
  component_name: string;
  jsc_code: string | null;         // null for Water, Sulphur, etc.
  instructed_qty_kg: number;
  reference_batch_size_kg: number;
}

/**
 * production_job_cards — one per production run.
 * status: 'draft' → 'submitted'
 */
export interface ProductionJobCard {
  id: string;
  factory_id: string;
  product_id: string;
  lot_no: string;
  job_date: string;              // ISO date
  operator_id: string;
  batch_size_kg: number;
  premix_start: string | null;   // HH:MM
  premix_end: string | null;
  bead_mill_start: string | null;
  bead_mill_end: string | null;
  flow_rate: number | null;
  collected_slurry_phase_a_kg: number | null;
  collected_slurry_phase_b_kg: number | null;
  ph: number | null;
  status: "draft" | "submitted";
  created_at: string;
  updated_at: string;
}

/**
 * production_job_card_items — actuals per formula component per run.
 * instructed_qty_kg is copied from the formula (scaled to batch_size_kg) at save time.
 */
export interface ProductionJobCardItem {
  id: string;
  job_card_id: string;
  formula_item_id: string;
  instructed_qty_kg: number;
  added_qty_kg: number | null;
  rm_batch_no: string | null;
  drum_bag_no: string | null;
  remark: string | null;
}

// ---------------------------------------------------------------------------
// A-20 Module B — Packing Machine Maintenance Checklist
// ---------------------------------------------------------------------------

/** packing_maintenance_items — static master list (seeded in migration 002) */
export interface PackingMaintenanceItem {
  id: string;
  factory_id: string;
  sr_no: number;
  machine_name: string;
  machine_part: string;
}

/** packing_maintenance_checklists — one per factory per date */
export interface PackingMaintenanceChecklist {
  id: string;
  factory_id: string;
  checklist_date: string;            // ISO date
  operator_sign: string;             // auth.users.id
  maintenance_engineer_sign: string | null;
  production_manager_sign: string | null;
  created_at: string;
}

/** packing_maintenance_checklist_entries — one row per item per checklist */
export interface PackingMaintenanceChecklistEntry {
  id: string;
  checklist_id: string;
  item_id: string;
  status: "do" | "do_not" | null;
  remark: string | null;
}

// ---------------------------------------------------------------------------
// A-20 Module C — Packing Machine Breakdown Report
// ---------------------------------------------------------------------------

export type PackingFaultType = "electrical" | "mechanical" | "hydraulic" | "pneumatic";

/** packing_breakdown_reports — one per breakdown event */
export interface PackingBreakdownReport {
  id: string;
  factory_id: string;

  // Header
  document_no: string | null;
  machine_code: string | null;
  machine_name: string;
  department: string;
  reporting_date: string;           // ISO date
  reporting_time: string | null;    // HH:MM

  // Problem
  problem_reported: string | null;
  nature_of_fault: PackingFaultType[];
  attended_by: string | null;

  // Details
  fault_details: string | null;
  root_cause: string | null;
  action_taken: string | null;
  cause_of_delay: string | null;
  spare_parts_consumed: string | null;
  quantity_specification: string | null;

  // Handover
  handed_over_date: string | null;
  handed_over_time: string | null;

  // Signatures
  production_supervisor_sign: string | null;
  production_manager_sign: string | null;
  maintenance_engineer_sign: string | null;
  maintenance_head_sign: string | null;

  production_remarks: string | null;

  created_by: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Pulveriser Job Card (Form JSCI/PROD/02) — A-20/1
// Migration 015. Authority-approved 3-role flow:
//   Production creates (pending) → Operator fills + submits (submitted_for_qc)
//   → Lab reviews OK (finalized) / NOT OK (back to pending, rework loop).
// ---------------------------------------------------------------------------

/**
 * Pulveriser job card lifecycle status (Postgres enum pulveriser_status).
 * 'pending_stores' (migration 016b): Production filled the card; awaiting Stores
 * to issue oil before the Operator can run the batch. NOT-OK reviews return the
 * card here for a full Stores → Operator → Lab rework cycle.
 */
export type PulveriserStatus =
  | "pending_stores"
  | "pending"
  | "submitted_for_qc"
  | "finalized";

/** Machine dropdown for pulveriser_job_cards.machine_number (fixed list). */
export const PULVERISER_MACHINES = [
  "M1",
  "M2",
] as const;

export type PulveriserMachine = typeof PULVERISER_MACHINES[number];

/**
 * Fixed low-production reason list for pulveriser_hourly_readings.
 * Do not invent others — the DB CHECK constraint rejects anything else.
 */
export const PULVERISER_LOW_PROD_REASONS = [
  "Mesh clogging (जाली भरना)",
  "Machine breakdown (मशीन खराब होना)",
  "Power off (बिजली बंद होना)",
  "Raw material issue (कच्चे माल की समस्या)",
  "Roller jam (रोलर जाम होना)",
  "Nitrogen unit issue (नाइट्रोजन यूनिट की समस्या)",
] as const;

export type PulveriserLowProdReason = typeof PULVERISER_LOW_PROD_REASONS[number];

/** Which stage a NOT-OK review reopened. Default reopening target is operator. */
export type PulveriserRejectedStage = "operator" | "production";

/** pulveriser_job_cards — one row per pulveriser job card. */
export interface PulveriserJobCard {
  id: string;
  factory_id: string;
  status: PulveriserStatus;

  // Production-owned
  machine_number: PulveriserMachine | null;
  job_number: string | null;
  shift: string | null;
  job_date: string | null;              // ISO date
  material_code: string | null;         // माल का कोड नंबर (free text)
  party_code: string | null;            // Party/CODE — dropdown; drives oil/VFD lookup (== vfd_parameters.party_code)
  sulphur_supplier: string | null;
  sulphur_lot_number: string | null;
  sulphur_empty_date: string | null;    // ISO date — खाली करने की तारीख
  oil_supplier: string | null;
  oil_batch_number: string | null;
  oil_quantity: number | null;
  planned_production_mt: number | null;   // Production-entered (migration 017)
  oil_required_kg: number | null;         // computed: planned_production_mt*1000*oil_feed_std
  production_by: string | null;         // auth.users.id
  production_at: string | null;         // timestamptz ISO

  // Stores-owned (migration 017) — issued after Production, before Operator
  oil_issued_kg: number | null;
  oil_issued_by: string | null;         // auth.users.id
  oil_issued_at: string | null;         // timestamptz ISO

  // Operator-owned
  actual_production_mt: number | null;     // Operator-entered (migration 017)
  classifier_vfd: string | null;
  blower_inlet_valve: string | null;
  blower_outlet_valve: string | null;
  finished_goods_bag: string | null;
  packing_size: string | null;
  qc_incharge_note: string | null;
  stores_incharge_note: string | null;
  work_details: string | null;
  checkpoint_machine_cleaning: boolean;
  checkpoint_roller_check: boolean;
  checkpoint_mesh_cloth_check: boolean;
  operator_by: string | null;           // auth.users.id
  operator_submitted_at: string | null; // timestamptz ISO

  // Calculated by DB trigger fn_pulveriser_recompute_oil (migration 017) —
  // never entered manually. oil_feed_std is looked up from vfd_parameters by
  // material_code (machine_type='mill').
  expected_oil_kg: number | null;               // actual_production_mt*1000*oil_feed_std
  actual_oil_consumption_kg: number | null;      // MIN(oil_issued_kg, expected_oil_kg)
  oil_variance_kg: number | null;                // oil_issued_kg - expected_oil_kg
  oil_extra_leftover_balance_kg: number | null;  // MAX(oil_issued_kg - expected_oil_kg, 0)
  oil_consumption_percent: number | null;        // consumption / (actual_mt*1000) * 100

  created_at: string;
  updated_at: string;
}

/** pulveriser_hourly_readings — repeating operator-filled rows per job card. */
export interface PulveriserHourlyReading {
  id: string;
  job_card_id: string;
  factory_id: string;
  machine: string | null;
  start_time: string | null;            // HH:MM[:SS]
  stop_time: string | null;             // HH:MM[:SS]
  total_hours: number | null;
  planned_production: number | null;
  low_production_reason: PulveriserLowProdReason | null;
  batch_no: string | null;
  bags: number | null;
  reading_date: string | null;          // ISO date
  created_at: string;
}

/** pulveriser_job_card_reviews — append-only Lab review history. */
export interface PulveriserJobCardReview {
  id: string;
  job_card_id: string;
  factory_id: string;
  reviewed_by: string;                  // auth.users.id
  result: "ok" | "not_ok";
  remark: string | null;
  rejected_stage: PulveriserRejectedStage | null;
  reviewed_at: string;                  // timestamptz ISO
}

// ---------------------------------------------------------------------------
// VFD / oil-dosing standard (Form JSCI/PRD/10) — migration 017
// Master lookup keyed by party_code, which is the SAME code stored as
// pulveriser_job_cards.material_code. Two machine types per code.
//   - 'mill' rows carry the oil ratio (oil_feed_std) used for all oil calcs
//     plus the expected classifier/feeder VFD the Operator sees as reference.
//   - 'oil_dosing_pump' rows carry classifier/feeder only (no oil ratio).
// ---------------------------------------------------------------------------

export type VfdMachineType = "mill" | "oil_dosing_pump";

export interface VfdParameter {
  id: string;
  party_code: string;                   // == pulveriser_job_cards.material_code
  machine_type: VfdMachineType;
  classifier_vfd: string | null;        // expected setting or range, e.g. "50" / "16-17"
  feeder_vfd: string | null;            // expected setting or range, e.g. "18-20"
  oil_feed_std: number | null;          // oil ratio (mill rows only); null = NA
  oil_feed_min: number | null;
  oil_feed_max: number | null;
  pump_flow: string | null;             // e.g. "10 LPH"; null = NA
  mesh_size_200: string | null;
  mesh_size_300: string | null;
  rev_no: number;
  effective_date: string;               // ISO date
}

/**
 * Parse a VFD reference string ("50" or "16-18") into a numeric [min,max] range.
 * Returns null for NA / non-numeric values (e.g. "NA", "Nil"). Used to flag —
 * not block — an operator reading that falls outside the expected band.
 */
export function parseVfdRange(ref: string | null | undefined): [number, number] | null {
  if (!ref) return null;
  const cleaned = ref.trim();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }
  const single = Number(cleaned);
  return Number.isFinite(single) ? [single, single] : null;
}
