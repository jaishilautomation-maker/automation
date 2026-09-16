# QC Test Definitions — Seed Data
**Version:** 1.0  
**Date:** 2026-08-21  
**Source:** Google Form column headers ("Form Responses 1") — 200+ columns mapped to normalized rows  
**Purpose:** This document defines every row to be inserted into `qc_test_definitions` before the app goes live. The frontend renders QC forms dynamically from this table — no form fields are hardcoded in UI components.

---

## How to read this document

Each section = one material or product.  
Each row in the tables below = one `qc_test_definitions` INSERT.

**Columns:**
- `test_key` — the JSONB key used in `test_results` (snake_case, unique per material/product)
- `label` — text shown to the chemist in the form
- `unit` — display unit (NULL if unitless or text)
- `input_type` — `number`, `text`, `select`, `photo`, `boolean`
- `is_calculated` — if true, value is derived from other fields (formula shown)
- `formula` — Postgres/JS expression; variables are other `test_key` values in the same submission
- `sort_order` — render order in the form

**Calculated field convention:**  
Variables in formulas reference sibling `test_key` values within the same `test_results` JSONB object.  
Example: `purity_percent` for Crude Sulphur = `(m1 / m) * 100` where `m1` and `m` are other test_keys in the same record.

---

## 1. Crude Sulphur (material: `SULPHUR_CRUDE`)
### Activity: Crude Sulphur QC (`rm_qc` at Factory A 20/1)

### 1.1 Receipt fields (stored in `rm_receipts`, not `qc_test_definitions`)
These are receipt/logistics fields, not test definitions:
- Batch Number → `batches.batch_number`
- Truck Number → `rm_receipts.vehicle_number`
- Quantity Received (MT) → `rm_receipts.quantity`
- Appearance / Physical State → `rm_receipts.appearance`
- Photo → `attachments` (entity_type: `rm_receipt`)

### 1.2 QC test fields

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `appearance` | Appearance / Physical State | — | text | false | — |
| 2 | `appearance_photo` | Photo | — | photo | false | — |
| **Purity** |||||
| 3 | `purity_m1` | Mass of CS₂-insoluble residue, M1 | g | number | false | — |
| 4 | `purity_m` | Mass of material taken for test, M | g | number | false | — |
| 5 | `purity_percent` | Purity | % | number | true | `((purity_m - purity_m1) / purity_m) * 100` |
| **Acidity** |||||
| 6 | `acidity_v1` | Titre with material, V1 | mL | number | false | — |
| 7 | `acidity_v2` | Titre with blank, V2 | mL | number | false | — |
| 8 | `acidity_n` | Normality of NaOH solution, N | N | number | false | — |
| 9 | `acidity_m` | Mass of sample taken, M | g | number | false | — |
| 10 | `acidity_percent` | Acidity (as H₂SO₄) | % | number | true | `((acidity_v1 - acidity_v2) * acidity_n * 0.049 / acidity_m) * 100` |
| **Moisture** |||||
| 11 | `moisture_m_before` | Mass before heating, M | g | number | false | — |
| 12 | `moisture_m1_after` | Mass after heating, M1 | g | number | false | — |
| 13 | `moisture_percent` | Moisture | % | number | true | `((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100` |
| **Ash** |||||
| 14 | `ash_m` | Mass of sample taken, M | g | number | false | — |
| 15 | `ash_m1` | Mass of residue obtained, M1 | g | number | false | — |
| 16 | `ash_percent` | Ash content | % | number | true | `(ash_m1 / ash_m) * 100` |

**Notes:**
- Purity formula: CS₂-insoluble residue method. Purity = ((M - M1) / M) × 100.
- Acidity formula: standard NaOH back-titration. Factor 0.049 = equivalent weight of H₂SO₄/1000. **Confirm this factor with the lab** before locking it in.
- `appearance` and `appearance_photo` are top-level fields, not inside a test group.

---

## 2. Sulphur Powder (material: `SULPHUR_POWDER`)
### Activities: Hourly Readings + Batch Analysis at Factory A 20/1

The form has two distinct Sulphur Powder sections:
- **Hourly readings** (during production run) — colour, machine, batch, quantity
- **Batch analysis** (end of batch) — purity, acidity, mesh, melting point, moisture, ash, oil content, specific gravity, bulk density

