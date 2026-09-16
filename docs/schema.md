# JSCI Unified QC + Job Card System — Database Schema
**Version:** 1.1  
**Date:** 2026-08-21  
**Stack:** Supabase (Postgres 15) + Next.js + Vercel  
**Status:** Awaiting approval before SQL migration is written  
**Changes in v1.1:** Factory "Dombivli 20/2" renamed to "Factory A 20" throughout; confirmed activity lists for Factory A 20/1 and Factory A 20 added to §11; Lab QC flow (chemist → factory → activity) documented in §1; Sulphur Powder batch lookup UX pending (§12 item #7)

---

## Table of Contents

1. [Design principles](#1-design-principles)
2. [Schema diagram (entity summary)](#2-schema-diagram-entity-summary)
3. [Core / Auth tables](#3-core--auth-tables)
4. [Material / Product / Test-definition tables](#4-material--product--test-definition-tables)
5. [Batch and receipt tables](#5-batch-and-receipt-tables)
6. [QC result tables](#6-qc-result-tables)
7. [Supporting tables](#7-supporting-tables)
8. [Row Level Security policy outlines](#8-row-level-security-policy-outlines)
9. [Indexes](#9-indexes)
10. [Views](#10-views)
11. [Seed data](#11-seed-data)
12. [Open items / deferred decisions](#12-open-items--deferred-decisions)

---

## 1. Design principles

| Principle | How it's applied |
|---|---|
| Lab QC entry flow | Chemist selects their name → selects factory (Factory A 20/1 or Factory A 20) → selects activity. The activity list shown is driven by `factory_activities` rows for that factory — no hardcoded menus |
| One login, two modules | `user_roles` join table holds `(user_id, role, factory_id, module)` tuples — one person can be operator at Job Card / Factory A 20/1 and chemist at Lab QC / Factory A 20 simultaneously |
| Factory-scoped access | Every QC/production table has a `factory_id` column; all RLS policies filter on it; cross-factory queries are blocked by default for all roles except `company_admin` |
| Dynamic forms, not hardcoded pages | `qc_test_definitions` drives which fields render for a given material or product — adding a new product is a data insert, not a code change |
| Hybrid schema for test results | Common columns (chemist, batch, date, appearance, photo) are real typed columns; variable numeric results live in `test_results JSONB`, validated at app layer against `qc_test_definitions` |
| Audit trail in the database | A single Postgres trigger function writes to `audit_log` on every INSERT/UPDATE/DELETE across all QC tables — cannot be bypassed by app code |
| Sulphur Powder read-through | Factory A 20 never re-enters Sulphur Powder QC; the app reads the linked Factory A 20/1 `rm_qc` row via `batches.source_batch_id`. If the 20/1 record is absent, UI shows a warning but does not block entry |
| Photo storage efficiency | Client-side resize to ≤1200 px / ~200–300 KB before upload; Supabase Storage private buckets; linked via polymorphic `attachments` table |
| Nullable FK for deferred features | `post_production_tests.product_qc_id` is nullable until the workflow is confirmed; tightening to NOT NULL later is a safe, one-line migration |

---

## 2. Schema diagram (entity summary)

```
auth.users (Supabase managed)
    │
    ├─► profiles          (1:1 with auth.users — display name, phone)
    └─► user_roles        (1:many — role + factory + module per user)

factories
    └─► factory_activities  (which activities are valid at which factory)

materials ──────────────────────────────────────────────┐
products  ──────────────────────────────────────────────┤
    └─► qc_test_definitions  (test name, unit, formula) │
                                                        │
batches (self-referential via source_batch_id) ─────────┤
    ├─► rm_receipts                                     │
    ├─► rm_qc              (test_results JSONB) ────────┘
    ├─► hourly_readings
    ├─► batch_analysis     (test_results JSONB)
    ├─► product_qc         (test_results JSONB, phase-aware)
    │       └─► post_production_tests (nullable FK)
    └─► lab_trials         (test_results JSONB)

attachments  (polymorphic: entity_type + entity_id)
audit_log    (trigger-populated, immutable)
```

---

## 3. Core / Auth tables

### 3.1 `factories`

Stores the four known production sites. Adding Nashik and Sonepat is a data insert here.

```sql
CREATE TABLE factories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text        NOT NULL UNIQUE,   -- 'DBV_20_1', 'DBV_20', 'NSK', 'SNP'
    name        text        NOT NULL,          -- 'Factory A 20/1', 'Factory A 20', 'Nashik', 'Sonepat'
    location    text,                          -- city / address
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Seed rows (§11):** Factory A 20/1, Factory A 20, Nashik, Sonepat.

---

### 3.2 `factory_activities`

Defines which activities are enabled at which factory. Dombivli-20/1 and 20/2 each have their own set; Nashik and Sonepat start with no rows and get populated later.

```sql
CREATE TYPE activity_module AS ENUM ('job_card', 'lab_qc');

CREATE TABLE factory_activities (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    factory_id  uuid        NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    module      activity_module NOT NULL,
    activity    text        NOT NULL,   -- e.g. 'rm_receipt', 'rm_qc', 'hourly_reading',
                                       --      'batch_analysis', 'product_qc', 'lab_trial'
    label       text        NOT NULL,  -- display name shown in UI picker
    sort_order  smallint    NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    UNIQUE (factory_id, module, activity)
);
```

**Note:** `activity` values are the internal keys the frontend routes on (e.g. `'rm_qc'` maps to the RM QC form). Adding a new activity at Nashik = one INSERT here, no code change.

---

### 3.3 `profiles`

Extends `auth.users` (Supabase manages the auth row; this table holds display data).

```sql
CREATE TABLE profiles (
    id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name    text        NOT NULL,
    phone        text,
    employee_id  text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
```

**Trigger:** `updated_at` refreshed automatically on every UPDATE.

---

### 3.4 `user_roles`

The join table that gives one person multiple roles across factories and modules.

```sql
CREATE TYPE app_role AS ENUM (
    'company_admin',    -- cross-factory, cross-module read/write
    'factory_admin',    -- single factory, both modules, read/write
    'lab_manager',      -- single factory, lab_qc module, read + correction rights
    'chemist',          -- single factory, lab_qc module, create/read own entries
    'production_incharge', -- single factory, job_card module
    'operator',         -- single factory, job_card module
    'viewer'            -- single factory, read-only
);

CREATE TABLE user_roles (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        app_role        NOT NULL,
    factory_id  uuid            REFERENCES factories(id) ON DELETE CASCADE,
                                -- NULL only for company_admin (spans all factories)
    module      activity_module,
                                -- NULL means access to both modules within factory
    granted_by  uuid            REFERENCES auth.users(id),
    granted_at  timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, role, factory_id, module)
);
```

**Key rules (enforced in RLS, not just app logic):**
- `company_admin` → `factory_id` should be NULL (all factories).
- `chemist`, `operator` → `factory_id` required.
- One person can hold multiple rows (e.g. chemist at Factory A 20/1 + viewer at Factory A 20).

---

## 4. Material / Product / Test-definition tables

### 4.1 `materials`

```sql
CREATE TABLE materials (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text    NOT NULL UNIQUE,  -- 'SULPHUR_CRUDE', 'SULPHUR_POWDER', etc.
    name        text    NOT NULL,         -- 'Crude Sulphur', 'Sulphur Powder', etc.
    description text,
    is_active   boolean NOT NULL DEFAULT true
);
```

**Seed rows:** Crude Sulphur, Sulphur Powder, Zinc Oxide, Calcium Chloride, Tebuconazole, Boric Powder.

---

### 4.2 `products`

```sql
CREATE TABLE products (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text    NOT NULL UNIQUE,  -- 'SULPHUR_SC', 'LIQUID_BORON', etc.
    name            text    NOT NULL,
    description     text,
    is_trial_only   boolean NOT NULL DEFAULT false,
                            -- true → hidden from Product QC picker, visible in Lab Trials only
    is_active       boolean NOT NULL DEFAULT true
);
```

**Seed rows:**
- Regular products: Sulphur SC, Liquid Boron, Liquid Calcium, Zinc SC, Ziddi
- Trial-only (`is_trial_only = true`): CBM, CAN, SZN, SOM, ZNMG, K-Trail

---

### 4.3 `qc_test_definitions`

The master list that makes forms dynamic. Every form field for every material/product is a row here. The UI queries this table filtered by `(material_id OR product_id)` + optional `phase` and renders exactly those fields — no hardcoded field lists in the frontend.

```sql
CREATE TYPE qc_phase AS ENUM ('A', 'B', 'none');

CREATE TABLE qc_test_definitions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Exactly one of material_id / product_id is set (CHECK constraint enforces this)
    material_id     uuid        REFERENCES materials(id) ON DELETE CASCADE,
    product_id      uuid        REFERENCES products(id)  ON DELETE CASCADE,
    phase           qc_phase    NOT NULL DEFAULT 'none',
                                -- 'A'/'B' for Sulphur SC and Zinc SC multi-phase QC;
                                -- 'none' for all other materials/products
    test_key        text        NOT NULL,  -- internal key matching JSONB key in test_results
                                           -- e.g. 'purity_percent', 'moisture_percent'
    label           text        NOT NULL,  -- display label in the form
    unit            text,                  -- '%', 'g/ml', 'cP', etc. NULL if unitless
    input_type      text        NOT NULL DEFAULT 'number',
                                           -- 'number', 'text', 'select', 'boolean'
    options         jsonb,                 -- for input_type='select': ["Pass","Fail"]
    formula         text,                  -- Postgres expression for calculated fields
                                           -- e.g. '(titration_value * factor / sample_weight) * 100'
                                           -- NULL = user-entered, not calculated
    is_calculated   boolean     NOT NULL DEFAULT false,
    sort_order      smallint    NOT NULL DEFAULT 0,
    is_active       boolean     NOT NULL DEFAULT true,

    CONSTRAINT one_parent CHECK (
        (material_id IS NOT NULL AND product_id IS NULL) OR
        (material_id IS NULL AND product_id IS NOT NULL)
    )
);
```

**How a form renders (pseudocode):**
```
tests = SELECT * FROM qc_test_definitions
        WHERE (material_id = $chosen OR product_id = $chosen)
          AND phase = $phase          -- 'none' if single-phase
          AND is_active = true
        ORDER BY sort_order
```
Each row becomes one form field. Calculated fields (`is_calculated = true`) show a read-only preview as the chemist types.

---

## 5. Batch and receipt tables

### 5.1 `batches`

Central traceability record. Every QC or production result links here.

```sql
CREATE TYPE batch_type AS ENUM ('rm', 'wip', 'fg', 'trial');
CREATE TYPE quantity_unit AS ENUM ('kg', 'L', 'MT', 'bags', 'drums');

CREATE TABLE batches (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number    text        NOT NULL,           -- user-entered batch number
    lot_number      text,                           -- supplier lot / internal lot
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    material_id     uuid        REFERENCES materials(id),
    product_id      uuid        REFERENCES products(id),
                                -- exactly one of material_id/product_id set for traceability;
                                -- both nullable to allow partial entry saving
    batch_type      batch_type  NOT NULL,
    production_date date        NOT NULL,
    machine         text,                           -- machine / line identifier
    quantity        numeric(12,3),
    unit            quantity_unit,
    source_batch_id uuid        REFERENCES batches(id),
                                -- self-referential: Sulphur Powder 20/1 → 20/2 link
    created_by      uuid        NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (batch_number, factory_id)
);
```

**The 20/1 → 20/2 chain:**  
When a 20/2 batch of Sulphur Powder is created, its `source_batch_id` points to the 20/1 batch. The app resolves the 20/1 `rm_qc` row through this link and displays it read-only — no second QC entry is created.

---

### 5.2 `rm_receipts`

Records raw material receipts (supplier delivery, invoice details).

```sql
CREATE TABLE rm_receipts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    supplier_name   text        NOT NULL,
    invoice_number  text,
    vehicle_number  text,
    received_date   date        NOT NULL,
    received_by     uuid        NOT NULL REFERENCES auth.users(id),
    quantity        numeric(12,3) NOT NULL,
    unit            quantity_unit  NOT NULL,
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
```

---

## 6. QC result tables

All QC result tables share the same pattern:
- `batch_id` → `batches` (traceability anchor)
- `factory_id` (denormalized for RLS filtering efficiency — avoids join on every policy check)
- `chemist_id` → `auth.users`
- `appearance` text + `appearance_ok` boolean (Pass/Fail)
- `test_results JSONB` (variable numeric fields, keys match `qc_test_definitions.test_key`)
- `submitted_at` timestamptz
- `audit_log` covers all edits via trigger

---

### 6.1 `rm_qc`

Raw material QC results — covers Crude Sulphur and all other incoming materials.

```sql
CREATE TABLE rm_qc (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    material_id     uuid        NOT NULL REFERENCES materials(id),
    chemist_id      uuid        NOT NULL REFERENCES auth.users(id),
    test_date       date        NOT NULL,
    appearance      text,
    appearance_ok   boolean,
    test_results    jsonb       NOT NULL DEFAULT '{}',
                                -- keys match qc_test_definitions.test_key for this material
    remarks         text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        REFERENCES auth.users(id)
);
```

**Sulphur Powder read-through rule (enforced in app layer, flagged in schema docs):**  
- Factory 20/1: `rm_qc` row is created normally for Sulphur Powder.  
- Factory 20/2: NO `rm_qc` row is inserted. The app looks up `batches.source_batch_id` → fetches the 20/1 `rm_qc` row → renders it read-only.  
- If the 20/1 `rm_qc` row does not yet exist, the app shows: *"Warning: QC results for source batch [X] at Dombivli 20/1 are not yet recorded. You may proceed, but link this when available."*

---

### 6.2 `hourly_readings`

Sulphur Powder hourly production readings (recorded during the production run).

```sql
CREATE TABLE hourly_readings (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    recorded_by     uuid        NOT NULL REFERENCES auth.users(id),
    reading_time    timestamptz NOT NULL,   -- exact hour of reading
    test_results    jsonb       NOT NULL DEFAULT '{}',
                                -- keys defined in qc_test_definitions for Sulphur Powder / hourly
    remarks         text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
```

---

### 6.3 `batch_analysis`

Sulphur Powder end-of-batch analysis — covers quality tests (Section 8) and specific gravity / bulk density (Section 9 of the original form).

```sql
CREATE TABLE batch_analysis (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        NOT NULL UNIQUE REFERENCES batches(id) ON DELETE RESTRICT,
                                -- UNIQUE: one analysis per batch
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    chemist_id      uuid        NOT NULL REFERENCES auth.users(id),
    analysis_date   date        NOT NULL,
    appearance      text,
    appearance_ok   boolean,
    test_results    jsonb       NOT NULL DEFAULT '{}',
    remarks         text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        REFERENCES auth.users(id)
);
```

---

### 6.4 `product_qc`

Product QC results. Phase-aware: Sulphur SC and Zinc SC have Phase A and Phase B; all others are phase `none`. One row per batch per phase.

```sql
CREATE TABLE product_qc (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    product_id      uuid        NOT NULL REFERENCES products(id),
    phase           qc_phase    NOT NULL DEFAULT 'none',
    chemist_id      uuid        NOT NULL REFERENCES auth.users(id),
    test_date       date        NOT NULL,
    appearance      text,
    appearance_ok   boolean,
    test_results    jsonb       NOT NULL DEFAULT '{}',
    overall_result  text        GENERATED ALWAYS AS (
                                    CASE
                                        WHEN appearance_ok = false THEN 'FAIL'
                                        -- Further pass/fail logic applied at app layer
                                        -- and stored via trigger if needed
                                        ELSE NULL
                                    END
                                ) STORED,
    remarks         text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        REFERENCES auth.users(id),

    UNIQUE (batch_id, product_id, phase)  -- one QC record per batch per product per phase
);
```

**Note on `overall_result`:** The generated column seeds from `appearance_ok`; full pass/fail logic (numeric thresholds from `qc_test_definitions`) is evaluated in a Postgres function called at submission time and stored back via trigger. This is the single source of truth for calculations — not duplicated in frontend JS.

---

### 6.5 `post_production_tests`

Stability / retest tracking. Workflow not yet confirmed — nullable FK by design.

```sql
CREATE TABLE post_production_tests (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_qc_id   uuid        REFERENCES product_qc(id) ON DELETE SET NULL,
                                -- NULLABLE — deferred until workflow is confirmed
    batch_id        uuid        NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    chemist_id      uuid        NOT NULL REFERENCES auth.users(id),
    test_date       date        NOT NULL,
    test_results    jsonb       NOT NULL DEFAULT '{}',
    remarks         text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        REFERENCES auth.users(id)
);
```

**Migration path when workflow is confirmed:** `ALTER TABLE post_production_tests ALTER COLUMN product_qc_id SET NOT NULL;` — one line, safe.

---

### 6.6 `lab_trials`

Trial records, including trial-only products (CBM, CAN, SZN, SOM, ZNMG, K-Trail).

```sql
CREATE TABLE lab_trials (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid        REFERENCES batches(id) ON DELETE RESTRICT,
                                -- nullable: a trial may not have a formal batch yet
    factory_id      uuid        NOT NULL REFERENCES factories(id),
    product_id      uuid        REFERENCES products(id),
                                -- nullable: trial may be for a new unnamed product
    trial_code      text        NOT NULL,   -- internal trial identifier
    trial_date      date        NOT NULL,
    chemist_id      uuid        NOT NULL REFERENCES auth.users(id),
    objective       text,
    appearance      text,
    appearance_ok   boolean,
    test_results    jsonb       NOT NULL DEFAULT '{}',
    conclusion      text,
    status          text        NOT NULL DEFAULT 'ongoing',
                                -- 'ongoing', 'completed', 'abandoned'
    remarks         text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid        REFERENCES auth.users(id)
);
```

---

## 7. Supporting tables

### 7.1 `attachments`

Polymorphic photo/document store. One row per file across all entity types.

```sql
CREATE TABLE attachments (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     text        NOT NULL,
                                -- 'rm_receipt', 'rm_qc', 'batch_analysis',
                                -- 'product_qc', 'lab_trial', 'post_production_test'
    entity_id       uuid        NOT NULL,  -- FK to the relevant table's id (untyped at DB level)
    factory_id      uuid        NOT NULL REFERENCES factories(id),
                                -- denormalized for RLS
    storage_path    text        NOT NULL,  -- Supabase Storage object path
    file_name       text        NOT NULL,  -- original filename
    mime_type       text,
    size_bytes      integer,
    uploaded_by     uuid        NOT NULL REFERENCES auth.users(id),
    uploaded_at     timestamptz NOT NULL DEFAULT now()
);
```

**Storage convention:** `{factory_code}/{entity_type}/{entity_id}/{uuid}.jpg`  
**Bucket:** `qc-attachments` — private, RLS-protected.  
**Pre-upload:** client resizes to ≤1200 px wide, targeting ~200–300 KB.

---

### 7.2 `audit_log`

Immutable change history, written by Postgres trigger — not by application code.

```sql
CREATE TABLE audit_log (
    id              bigserial   PRIMARY KEY,
    table_name      text        NOT NULL,
    record_id       uuid        NOT NULL,
    operation       text        NOT NULL,   -- 'INSERT', 'UPDATE', 'DELETE'
    old_data        jsonb,                  -- NULL for INSERT
    new_data        jsonb,                  -- NULL for DELETE
    changed_by      uuid        REFERENCES auth.users(id),
                                -- resolved from auth.uid() inside the trigger
    factory_id      uuid,                   -- denormalized for fast factory-scoped audit queries
    changed_at      timestamptz NOT NULL DEFAULT now()
);
```

**Trigger (applied to all QC/production tables):**

```sql
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO audit_log (
        table_name, record_id, operation,
        old_data, new_data,
        changed_by, factory_id
    ) VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD)::jsonb END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
        auth.uid(),
        COALESCE(NEW.factory_id, OLD.factory_id)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;
```

This trigger is attached to: `rm_receipts`, `rm_qc`, `hourly_readings`, `batch_analysis`, `product_qc`, `post_production_tests`, `lab_trials`, `batches`.

**`audit_log` is append-only** — no UPDATE or DELETE is permitted on it at the DB level:

```sql
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
```

---

## 8. Row Level Security policy outlines

RLS is enabled on every table. All policies are additive (`PERMISSIVE`). The following is a policy outline — exact SQL will be generated from this.

### 8.1 General pattern

```
auth.uid() → user_roles → (role, factory_id, module)
```

Every RLS policy resolves the current user's roles by joining `user_roles`. A helper function avoids repeating this join:

```sql
CREATE OR REPLACE FUNCTION fn_user_has_factory_access(
    p_factory_id uuid,
    p_module     activity_module DEFAULT NULL,
    p_min_role   app_role        DEFAULT 'viewer'
) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id    = auth.uid()
          AND (factory_id = p_factory_id OR factory_id IS NULL) -- NULL = company_admin
          AND (p_module IS NULL OR module = p_module OR module IS NULL)
          AND role IN (
              -- roles that satisfy the minimum access level
              -- company_admin always passes; roles are ordered by permission level
              'company_admin', 'factory_admin',
              'lab_manager', 'chemist',
              'production_incharge', 'operator',
              'viewer'
          )
    )
$$;
```

### 8.2 Policy table

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `factories` | all authenticated | `company_admin` only | `company_admin` only | never |
| `factory_activities` | all authenticated | `company_admin`, `factory_admin` | same | never |
| `profiles` | own row | own row (via trigger on auth.users) | own row | never |
| `user_roles` | own rows | `company_admin`, `factory_admin` | same | `company_admin` |
| `materials` | all authenticated | `company_admin`, `factory_admin` | same | never |
| `products` | all authenticated | `company_admin`, `factory_admin` | same | never |
| `qc_test_definitions` | all authenticated | `company_admin`, `factory_admin` | same | never |
| `batches` | factory-scoped | `chemist`, `production_incharge`, `operator` at that factory | `lab_manager`+ at that factory | never |
| `rm_receipts` | factory-scoped | `chemist`, `operator` at that factory | `lab_manager`+ | never |
| `rm_qc` | factory-scoped | `chemist` at that factory | `lab_manager`+ | never |
| `hourly_readings` | factory-scoped | `operator`, `production_incharge` | `lab_manager`+ | never |
| `batch_analysis` | factory-scoped | `chemist` | `lab_manager`+ | never |
| `product_qc` | factory-scoped | `chemist` | `lab_manager`+ | never |
| `post_production_tests` | factory-scoped | `chemist` | `lab_manager`+ | never |
| `lab_trials` | factory-scoped | `chemist` | `lab_manager`+ | never |
| `attachments` | factory-scoped | any user with write access to the parent entity | `lab_manager`+ | never |
| `audit_log` | `lab_manager`+ at that factory | trigger only (SECURITY DEFINER) | never | never |

**"factory-scoped"** = `factory_id = ANY(user's allowed factory_ids)`.  
**"never" delete** = all deletes go through a `soft_delete` flag or are disallowed at DB level — no QC record is ever hard-deleted.  
**Lab Manager correction** = UPDATE right on all QC tables; every edit is captured in `audit_log`.

---

## 9. Indexes

```sql
-- Batch lookup (most common query: find by batch number at a factory)
CREATE INDEX idx_batches_factory_batch   ON batches (factory_id, batch_number);
CREATE INDEX idx_batches_source          ON batches (source_batch_id) WHERE source_batch_id IS NOT NULL;
CREATE INDEX idx_batches_material        ON batches (material_id);
CREATE INDEX idx_batches_product         ON batches (product_id);
CREATE INDEX idx_batches_production_date ON batches (production_date DESC);

-- QC tables: factory + date (standard dashboard filter)
CREATE INDEX idx_rm_qc_factory_date      ON rm_qc (factory_id, test_date DESC);
CREATE INDEX idx_product_qc_factory_date ON product_qc (factory_id, test_date DESC);
CREATE INDEX idx_product_qc_product      ON product_qc (product_id);
CREATE INDEX idx_lab_trials_factory      ON lab_trials (factory_id, trial_date DESC);

-- Attachments: entity lookup
CREATE INDEX idx_attachments_entity      ON attachments (entity_type, entity_id);
CREATE INDEX idx_attachments_factory     ON attachments (factory_id);

-- Audit log: per-record history
CREATE INDEX idx_audit_record            ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_factory_time      ON audit_log (factory_id, changed_at DESC);

-- Full-text search (see §10 for the unified search view)
CREATE INDEX idx_batches_fts ON batches USING GIN (
    to_tsvector('english',
        coalesce(batch_number, '') || ' ' ||
        coalesce(lot_number, '')
    )
);
```

---

## 10. Views

### 10.1 `v_batch_chain`

Walks `source_batch_id` both directions — shows the upstream source batch and all downstream usages. Used for the batch traceability screen.

```sql
CREATE VIEW v_batch_chain AS
WITH RECURSIVE chain AS (
    -- anchor: start from every batch
    SELECT id, batch_number, factory_id, source_batch_id,
           ARRAY[id] AS path, 0 AS depth
    FROM batches

    UNION ALL

    SELECT b.id, b.batch_number, b.factory_id, b.source_batch_id,
           c.path || b.id, c.depth + 1
    FROM batches b
    JOIN chain c ON b.source_batch_id = c.id
    WHERE NOT (b.id = ANY(c.path))  -- prevent cycles
      AND c.depth < 10              -- safety cap
)
SELECT * FROM chain;
```

### 10.2 `v_unified_search`

Powers the single search bar across batch number, lot number, product, material, chemist, and date.

```sql
CREATE VIEW v_unified_search AS
SELECT
    b.id            AS batch_id,
    b.batch_number,
    b.lot_number,
    b.factory_id,
    f.name          AS factory_name,
    b.batch_type,
    b.production_date,
    m.name          AS material_name,
    p.name          AS product_name,
    pr.full_name    AS created_by_name,
    to_tsvector('english',
        coalesce(b.batch_number, '')   || ' ' ||
        coalesce(b.lot_number, '')     || ' ' ||
        coalesce(m.name, '')           || ' ' ||
        coalesce(p.name, '')           || ' ' ||
        coalesce(pr.full_name, '')
    )               AS search_vector
FROM batches b
LEFT JOIN factories  f  ON f.id = b.factory_id
LEFT JOIN materials  m  ON m.id = b.material_id
LEFT JOIN products   p  ON p.id = b.product_id
LEFT JOIN profiles   pr ON pr.id = b.created_by;
```

**Usage:** `WHERE search_vector @@ plainto_tsquery('english', $user_input)`

### 10.3 `v_factory_qc_summary`

Per-factory daily summary used by the dashboard.

```sql
CREATE VIEW v_factory_qc_summary AS
SELECT
    pq.factory_id,
    f.name              AS factory_name,
    pq.test_date,
    p.name              AS product_name,
    COUNT(*)            AS total_tests,
    COUNT(*) FILTER (WHERE pq.appearance_ok = true)  AS passed,
    COUNT(*) FILTER (WHERE pq.appearance_ok = false) AS failed
FROM product_qc pq
JOIN factories f ON f.id = pq.factory_id
JOIN products  p ON p.id = pq.product_id
GROUP BY pq.factory_id, f.name, pq.test_date, p.name;
```

---

## 11. Seed data

To be inserted as part of the initial migration (before any application data):

**`factories`**
| code | name | location |
|---|---|---|
| DBV_20_1 | Dombivli 20/1 | Dombivli |
| DBV_20_2 | Dombivli 20/2 | Dombivli |
| NSK | Nashik | Nashik |
| SNP | Sonepat | Sonepat |

**`materials`**
Crude Sulphur, Sulphur Powder, Zinc Oxide, Calcium Chloride, Tebuconazole, Boric Powder

**`products`** (regular)
Sulphur SC, Liquid Boron, Liquid Calcium, Zinc SC, Ziddi

**`products`** (`is_trial_only = true`)
CBM, CAN, SZN, SOM, ZNMG, K-Trail

**`factory_activities`**
Dombivli 20/1 and 20/2 activities to be listed once the full activity list is confirmed.  
Nashik and Sonepat: no rows at launch.

**`qc_test_definitions`**
All test rows (test keys, labels, units, formulas) to be populated from the Google Form's 38 sections as part of the data mapping exercise before migration.

---

## 12. Open items / deferred decisions

| # | Item | Impact | Default applied |
|---|---|---|---|
| 1 | `factory_activities` rows for DBV_20_1 and DBV_20_2 — full list needed | Seeds can't be written until confirmed | Empty; to be provided |
| 2 | `qc_test_definitions` rows — all test keys, units, formulas per material/product | Dynamic forms won't render until populated | To be derived from Google Form sections |
| 3 | `post_production_tests` workflow — always linked to `product_qc`? | Nullable FK vs NOT NULL | Nullable FK until confirmed |
| 4 | Nashik and Sonepat activities | Zero rows at launch | `factory_activities` empty for these two |
| 5 | `overall_result` pass/fail thresholds per test | Postgres function needs threshold values from `qc_test_definitions` | Appearance-only pass/fail for now |
| 6 | Job Card tables — exact schema from existing app | Needs to be merged/reviewed for consistency | Not included in this document; address in next pass |

---

*Schema v1.0 — ready for review. No SQL migration file has been generated yet.  
Once this schema is approved, the next deliverable is the full Supabase migration SQL file.*
