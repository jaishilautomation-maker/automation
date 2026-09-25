# Report Templates — authoring guide

These `.xlsx` templates and their `.json` field maps are **uploaded manually**
to the private Supabase Storage bucket **`report-templates`** (created in the
dashboard, not via migration — see `supabase/migrations/049_report_templates_storage.sql`).

The files in this folder are the **reference field maps** (and a place to keep
the source-of-truth JSON in git). The actual population at runtime reads them
from the Storage bucket, so **whatever you commit here must also be uploaded**
to the bucket next to its `.xlsx`.

## One template + one field map per (product, form-type)

Filenames follow `<product-slug>_<form-type>`:

| Source event      | Form type              | Example filename                          |
| ----------------- | ---------------------- | ----------------------------------------- |
| `rm_qc`           | `incoming-inspection`  | `crude-sulphur_incoming-inspection.xlsx`  |
| `batch_analysis`  | `inprocess-inspection` | `sulphur-powder_inprocess-inspection.xlsx`|
| `product_qc`      | `final-inspection`     | `sulphur-powder_final-inspection.xlsx`    |
| `coa`             | `coa`                  | `sulphur-powder_coa.xlsx`                  |

The product slug is derived by `lib/reports/template-map.ts → productSlug()`.

## Authoring the `.xlsx` (manual, once per form)

Build the workbook by hand in Excel to match the real paper layout (title,
borders, merged header cells, labels). For **every blank input cell**, assign a
**Named Range**: select the cell → click the Name Box (top-left) → type a name
like `purity_actual`, `batch_no`, `sample_2_ash` → Enter.

The generator writes each DB value into the cell targeted by its Named Range.
Do not put formulas in cells the generator fills.

## The field map `.json`

Maps each Named Range to a DB reference. Two reference shapes are supported:

- `table.column` — a plain column on the loaded record, or a derived value the
  generator computes (`batch_no`, `job_no`, `product_name`, `chemist_name`,
  `test_date`, `overall_result`, etc.).
- `table.test_results.<key>` — a key inside the `test_results` JSONB column.

Any Named Range with no matching field-map entry is left blank. Any field-map
entry whose Named Range is missing from the workbook is skipped (logged).

## Wiring status

Report generation is triggered by `notifyReport({ source, recordId })`
(`lib/reports/notify-report-client.ts`) → `POST /api/lab-qc/generate-report`.

This is one shared codebase deployed once per factory via `NEXT_PUBLIC_FACTORY_CODE`
(`A20_1` = Dombivli A-20/1 crude→powder line; `A20` = Dombivli A-20 SC/liquid
products). Report triggers are scoped per factory:

| Trigger        | Factory | Wired?                                                          |
| -------------- | ------- | --------------------------------------------------------------- |
| rm_qc          | A-20/1  | ✅ both insert paths in `app/(app)/lab-qc/rm-qc/page.tsx`        |
| batch_analysis | A-20/1  | ✅ insert + update in `app/(app)/lab-qc/batch-analysis/page.tsx` |
| product_qc     | **A-20 only** | ✅ insert + update in `app/(app)/lab-qc/product-qc/page.tsx`, **gated behind `isA20`** so it never fires on the A-20/1 build. A-20/1 has no final-inspection report. |
| coa            | A-20/1 (dispatch) | ⏳ generator fully supports `source: "coa"`, but no COA-generation action exists in the app yet. When one is built, call `notifyReport({ source: "coa", recordId: <coa_documents.id> })` immediately after inserting the `coa_documents` row. |
| packing_qc     | both    | ⛔ not a report source (not in `ReportSource`); no report emitted today. |

**A-20/1 report-worthy finalization events: `rm_qc` (incoming, JSCI/QC/03) and
`batch_analysis` (in-process, JSCI/QC/16).** So the only templates you need to
upload for the A-20/1 deployment are `crude-sulphur_incoming-inspection.*` and
`sulphur-powder_inprocess-inspection.*`.

There is intentionally **no UI surface** for report generation anywhere — it is
purely automatic on finalization.