The form has a duplicate "Colour Appearance" column — this appears to be a form design artifact (the field appears twice in the raw headers). Only one is stored.

### 2.1 Hourly Reading fields (`hourly_readings.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `colour_appearance` | Colour & Appearance | — | text | false | — |
| 2 | `appearance_photo` | Photo of Sulphur Powder | — | photo | false | — |

**Note:** Machine (M1/M2), Batch Number, Quantity are stored as structured columns on `hourly_readings` / `batches`, not in `test_results` JSONB.

### 2.2 Batch Analysis fields (`batch_analysis.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `colour_appearance` | Colour & Appearance | — | text | false | — |
| 2 | `appearance_photo` | Photo of Sulphur Powder | — | photo | false | — |
| **Purity** |||||
| 3 | `purity_e` | Empty Crucible Weight, E | g | number | false | — |
| 4 | `purity_w1` | Mass of sample taken for test, W1 | g | number | false | — |
| 5 | `purity_w2` | Mass of Empty weight + Residue, W2 | g | number | false | — |
| 6 | `purity_percent` | Purity | % | number | true | `((purity_w1 - (purity_w2 - purity_e)) / purity_w1) * 100` |
| **Acidity** |||||
| 7 | `acidity_v1` | Titre with material, V1 | mL | number | false | — |
| 8 | `acidity_v2` | Titre with blank, V2 | mL | number | false | — |
| 9 | `acidity_n` | Normality of NaOH solution, N | N | number | false | — |
| 10 | `acidity_m` | Mass of sample taken, M | g | number | false | — |
| 11 | `acidity_percent` | Acidity (as H₂SO₄) | % | number | true | `((acidity_v1 - acidity_v2) * acidity_n * 0.049 / acidity_m) * 100` |
| **Mesh / Sieve** |||||
| 12 | `mesh100_m` | 100 Mesh: Sample taken, M | g | number | false | — |
| 13 | `mesh100_m_ret` | 100 Mesh: Coarse retained on sieve, m | g | number | false | — |
| 14 | `mesh100_percent_retained` | 100 Mesh: % retained | % | number | true | `(mesh100_m_ret / mesh100_m) * 100` |
| 15 | `mesh200_m` | 200 Mesh: Sample taken, M | g | number | false | — |
| 16 | `mesh200_m_ret` | 200 Mesh: Coarse retained on sieve, m | g | number | false | — |
| 17 | `mesh200_percent_retained` | 200 Mesh: % retained | % | number | true | `(mesh200_m_ret / mesh200_m) * 100` |
| 18 | `mesh325_m` | 325 Mesh: Sample taken, M | g | number | false | — |
| 19 | `mesh325_m_ret` | 325 Mesh: Coarse retained on sieve, m | g | number | false | — |
| 20 | `mesh325_percent_retained` | 325 Mesh: % retained | % | number | true | `(mesh325_m_ret / mesh325_m) * 100` |
| **Other** |||||
| 21 | `melting_point` | Melting Point | °C | number | false | — |
| **Moisture** |||||
| 22 | `moisture_m_before` | Mass before heating, M | g | number | false | — |
| 23 | `moisture_m1_after` | Mass after heating, M1 | g | number | false | — |
| 24 | `moisture_percent` | Moisture | % | number | true | `((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100` |
| **Ash** |||||
| 25 | `ash_m1` | Mass of residue obtained, M1 | g | number | false | — |
| 26 | `ash_m` | Mass of sample taken, M | g | number | false | — |
| 27 | `ash_percent` | Ash content | % | number | true | `(ash_m1 / ash_m) * 100` |
| **Oil Content** |||||
| 28 | `oil_mass_loss` | Oil content: Mass loss | g | number | false | — |
| 29 | `oil_original_mass` | Oil content: Original sample mass | g | number | false | — |
| 30 | `oil_percent` | Oil content | % | number | true | `(oil_mass_loss / oil_original_mass) * 100` |
| **Specific Gravity** |||||
| 31 | `sg_w1` | Weight of empty pycnometer, W1 | g | number | false | — |
| 32 | `sg_w2` | Weight of pycnometer with sample, W2 | g | number | false | — |
| 33 | `sg_w3` | Weight of pycnometer + sample + liquid, W3 | g | number | false | — |
| 34 | `sg_w4` | Weight of pycnometer + liquid, W4 | g | number | false | — |
| 35 | `sg_sl` | Specific gravity of liquid medium, SL | — | number | false | — |
| 36 | `sg_value` | Specific Gravity of Sulphur Powder | g/cm³ | number | true | `((sg_w2 - sg_w1) / ((sg_w2 - sg_w1) - (sg_w3 - sg_w4))) * sg_sl` |
| **Bulk Density** |||||
| 37 | `bd_mass` | Mass of sample, m | g | number | false | — |
| 38 | `bd_volume` | Volume after tapping, V | cc/mL | number | false | — |
| 39 | `bd_value` | Bulk Density | g/mL | number | true | `bd_mass / bd_volume` |

