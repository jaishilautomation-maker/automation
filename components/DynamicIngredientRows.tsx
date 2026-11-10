"use client";

// =============================================================================
// DynamicIngredientRows
//
// A self-contained sub-table rendered below any formula ingredient table in the
// six A-20 production job-card forms.  It lets operators:
//   • Add a new component row (any name, instructed qty, added qty, RM batch,
//     drum/bag)
//   • Remove any dynamic row (with confirmation if the row has entered data)
//
// Rows added here are stored as JSON in production_job_cards.extra_ingredient_rows
// (migration 030) — they never touch production_job_card_items because that table
// requires a NOT NULL FK to product_formula_items.
//
// Props:
//   rows          — current array of ExtraRow for this phase
//   onChange      — called whenever the array changes (add / edit / remove)
//   phase         — phase key used to identify which rows belong to this table
//                   (e.g. "A", "B", "A_843", "B_600").  Only rows whose phase
//                   matches are rendered here; onChange receives the full array
//                   replacement for that phase key.
//   accent        — accent hex color (#b5451b etc.) from the parent form
//   lang          — "en" | "hi" for label language
//   disabled      — when true the table is read-only (e.g. submitted card)
// =============================================================================

import { useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtraRow {
  /** Client-generated uuid — used as React key; never goes to product_formula_items */
  id: string;
  /** Phase key matching the parent form's phase key ("A", "B", "A_843", etc.) */
  phase: string;
  componentName: string;
  instructedQty: string;
  addedQty: string;
  rmBatchNo: string;
  drumBagNo: string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function newRow(phase: string): ExtraRow {
  return {
    id:            crypto.randomUUID(),
    phase,
    componentName: "",
    instructedQty: "",
    addedQty:      "",
    rmBatchNo:     "",
    drumBagNo:     "",
  };
}

function hasData(row: ExtraRow): boolean {
  return [row.componentName, row.instructedQty, row.addedQty, row.rmBatchNo, row.drumBagNo]
    .some(v => v.trim() !== "");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  rows:     ExtraRow[];
  onChange: (rows: ExtraRow[]) => void;
  phase:    string;
  accent:   string;
  lang:     "en" | "hi";
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DynamicIngredientRows({
  rows, onChange, phase, accent, lang, disabled = false,
}: Props) {

  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  function update(id: string, field: keyof Omit<ExtraRow, "id" | "phase">, val: string) {
    onChange(rows.map(r => r.id === id ? { ...r, [field]: val } : r));
  }

  function addRow() {
    onChange([...rows, newRow(phase)]);
  }

  function requestRemove(id: string) {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    if (hasData(row)) {
      // Ask for confirmation before removing a row with data
      setPendingRemoveId(id);
    } else {
      // Empty row — remove immediately
      onChange(rows.filter(r => r.id !== id));
    }
  }

  function confirmRemove() {
    onChange(rows.filter(r => r.id !== pendingRemoveId));
    setPendingRemoveId(null);
  }

  function cancelRemove() {
    setPendingRemoveId(null);
  }

  // ── Labels ─────────────────────────────────────────────────────────────────
  const L = {
    addComponent:  lang === "hi" ? "+ घटक जोड़ें"          : "+ Add Component",
    componentCol:  lang === "hi" ? "घटक"                   : "Component",
    instructedCol: lang === "hi" ? "निर्देशित (kg)"         : "Instructed (kg)",
    addedCol:      lang === "hi" ? "डाला गया (kg)"          : "Added (kg)",
    rmBatchCol:    lang === "hi" ? "RM बैच नंबर"            : "RM Batch No",
    drumBagCol:    lang === "hi" ? "ड्रम / बैग नंबर"       : "Drum / Bag No",
    removeTitle:   lang === "hi" ? "हटाएं"                  : "Remove row",
    componentPh:   lang === "hi" ? "मटेरियल कोड / नाम"     : "Material code / name",
    confirmMsg:    lang === "hi"
      ? "इस घटक में डेटा दर्ज है। क्या आप इसे हटाना चाहते हैं?"
      : "This component has entered data. Remove it?",
    confirmYes:    lang === "hi" ? "हाँ, हटाएं"             : "Yes, remove",
    confirmNo:     lang === "hi" ? "रद्द करें"              : "Cancel",
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontWeight: 600,
    color: "var(--ink-soft)", whiteSpace: "nowrap",
    background: accent + "08",
    borderBottom: `1px solid ${accent}30`,
  };
  const tdStyle: React.CSSProperties = { padding: "4px 6px", verticalAlign: "middle" };

  const inputStyle: React.CSSProperties = {
    fontSize: 13, padding: "4px 8px", borderRadius: 6,
    border: "1px solid var(--line, #ddd)", width: "100%",
    background: disabled ? "var(--surface)" : "#fff",
  };
  const numStyle: React.CSSProperties = { ...inputStyle, textAlign: "right" };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginTop: rows.length > 0 ? 10 : 0 }}>

      {/* ── Confirmation dialog ─────────────────────────────────────────── */}
      {pendingRemoveId !== null && (
        <div ref={confirmRef} style={{
          marginBottom: 10, padding: "12px 16px", borderRadius: 8,
          background: "#fff3e0", border: "1px solid #fb8c00",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          fontSize: 13,
        }}>
          <span style={{ flex: 1 }}>⚠ {L.confirmMsg}</span>
          <button type="button" onClick={confirmRemove} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: "#e53935", color: "#fff", border: "none", cursor: "pointer",
          }}>
            {L.confirmYes}
          </button>
          <button type="button" onClick={cancelRemove} style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--line)",
            cursor: "pointer",
          }}>
            {L.confirmNo}
          </button>
        </div>
      )}

      {/* ── Dynamic rows table ─────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>#</th>
                <th style={{ ...thStyle, minWidth: 160 }}>{L.componentCol}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{L.instructedCol}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{L.addedCol}</th>
                <th style={thStyle}>{L.rmBatchCol}</th>
                <th style={thStyle}>{L.drumBagCol}</th>
                {!disabled && <th style={{ ...thStyle, width: 32 }} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} style={{
                  borderBottom: "1px solid var(--line)",
                  background: accent + "04",
                }}>
                  {/* Row number — continues from formula rows visually */}
                  <td style={{ ...tdStyle, color: "var(--ink-soft)", paddingLeft: 10 }}>
                    +{idx + 1}
                  </td>

                  {/* Component name */}
                  <td style={tdStyle}>
                    <input
                      type="text"
                      placeholder={L.componentPh}
                      value={row.componentName}
                      disabled={disabled}
                      onChange={e => update(row.id, "componentName", e.target.value)}
                      style={{ ...inputStyle, minWidth: 140 }}
                    />
                  </td>

                  {/* Instructed qty */}
                  <td style={tdStyle}>
                    <input
                      type="number"
                      step="any"
                      placeholder="0.000"
                      value={row.instructedQty}
                      disabled={disabled}
                      onChange={e => update(row.id, "instructedQty", e.target.value)}
                      style={{ ...numStyle, width: 90 }}
                    />
                  </td>

                  {/* Added qty */}
                  <td style={tdStyle}>
                    <input
                      type="number"
                      step="any"
                      placeholder="0.000"
                      value={row.addedQty}
                      disabled={disabled}
                      onChange={e => update(row.id, "addedQty", e.target.value)}
                      style={{ ...numStyle, width: 90 }}
                    />
                  </td>

                  {/* RM Batch No */}
                  <td style={tdStyle}>
                    <input
                      type="text"
                      placeholder="Batch no."
                      value={row.rmBatchNo}
                      disabled={disabled}
                      onChange={e => update(row.id, "rmBatchNo", e.target.value)}
                      style={{ ...inputStyle, width: 100 }}
                    />
                  </td>

                  {/* Drum / Bag No */}
                  <td style={tdStyle}>
                    <input
                      type="text"
                      placeholder="Drum/Bag"
                      value={row.drumBagNo}
                      disabled={disabled}
                      onChange={e => update(row.id, "drumBagNo", e.target.value)}
                      style={{ ...inputStyle, width: 90 }}
                    />
                  </td>

                  {/* Remove button */}
                  {!disabled && (
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <button
                        type="button"
                        title={L.removeTitle}
                        onClick={() => requestRemove(row.id)}
                        style={{
                          width: 26, height: 26, borderRadius: "50%",
                          border: "1px solid #e53935",
                          background: "#ffebee",
                          color: "#e53935",
                          fontSize: 15, fontWeight: 700,
                          cursor: "pointer", lineHeight: 1,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          padding: 0, flexShrink: 0,
                        }}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Component button ───────────────────────────────────────────── */}
      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          style={{
            marginTop: 6,
            padding: "6px 14px",
            borderRadius: 6,
            border: `1.5px dashed ${accent}`,
            background: accent + "08",
            color: accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {L.addComponent}
        </button>
      )}
    </div>
  );
}
