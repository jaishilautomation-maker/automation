"use client";

// =============================================================================
// QcFieldRenderer — renders a single qc_test_definitions field as a form input.
//
// Used by all Lab QC form pages (rm-qc, hourly-reading, batch-analysis,
// product-qc, post-production, lab-trials) so the rendering logic is
// defined exactly once.
//
// Calculated fields are displayed with a green background (read-only).
// Photo fields show a placeholder until Supabase Storage upload is wired up.
// =============================================================================

import type { QcTestDefinition } from "@/lib/types";

interface Props {
  def: QcTestDefinition;
  value: string;
  onChange: (key: string, val: string) => void;
}

export default function QcFieldRenderer({ def, value, onChange }: Props) {
  const labelEl = (
    <label>
      {def.label}
      {def.unit && (
        <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}> ({def.unit})</span>
      )}
      {def.is_calculated && (
        <span style={{ color: "var(--ok)", fontWeight: 400 }}> — auto</span>
      )}
    </label>
  );

  // ── Photo ─────────────────────────────────────────────────────────────────
  if (def.input_type === "photo") {
    return (
      <div>
        {labelEl}
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: 8,
            padding: "12px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--ink-soft)",
          }}
        >
          📷 Photo upload — coming soon
        </div>
      </div>
    );
  }

  // ── Boolean ───────────────────────────────────────────────────────────────
  if (def.input_type === "boolean") {
    return (
      <div>
        {labelEl}
        <select value={value} onChange={e => onChange(def.test_key, e.target.value)}>
          <option value="">— Select —</option>
          <option value="true">Yes / Pass</option>
          <option value="false">No / Fail</option>
        </select>
      </div>
    );
  }

  // ── Select ────────────────────────────────────────────────────────────────
  if (def.input_type === "select" && def.options) {
    return (
      <div>
        {labelEl}
        <select value={value} onChange={e => onChange(def.test_key, e.target.value)}>
          <option value="">— Select —</option>
          {def.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  if (def.input_type === "date") {
    return (
      <div>
        {labelEl}
        <input
          type="date"
          value={value}
          onChange={e => onChange(def.test_key, e.target.value)}
        />
      </div>
    );
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  if (def.input_type === "text") {
    return (
      <div>
        {labelEl}
        <input
          type="text"
          value={value}
          placeholder={def.label}
          onChange={e => onChange(def.test_key, e.target.value)}
        />
      </div>
    );
  }

  // ── Number (default, includes calculated) ─────────────────────────────────
  return (
    <div>
      {labelEl}
      <input
        type="number"
        step="any"
        value={value}
        placeholder={def.is_calculated ? "auto" : "0"}
        disabled={def.is_calculated}
        onChange={e => onChange(def.test_key, e.target.value)}
        style={
          def.is_calculated
            ? { background: "var(--ok-soft)", color: "var(--ok)" }
            : undefined
        }
      />
    </div>
  );
}