**Note on Specific Gravity formula:** Standard pycnometer method. **Confirm formula with the lab** — the exact form is `SG = (W2-W1) / [(W2-W1) - (W3-W4)] × SL`. If SL is water (= 1.0), it simplifies further.

---

## 3. Zinc Oxide (material: `ZINC_OXIDE`)
### Activity: Raw Material QC at Factory A 20

### 3.1 Receipt fields (stored in `rm_receipts`)
- Batch/Lot Number, Quantity Received, Appearance → `rm_receipts` structured columns

### 3.2 QC test fields (`rm_qc.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `coa_received` | Is COA received? | — | boolean | false | — |
| 2 | `appearance` | Appearance | — | text | false | — |
| 3 | `appearance_photo` | Product Photo | — | photo | false | — |
| **Purity (EDTA titration)** |||||
| 4 | `zn_mass_taken` | Mass of Material Taken | g | number | false | — |
| 5 | `zn_edta_normality` | Normality of EDTA solution | N | number | false | — |
| 6 | `zn_titre_with_cyanide` | Titre with cyanide, V1 | mL | number | false | — |
| 7 | `zn_titre_without_cyanide` | Titre without cyanide, V2 | mL | number | false | — |
| 8 | `zn_content_percent` | Zinc Oxide content | % | number | true | `((zn_titre_without_cyanide - zn_titre_with_cyanide) * zn_edta_normality * 4.069 / zn_mass_taken) * 100` |
| **Moisture** |||||
| 9 | `moisture_m_before` | Moisture: Mass before heating, M | g | number | false | — |
| 10 | `moisture_m1_after` | Moisture: Mass after heating, M1 | g | number | false | — |
| 11 | `moisture_percent` | Moisture | % | number | true | `((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100` |
| **Mesh / Sieve** |||||
| 12 | `mesh200_m` | 200 Mesh: Sample taken, M | g | number | false | — |
| 13 | `mesh200_m_ret` | 200 Mesh: Coarse retained, m | g | number | false | — |
| 14 | `mesh200_percent_retained` | 200 Mesh: % retained | % | number | true | `(mesh200_m_ret / mesh200_m) * 100` |
| 15 | `mesh325_m` | 325 Mesh: Sample taken, M | g | number | false | — |
| 16 | `mesh325_m_ret` | 325 Mesh: Coarse retained, m | g | number | false | — |
| 17 | `mesh325_percent_retained` | 325 Mesh: % retained | % | number | true | `(mesh325_m_ret / mesh325_m) * 100` |

**Note on ZnO content formula:** Factor 4.069 = molecular weight of ZnO (81.38) / 2 / 10. This is the standard EDTA complexometric method. **Confirm factor with the lab.**

---

## 4. Calcium Chloride (material: `CALCIUM_CHLORIDE`)
### Activity: Raw Material QC at Factory A 20

### 4.1 QC test fields (`rm_qc.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `coa_received` | Is COA received? | — | boolean | false | — |
| 2 | `appearance` | Color & Physical State | — | text | false | — |
| 3 | `appearance_photo` | Product Photo | — | photo | false | — |
| 4 | `ph_20pct` | pH (20% solution) | — | number | false | — |
| 5 | `solubility` | Solubility | — | text | false | — |
| **Calcium Content (EDTA titration)** |||||
| 6 | `ca_mass_taken` | Weight of sample, W | g | number | false | — |
| 7 | `ca_edta_normality` | Normality of EDTA solution | N | number | false | — |
| 8 | `ca_burette_reading` | Burette reading, B.R. | mL | number | false | — |
| 9 | `ca_content_percent` | Calcium content | % | number | true | `(ca_burette_reading * ca_edta_normality * 2.004 / ca_mass_taken) * 100` |

