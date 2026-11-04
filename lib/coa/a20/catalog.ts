// =============================================================================
// A-20 COA catalog - one template per A-20 product, taken from the issued
// Certificates of Analysis (Zinc 39.15% SC, Sulphur 55.16% SC, Concentrated
// liquid calcium 11%, Boron Ethanolamine, Tebuconazole 10% + Sulphur 65% WDG).
//
// A row is either
//   - QC-sourced  (testKey set): the actual is read from the saved Product QC
//     record and is NOT editable on the COA, or
//   - manual      (no testKey)  : parameters the Product QC form does not
//     measure (persistent foam, heavy metals, ...). The chemist types them.
//   - appearance  (appearance: true): prefilled from the QC "Color & Physical
//     State" text, editable (the certificates read "White liquid", "Complies").
//
// Spec limits come from product_qc_specs (admin-maintained) when a row exists
// for the testKey; otherwise the fallback `spec` below is used.
// =============================================================================

export type A20SpecStyle = "single" | "minmax" | "suffix";
export type A20DocStyle = "certificate" | "report";

export interface A20RowDef {
  key: string;
  label: string;
  unit: string;
  /** product_qc.test_results key. Absent = manual (or appearance) row. */
  testKey?: string;
  appearance?: boolean;
  /** Decimals used when printing a QC-sourced actual. */
  decimals?: number;
  /** Fallback / manual-row spec. */
  spec?: { min?: number | null; max?: number | null };
  /** Printed in the spec column instead of numbers (e.g. "Brownish granules"). */
  specText?: string;
  /** Row is skipped entirely when the chemist leaves it blank. */
  optional?: boolean;
}

export interface A20ProductTemplate {
  productCode: string;
  /** product_qc.phase holding the final-product result. */
  phase: "A" | "B" | "none";
  /** Product name printed on the certificate (editable on the form). */
  coaTitle: string;
  docStyle: A20DocStyle;
  specStyle: A20SpecStyle;
  showExpiry: boolean;
  qtyLabel: string;
  rows: A20RowDef[];
}

const HEAVY = (pb: number, as: number, cd: number): A20RowDef[] => [
  { key: "lead", label: "Lead (as pb) percent by weight maximum", unit: "%", spec: { max: pb }, optional: true },
  { key: "arsenic", label: "Arsenic (as As) percent by weight maximum", unit: "%", spec: { max: as }, optional: true },
  { key: "cadmium", label: "Cadmium (as cd) percent by weight maximum", unit: "%", spec: { max: cd }, optional: true },
];

