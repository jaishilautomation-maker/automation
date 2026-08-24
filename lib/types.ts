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
  | "lab_trial";

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