**Note on Ca content formula:** Factor 2.004 = atomic weight of Ca (40.08) / 2 / 10. Standard EDTA method. **Confirm factor with the lab.**

---

## 5. Tebuconazole (material: `TEBUCONAZOLE`)
### Activity: Raw Material QC at Factory A 20

### 5.1 QC test fields (`rm_qc.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `coa_received` | Is COA received? | — | boolean | false | — |
| 2 | `tebu_content` | Tebuconazole Content | % | number | false | — |
| **Moisture** |||||
| 3 | `moisture_m_before` | Moisture: Mass before heating, M | g | number | false | — |
| 4 | `moisture_m1_after` | Moisture: Mass after heating, M1 | g | number | false | — |
| 5 | `moisture_percent` | Moisture | % | number | true | `((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100` |
| **Mesh / Sieve** |||||
| 6 | `mesh200_m` | 200 Mesh: Sample taken, M | g | number | false | — |
| 7 | `mesh200_m_ret` | 200 Mesh: Coarse retained, m | g | number | false | — |
| 8 | `mesh200_percent_retained` | 200 Mesh: % retained | % | number | true | `(mesh200_m_ret / mesh200_m) * 100` |
| 9 | `mesh325_m` | 325 Mesh: Sample taken, M | g | number | false | — |
| 10 | `mesh325_m_ret` | 325 Mesh: Coarse retained, m | g | number | false | — |
| 11 | `mesh325_percent_retained` | 325 Mesh: % retained | % | number | true | `(mesh325_m_ret / mesh325_m) * 100` |

**Note:** `tebu_content` is a direct read from the COA or GC analysis — entered by the chemist, not derived from titration inputs. This matches how the form captures it (single field, no component inputs).

---

## 6. Boric Powder (material: `BORIC_POWDER`)
### Activity: Raw Material QC at Factory A 20

### 6.1 QC test fields (`rm_qc.test_results`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `coa_received` | Is COA received? | — | boolean | false | — |
| 2 | `appearance` | Appearance | — | text | false | — |
| 3 | `boron_content` | Boron Content | % | number | false | — |
| **Moisture** |||||
| 4 | `moisture_m_before` | Moisture: Mass before heating, M | g | number | false | — |
| 5 | `moisture_m1_after` | Moisture: Mass after heating, M1 (note: form header says "M" not "M1" — likely a typo) | g | number | false | — |
| 6 | `moisture_percent` | Moisture | % | number | true | `((moisture_m_before - moisture_m1_after) / moisture_m_before) * 100` |
| **Mesh / Sieve** |||||
| 7 | `mesh200_m` | 200 Mesh: Sample taken, M | g | number | false | — |
| 8 | `mesh200_m_ret` | 200 Mesh: Coarse retained, m | g | number | false | — |
| 9 | `mesh200_percent_retained` | 200 Mesh: % retained | % | number | true | `(mesh200_m_ret / mesh200_m) * 100` |

**Note:** `boron_content` is a direct entry (from COA or titration result) — no component inputs recorded in the form. Confirm whether a titration breakdown needs to be added.

---

## 7. Sulphur SC (product: `SULPHUR_SC`)
### Activity: Product QC at Factory A 20 — Phase-aware (Phase A and Phase B)

Phase A = slurry/wet stage. Phase B = final product + physical tests.  
One `product_qc` row per phase per batch (`UNIQUE (batch_id, product_id, phase)`).

### 7.1 Phase A fields (`product_qc.test_results` where `phase = 'A'`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `slurry_weight_kg` | Quantity of Phase A / Slurry Weight | kg | number | false | — |
| **Sulphur Content (iodometric titration)** |||||
| 2 | `pa_mass_taken` | Phase A: Mass of sample taken, m | g | number | false | — |
| 3 | `pa_titration_volume` | Phase A: Titration Volume, v | mL | number | false | — |
| 4 | `pa_iodine_normality` | Phase A: Normality of iodine, N | N | number | false | — |
| 5 | `pa_desired_sulphur` | Desired Sulphur Content | % | number | false | — |
| 6 | `pa_sulphur_content` | Phase A: Sulphur Content | % | number | true | `(pa_titration_volume * pa_iodine_normality * 1.603 / pa_mass_taken) * 100` |