export const A20_COA_TEMPLATES: A20ProductTemplate[] = [
  {
    productCode: "ZINC_SC",
    phase: "B",
    coaTitle: "Zinc oxide 39.15 % SC",
    docStyle: "certificate",
    specStyle: "single",
    showExpiry: false,
    qtyLabel: "Quantity (Litres)",
    rows: [
      { key: "appearance", label: "Appearance", unit: "-", appearance: true },
      { key: "zinc", label: "Zinc content", unit: "%", testKey: "zinc_content", decimals: 2, spec: { min: 39.5 } },
      { key: "susp", label: "Suspensibility", unit: "%", testKey: "suspension", decimals: 2, spec: { min: 85 } },
      { key: "ph", label: "PH", unit: "-", testKey: "ph_direct", decimals: 2, spec: { min: 8, max: 10 } },
      { key: "sieve", label: "Wet sieve test (74 micron /200 mesh)", unit: "%", testKey: "wet_sieve200_result", decimals: 2, spec: { min: 99 } },
      { key: "foam", label: "Persistent foam (after 1 min)", unit: "ml", spec: { max: 60 } },
      { key: "sg", label: "Specific gravity (at 15°C)", unit: "-", testKey: "density", decimals: 2, spec: { min: 1.71, max: 1.75 } },
      ...HEAVY(0.003, 0.001, 0.0025),
    ],
  },
  {
    productCode: "SULPHUR_SC",
    phase: "B",
    coaTitle: "Sulphur 55.16%sc(800g/L)",
    docStyle: "certificate",
    specStyle: "single",
    showExpiry: true,
    qtyLabel: "Quantity (Litres)",
    rows: [
      { key: "appearance", label: "Appearance", unit: "-", appearance: true, specText: "Yellowish colour" },
      { key: "sulphur", label: "Sulphur content (purity min99.5%)", unit: "%", testKey: "sulphur_content", decimals: 2, spec: { min: 55.16 } },
      { key: "sulphur_gl", label: "Sulphur content (purity min99.5%)", unit: "g/L", spec: { min: 800 } },
      { key: "susp", label: "Suspensibility", unit: "%", testKey: "suspensibility", decimals: 2, spec: { min: 85 } },
      { key: "pour", label: "Pourability (Residue)", unit: "%", spec: { max: 6 } },
      { key: "spont", label: "Spontaneity of dispersion", unit: "%", spec: { min: 85 } },
      { key: "ph", label: "PH", unit: "-", testKey: "ph_direct", decimals: 2, spec: { min: 5, max: 8 } },
      { key: "sieve", label: "Wet sieve test (74 microns /200mesh)", unit: "%", testKey: "wet_sieve200_result", decimals: 2, spec: { min: 99 } },
      { key: "foam", label: "Persistent foam (after 1 min.)", unit: "ml", spec: { max: 60 } },
      { key: "density", label: "Density", unit: "-", testKey: "density", decimals: 4, spec: { min: 1.4, max: 1.6 } },
    ],
  },
  {
    productCode: "LIQUID_CALCIUM",
    phase: "none",
    coaTitle: "Concentrated liquid calcium 11 %",
    docStyle: "certificate",
    specStyle: "minmax",
    showExpiry: false,
    qtyLabel: "Quantity (Litres)",
    rows: [
      { key: "appearance", label: "Appearance", unit: "-", appearance: true },
      { key: "calcium", label: "Calcium (as ca), percent by weight minimum", unit: "%", testKey: "calcium_content", decimals: 2, spec: { min: 11 } },
      { key: "ph", label: "PH", unit: "-", testKey: "ph_5pct", decimals: 2, spec: { min: 8.5, max: 10.5 } },
      { key: "sg", label: "Specific gravity", unit: "Kg/l", testKey: "density", decimals: 2, spec: { min: 1.3, max: 1.4 } },
    ],
  },
  {
    productCode: "LIQUID_BORON",
    phase: "none",
    coaTitle: "BORON ETHANOLAMINE",
    docStyle: "certificate",
    specStyle: "minmax",
    showExpiry: false,
    qtyLabel: "Quantity (Liters)",
    rows: [
      { key: "appearance", label: "Appearance", unit: "-", appearance: true },
      { key: "boron", label: "Boron (as B), percent by weight minimum", unit: "%", testKey: "boron_content", decimals: 2, spec: { min: 10 } },
      { key: "ph", label: "PH", unit: "-", testKey: "ph_5pct", decimals: 2, spec: { min: 7.5, max: 9.5 } },
      { key: "sg", label: "Specific gravity", unit: "-", testKey: "density", decimals: 2, spec: { min: 1.3, max: 1.4 } },
      { key: "lead", label: "Lead (as p b) percent by weight maximum", unit: "%", spec: { max: 0.003 }, optional: true },
      { key: "arsenic", label: "Arsenic (as AS) percent by weight maximum", unit: "%", spec: { max: 0.01 }, optional: true },
      { key: "cadmium", label: "Cadmium (as cd) percent by weight maximum", unit: "%", spec: { max: 0.0025 }, optional: true },
    ],
  },
  {
    productCode: "ZIDDI",
    phase: "none",
    coaTitle: "TEBUCONAZOLE 10 % + SULPHUR 65 % WDG",
    docStyle: "report",
    specStyle: "suffix",
    showExpiry: true,
    qtyLabel: "Quantity",
    rows: [
      { key: "appearance", label: "Physical Appearance", unit: "-", appearance: true, specText: "Brownish granules" },
      { key: "sulphur", label: "Sulphur content (%w/w)", unit: "%w/w", testKey: "sulphur_content", decimals: 2, spec: { min: 65 } },
      { key: "tebu", label: "Tebuconazole content (%w/w)", unit: "%w/w", testKey: "gc_tebu_content", decimals: 2, spec: { min: 10 } },
      { key: "susp", label: "Suspensibility (%w/w)", unit: "%w/w", testKey: "sulphur_suspensibility", decimals: 2, spec: { min: 80 } },
      { key: "sieve", label: "Wet sieve test (%w/w) (200 mesh) Dry", unit: "%w/w", testKey: "wet_sieve200_result", decimals: 2, spec: { min: 99.5 } },
      { key: "disp", label: "Dispersibility", unit: "sec", spec: { max: 60 } },
    ],
  },
];

export function getA20Template(productCode: string): A20ProductTemplate | undefined {
  return A20_COA_TEMPLATES.find((t) => t.productCode === productCode);
}

/** Shelf life in years printed as Date of Expiry (mfg + 2 years - 1 day). */
export const A20_EXPIRY_YEARS = 2;

/** Letterhead - same company block as the issued A-20 certificates. */
export const A20_LETTERHEAD = {
  companyName: "JAISHIL SULPHUR & CHEMICAL INDUSTRIES",
  tagline: "MANUFACTURER'S OF SULPHUR POWDER:",
  office: [
    "Office: 202/203, Pratik Industrial Estate, 2nd fl.,",
    "Bhandup - Goregaon Link Rd., Near Fortis Hospital,",
    "Bhandup, Mumbai - 400078.",
    "Phone: 61407900  FAX: 61407979",
    "E-Mail: jaishil@vsnl.net/jaishila20@gmail.com.",
  ],
  factory: [
    "Factory: Plot NO. A/20/1, PHASE 1, M.I.D.C.,",
    "Dombivli (East) 421203, Dist. Thane.",
    "Phone: 2471391/6454979",
  ],
} as const;
