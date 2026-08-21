// =============================================================================
// JSCI Unified QC + Job Card System — TypeScript Types
// Auto-derived from 001_initial_schema.sql
// =============================================================================

// ---------------------------------------------------------------------------
// Enums
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

export type QcPhase = "A" | "B" | "none";

export type BatchType = "rm" | "wip" | "fg" | "trial";

export type QuantityUnit = "kg" | "L" | "MT" | "bags" | "drums";

// ---------------------------------------------------------------------------
// Core / Auth tables
// ---------------------------------------------------------------------------

export interface Factory {
  id: string;
  code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
}

export interface FactoryActivity {
  id: string;
  factory_id: string;
  module: ActivityModule;
  activity: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  employee_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  factory_id: string;
  role: AppRole;
  granted_by: string | null;
  granted_at: string;
}

// ---------------------------------------------------------------------------
// Job Card module
// ---------------------------------------------------------------------------

export interface Shift {
  id: string;
  factory_id: string;
  activity_id: string;
  shift_date: string;         // ISO date string
  shift_type: string;         // e.g. "Morning", "Evening", "Night"
  machine: string;
  operator: string | null;
  jobno: string | null;

  // Checkpoints
  checkpoint_cleaning: boolean;
  checkpoint_roller: boolean;
  checkpoint_mesh: boolean;

  // Hours
  hours_total: number | null;

  // Production
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

  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchEntry {
  id: string;
  shift_id: string;
  seq: number;
  batch_no: string | null;
  bags: number | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Lab / QC module — master data
// ---------------------------------------------------------------------------

export interface RawMaterial {
  id: string;
  factory_id: string;
  code: string;
  name: string;
  supplier: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  factory_id: string;
  code: string;
  name: string;
  has_phases: boolean;      // true → phases A + B apply
  is_active: boolean;
  created_at: string;
}

export interface QcTestDefinition {
  id: string;
  factory_id: string | null; // null = global default
  product_id: string | null;
  raw_material_id: string | null;
  phase: QcPhase;
  test_key: string;
  label: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  formula: string | null;    // e.g. "100 - moisture - ash"
  sort_order: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Lab / QC module — batch records
// ---------------------------------------------------------------------------

export interface QcBatch {
  id: string;
  factory_id: string;
  activity_id: string;
  batch_type: BatchType;
  batch_no: string;
  batch_date: string;
  product_id: string | null;
  raw_material_id: string | null;
  phase: QcPhase;
  quantity: number | null;
  quantity_unit: QuantityUnit | null;
  supplier: string | null;
  vehicle_no: string | null;
  notes: string | null;
  status: string;             // 'draft' | 'submitted' | 'approved' | 'rejected'
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QcResult {
  id: string;
  batch_id: string;
  test_definition_id: string;
  raw_value: number | null;
  computed_value: number | null;
  is_pass: boolean | null;
  entered_by: string | null;
  entered_at: string;
  corrected_by: string | null;
  corrected_at: string | null;
  correction_reason: string | null;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface ActivityLog {
  id: string;
  user_id: string | null;
  factory_id: string | null;
  module: ActivityModule | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Database type map (used by the Supabase client generic)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      factories: { Row: Factory; Insert: Omit<Factory, "id" | "created_at">; Update: Partial<Omit<Factory, "id">> };
      factory_activities: { Row: FactoryActivity; Insert: Omit<FactoryActivity, "id">; Update: Partial<Omit<FactoryActivity, "id">> };
      profiles: { Row: Profile; Insert: Omit<Profile, "created_at" | "updated_at">; Update: Partial<Omit<Profile, "id">> };
      user_roles: { Row: UserRole; Insert: Omit<UserRole, "id" | "granted_at">; Update: Partial<Omit<UserRole, "id">> };
      shifts: { Row: Shift; Insert: Omit<Shift, "id" | "created_at" | "updated_at">; Update: Partial<Omit<Shift, "id">> };
      batch_entries: { Row: BatchEntry; Insert: Omit<BatchEntry, "id">; Update: Partial<Omit<BatchEntry, "id">> };
      raw_materials: { Row: RawMaterial; Insert: Omit<RawMaterial, "id" | "created_at">; Update: Partial<Omit<RawMaterial, "id">> };
      products: { Row: Product; Insert: Omit<Product, "id" | "created_at">; Update: Partial<Omit<Product, "id">> };
      qc_test_definitions: { Row: QcTestDefinition; Insert: Omit<QcTestDefinition, "id">; Update: Partial<Omit<QcTestDefinition, "id">> };
      qc_batches: { Row: QcBatch; Insert: Omit<QcBatch, "id" | "created_at" | "updated_at">; Update: Partial<Omit<QcBatch, "id">> };
      qc_results: { Row: QcResult; Insert: Omit<QcResult, "id" | "entered_at">; Update: Partial<Omit<QcResult, "id">> };
      activity_logs: { Row: ActivityLog; Insert: Omit<ActivityLog, "id" | "created_at">; Update: never };
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