### 7.2 Phase B fields (`product_qc.test_results` where `phase = 'B'`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `pb_slurry_weight_kg` | Phase B: Quantity / Slurry Weight | kg | number | false | — |
| **Sulphur Content** |||||
| 2 | `pb_mass_taken` | Phase B: Mass of sample taken, m | g | number | false | — |
| 3 | `pb_titration_volume` | Phase B: Titration Volume, v | mL | number | false | — |
| 4 | `pb_iodine_normality` | Phase B: Normality of iodine solution, N | N | number | false | — |
| 5 | `pb_sulphur_content` | Phase B: Sulphur Content | % | number | true | `(pb_titration_volume * pb_iodine_normality * 1.603 / pb_mass_taken) * 100` |
| **Suspensibility** |||||
| 6 | `pb_suspension_mass` | Phase B: Weight of suspension sample, M | g | number | false | — |
| 7 | `pb_titre_sediment` | Phase B: Titre with sediment aliquot, v2 | mL | number | false | — |
| 8 | `pb_suspensibility` | Phase B: Suspensibility | % | number | true | `(1 - (pb_titre_sediment / pb_titration_volume)) * 100` |
| **Physical Tests** |||||
| 9 | `viscosity_sec` | Viscosity | seconds | number | false | — |
| 10 | `density` | Density | g/cm³ | number | false | — |
| **Wet Sieve** |||||
| 11 | `wet200_sample_wt` | Wet Sieve 200 mesh: Sample weight | g | number | false | — |
| 12 | `wet200_residue_wt` | Wet Sieve 200 mesh: Residue weight | g | number | false | — |
| 13 | `wet200_percent_retained` | Wet Sieve 200 mesh: % retained | % | number | true | `(wet200_residue_wt / wet200_sample_wt) * 100` |
| 14 | `wet325_sample_wt` | Wet Sieve 325 mesh: Sample weight | g | number | false | — |
| 15 | `wet325_residue_wt` | Wet Sieve 325 mesh: Residue weight | g | number | false | — |
| 16 | `wet325_percent_retained` | Wet Sieve 325 mesh: % retained | % | number | true | `(wet325_residue_wt / wet325_sample_wt) * 100` |
| **Observation** |||||
| 17 | `colour_physical_state` | Color & Physical State | — | text | false | — |
| 18 | `observations` | Important Observations (sediments, rejections) | — | text | false | — |
| 19 | `product_photo` | Product Photo | — | photo | false | — |

**Note on Sulphur content formula:** Factor 1.603 = atomic weight of S (32.06) / 2 / 10. Standard iodometric method. **Confirm factor with the lab.**  
**Note on Suspensibility:** Formula assumes sediment aliquot is comparable in volume to the main titration volume. **Confirm suspensibility calculation method with the lab** — the raw form captures `v2` but the exact formula may differ.

---

## 8. Zinc SC (product: `ZINC_SC`)
### Activity: Product QC at Factory A 20 — Phase-aware (Phase A and Phase B)

The form structure mirrors Sulphur SC: Phase A = preparation stage, Phase B = final product with full physical tests.

### 8.1 Phase A fields (`product_qc.test_results` where `phase = 'A'`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `pa_slurry_weight_kg` | Quantity / Slurry Weight of Phase A | kg | number | false | — |
| **Zinc Content (EDTA titration)** |||||
| 2 | `pa_edta_normality` | Phase A: Normality of EDTA solution | N | number | false | — |
| 3 | `pa_titre_with_cyanide` | Phase A: V1 — Titre with cyanide | mL | number | false | — |
| 4 | `pa_titre_without_cyanide` | Phase A: V2 — Titre without cyanide | mL | number | false | — |
| 5 | `pa_zinc_content` | Phase A: Zinc content | % | number | true | `((pa_titre_without_cyanide - pa_titre_with_cyanide) * pa_edta_normality * 3.269 / 1) * 100` |
| 6 | `pa_appearance` | Phase A: Appearance | — | text | false | — |

**Note:** `pa_zinc_content` formula needs the mass of sample taken — the form does not capture a separate mass field for Phase A. The formula above uses a placeholder. **Confirm with the lab whether mass is assumed constant or needs to be entered.**

### 8.2 Phase B fields (`product_qc.test_results` where `phase = 'B'`)

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `pb_slurry_weight_kg` | Phase B: Quantity / Slurry Weight | kg | number | false | — |
| **Zinc Content** |||||
| 2 | `pb_edta_normality` | Phase B: Normality of EDTA solution | N | number | false | — |
| 3 | `pb_titre_with_cyanide` | Phase B: Titre with cyanide | mL | number | false | — |
| 4 | `pb_titre_without_cyanide` | Phase B: Titre without cyanide | mL | number | false | — |
| 5 | `pb_appearance` | Phase B: Appearance | — | text | false | — |
| **Final Zinc Content + Suspensibility** |||||
| 6 | `zn_edta_normality` | Normality of EDTA solution (final) | N | number | false | — |
| 7 | `zn_mass_taken` | Mass of sample taken | g | number | false | — |
| 8 | `zn_v1_titre_with_cyanide` | Zinc content: V1 — Titre with cyanide | mL | number | false | — |
| 9 | `zn_v2_titre_without_cyanide` | Zinc content: V2 — Titre without cyanide | mL | number | false | — |
| 10 | `zn_content_percent` | Zinc content | % | number | true | `((zn_v2_titre_without_cyanide - zn_v1_titre_with_cyanide) * zn_edta_normality * 3.269 / zn_mass_taken) * 100` |
| **Suspensibility** |||||
| 11 | `susp_mass_taken` | Suspension: Mass of sample taken | g | number | false | — |
| 12 | `susp_v1_sed` | Suspension: V1_sed — Titre with cyanide (sediment) | mL | number | false | — |
| 13 | `susp_v2_sed` | Suspension: V2_sed — Titre without cyanide (sediment) | mL | number | false | — |
| 14 | `suspensibility` | Suspensibility | % | number | true | `(1 - ((susp_v2_sed - susp_v1_sed) / (zn_v2_titre_without_cyanide - zn_v1_titre_with_cyanide))) * 100` |
| **Physical Tests** |||||
| 15 | `viscosity_sec` | Viscosity | seconds | number | false | — |
| 16 | `ph_direct` | pH (Direct solution) | — | number | false | — |
| 17 | `density` | Density | g/cm³ | number | false | — |
| **Wet Sieve** |||||
| 18 | `wet200_sample_wt` | Wet Sieve 200 mesh: Sample weight | g | number | false | — |
| 19 | `wet200_residue_wt` | Wet Sieve 200 mesh: Residue weight | g | number | false | — |
| 20 | `wet200_percent_retained` | Wet Sieve 200 mesh: % retained | % | number | true | `(wet200_residue_wt / wet200_sample_wt) * 100` |
| 21 | `wet325_sample_wt` | Wet Sieve 325 mesh: Sample weight | g | number | false | — |
| 22 | `wet325_residue_wt` | Wet Sieve 325 mesh: Residue weight | g | number | false | — |
| 23 | `wet325_percent_retained` | Wet Sieve 325 mesh: % retained | % | number | true | `(wet325_residue_wt / wet325_sample_wt) * 100` |
| **Observation** |||||
| 24 | `colour_physical_state` | Color & Physical State | — | text | false | — |
| 25 | `observations` | Important Observations (visible sediments?) | — | text | false | — |
| 26 | `product_photo` | Product Photo | — | photo | false | — |

**Note on ZnO content formula:** Factor 3.269 = molecular weight of ZnO (81.38) / (EDTA valence) / 10 × correction. **Confirm factor and suspensibility formula with the lab.**

---

## 9. Liquid Boron (product: `LIQUID_BORON`)
### Activity: Product QC at Factory A 20 — Single phase

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `sample_taken_by` | Sample Taken By | — | text | false | — |
| 2 | `lot_quantity_kg` | Lot/Batch Quantity | kg | number | false | — |
| **Boron Content** |||||
| 3 | `boron_mass_taken` | Weight of material taken for test, W | g | number | false | — |
| 4 | `boron_naoh_normality` | Normality of NaOH, N | N | number | false | — |
| 5 | `boron_naoh_v1` | Volume of NaOH starting, V1 | mL | number | false | — |
| 6 | `boron_naoh_v2` | Volume of NaOH ending, V2 | mL | number | false | — |
| 7 | `boron_content_percent` | Boron Content | % | number | true | `((boron_naoh_v2 - boron_naoh_v1) * boron_naoh_normality * 1.082 / boron_mass_taken) * 100` |
| **Physical Tests** |||||
| 8 | `colour_physical_state` | Color & Physical State | — | text | false | — |
| 9 | `observations` | Important Observations (sediments, clarity) | — | text | false | — |
| 10 | `density` | Density | g/cm³ | number | false | — |
| 11 | `ph_5pct` | pH (5% solution) | — | number | false | — |
| 12 | `viscosity` | Viscosity | — | number | false | — |
| 13 | `product_photo` | Product Photo | — | photo | false | — |

**Note on Boron content formula:** Factor 1.082 = atomic weight of B (10.82) / 10. Standard NaOH titration method. **Confirm factor with the lab.**

---

## 10. Ziddi (product: `ZIDDI`)
### Activity: Product QC at Factory A 20 — Single phase

The form captures two parallel measurements for Sulphur content and Suspensibility, plus GC values for Tebuconazole.

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `colour_physical_state` | Color & Physical State | — | text | false | — |
| 2 | `observations` | Important Observations (sediments, clarity) | — | text | false | — |
| 3 | `product_photo` | Product Photo | — | photo | false | — |
| **Sulphur Content (iodometric)** |||||
| 4 | `content_mass_taken` | Content: Weight of material taken, W | g | number | false | — |
| 5 | `content_iodine_volume` | Content: Volume of Iodine | mL | number | false | — |
| 6 | `content_iodine_normality` | Content: Normality of Iodine | N | number | false | — |
| 7 | `sulphur_content_percent` | Sulphur Content | % | number | true | `(content_iodine_volume * content_iodine_normality * 1.603 / content_mass_taken) * 100` |
| **Suspensibility (iodometric)** |||||
| 8 | `susp_mass_taken` | Suspensibility: Weight of material taken, W | g | number | false | — |
| 9 | `susp_iodine_volume` | Suspensibility: Volume of Iodine | mL | number | false | — |
| 10 | `susp_iodine_normality` | Suspensibility: Normality of Iodine | N | number | false | — |
| 11 | `suspensibility_percent` | Suspensibility | % | number | true | `(1 - ((susp_iodine_volume * susp_iodine_normality) / (content_iodine_volume * content_iodine_normality))) * 100` |
| **GC Results (entered directly)** |||||
| 12 | `tebu_content_gc` | Tebuconazole Content (by GC) | % | number | false | — |
| 13 | `tebu_suspensibility_gc` | Tebuconazole Suspensibility (by GC) | % | number | false | — |

**Note on Suspensibility formula:** Suspensibility = 1 − (sediment titration / total titration). The formula above is an approximation based on the form structure. **Confirm the exact suspensibility formula with the lab.**

---

## 11. Liquid Calcium (product: `LIQUID_CALCIUM`)
### Activity: Product QC at Factory A 20 — Single phase

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `lot_quantity_kg` | Quantity | kg | number | false | — |
| **Calcium Content (EDTA)** |||||
| 2 | `ca_mass_taken` | Weight of sample, W | g | number | false | — |
| 3 | `ca_edta_normality` | Normality of EDTA solution | N | number | false | — |
| 4 | `ca_burette_reading` | Burette reading, B.R. | mL | number | false | — |
| 5 | `ca_content_percent` | Calcium content | % | number | true | `(ca_burette_reading * ca_edta_normality * 2.004 / ca_mass_taken) * 100` |
| **Physical Tests** |||||
| 6 | `colour_physical_state` | Color & Physical State | — | text | false | — |
| 7 | `observations` | Important Observations (sediments, clarity) | — | text | false | — |
| 8 | `density` | Density | g/cm³ | number | false | — |
| 9 | `ph_5pct` | pH (5% solution) | — | number | false | — |
| 10 | `product_photo` | Product Photo | — | photo | false | — |

---

## 12. Post Production / Stability Tests
### Activity: Post Production at Factory A 20 — Workflow TBD

The form captures these fields under "Select Product Being Retested":

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `product_being_retested` | Product Being Retested | — | select | false | — |
| 2 | `tracking_type` | Tracking Type (Stability / Retest) | — | text | false | — |
| 3 | `parameters_checked` | Stability Test Parameters Checked | — | text | false | — |
| 4 | `stability_result` | Stability Test Result | — | text | false | — |
| 5 | `stability_reading_date` | Date of Stability Reading | — | date | false | — |

These will be stored in `post_production_tests.test_results`. Full schema to be finalized once workflow is confirmed.

---

## 13. Lab Trials
### Activity: Lab Trials at Factory A 20

| sort | test_key | label | unit | input_type | is_calculated | formula |
|---|---|---|---|---|---|---|
| 1 | `product_name` | Product Name | — | text | false | — |
| 2 | `trial_number` | Trial Number | — | text | false | — |
| 3 | `quantity` | Quantity of Trial | — | text | false | — |
| 4 | `appearance` | Appearance | — | text | false | — |
| 5 | `density` | Density | g/cm³ | number | false | — |
| 6 | `ph_neat` | pH (neat) | — | number | false | — |
| 7 | `ph_5pct` | pH (5%) | — | number | false | — |
| 8 | `suspensibility` | Suspensibility | % | number | false | — |
| 9 | `remarks_if_failed` | Remarks (if failed) | — | text | false | — |
| 10 | `product_photo` | Product Photo | — | photo | false | — |
| 11 | `job_card_photo` | Job Card Photo | — | photo | false | — |

---

## 14. Summary — field counts per material/product

| Material / Product | Entered fields | Calculated fields | Total |
|---|---|---|---|
| Crude Sulphur (rm_qc) | 12 | 4 | 16 |
| Sulphur Powder — Hourly Reading | 2 | 0 | 2 |
| Sulphur Powder — Batch Analysis | 28 | 11 | 39 |
| Zinc Oxide (rm_qc) | 12 | 5 | 17 |
| Calcium Chloride (rm_qc) | 7 | 1 | 8 |
| Tebuconazole (rm_qc) | 8 | 3 | 11 |
| Boric Powder (rm_qc) | 7 | 2 | 9 |
| Sulphur SC — Phase A | 5 | 1 | 6 |
| Sulphur SC — Phase B | 14 | 5 | 19 |
| Zinc SC — Phase A | 5 | 1 | 6 |
| Zinc SC — Phase B | 20 | 6 | 26 |
| Liquid Boron | 10 | 1 | 11 |
| Ziddi | 10 | 2 | 12 |
| Liquid Calcium | 8 | 1 | 9 |
| Post Production | 5 | 0 | 5 |
| Lab Trials | 11 | 0 | 11 |

---

## 15. Formula confirmation checklist (before SQL migration is written)

These formulas are derived from standard analytical chemistry methods but **must be confirmed by the lab chemist before they are locked into Postgres functions**:

| # | Formula | Confirmation needed |
|---|---|---|
| 1 | Crude Sulphur purity: `((M - M1) / M) × 100` | Confirm CS₂-insoluble method |
| 2 | Acidity (all materials): NaOH titration factor 0.049 | Confirm equivalence factor |
| 3 | Sulphur Powder specific gravity: pycnometer method | Confirm formula, confirm SL value |
| 4 | Zinc Oxide content: EDTA factor 4.069 | Confirm equivalence factor |
| 5 | Calcium Chloride / Liquid Calcium: EDTA factor 2.004 | Confirm equivalence factor |
| 6 | Sulphur SC / Ziddi sulphur content: iodometric factor 1.603 | Confirm equivalence factor |
| 7 | Liquid Boron content: NaOH factor 1.082 | Confirm equivalence factor |
| 8 | Zinc SC content: EDTA factor 3.269 | Confirm factor + mass input for Phase A |
| 9 | Suspensibility for Sulphur SC, Zinc SC, Ziddi | Confirm exact formula used |

---

*This document feeds directly into the `qc_test_definitions` INSERT statements in the SQL migration file.  
Once the formula checklist (§15) is confirmed by the lab, the migration SQL can be finalized.*
