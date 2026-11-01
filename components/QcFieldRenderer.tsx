"use client";

// =============================================================================
// QcFieldRenderer — renders a single qc_test_definitions field as a form input.
//
// Enhancements (A-20 Lab QC finishing):
//   • Select fields with "Other" in options → reveal a free-text sibling input
//     when "Other" is selected. The free-text value is stored under
//     `{test_key}_other` in the values map.
//   • Calculated fields can be overridden with a manual entry toggle.
//     Keys listed in manualOverrideKeys support a toggle button; when the
//     user switches to manual the field becomes a free-text input and the
//     sidecar key `{test_key}_manual_mode` is set to "1".
//   • Calculated fields show "—" as placeholder (not "auto") until all
//     inputs are available.
// =============================================================================

import { useRef } from "react";
import type { QcTestDefinition, AttachmentEntityType } from "@/lib/types";
import PhotoUploader, { type PhotoUploaderHandle } from "./PhotoUploader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhotoUploadProps {
  factoryCode: string;
  factoryId:   string;
  entityType:  AttachmentEntityType;
  entityId:    string | null;   // null = QC row not saved yet
  userId:      string;
  /** Called after successful upload with the storage_path string */
  onUploaded:  (fieldKey: string, storagePath: string) => void;
  /** Ref map so the parent can call flush(entityId) after saving the QC row */
  uploaderRefs: React.MutableRefObject<Record<string, PhotoUploaderHandle | null>>;
}

interface Props {
  def: QcTestDefinition;
  value: string;
  onChange: (key: string, val: string) => void;
  onBlur?: (key: string, val: string) => void;
  photoUploadProps?: PhotoUploadProps;
  /**
   * Optional inline indicator rendered to the RIGHT of this field
   * (e.g. the customer spec limit + pass/fail for this parameter).
   */
  specBadge?: React.ReactNode;
  /**
   * Set of test_keys for calculated fields that support manual-entry toggle.
   * Typically: calcium_content, boron_content.
   * When a key is listed here AND the field is_calculated, a toggle button
   * renders beside the label. The sidecar `{key}_manual_mode` = "1" in
   * `values` signals manual mode; its absence / "0" means auto-calc mode.
   */
  manualOverrideKeys?: Set<string>;
  /**
   * Full values map — needed so the Select "Other" reveal can read/write the
   * `{test_key}_other` sidecar key, and so manual-mode check works.
   */
  allValues?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QcFieldRenderer({
  def,
  value,
  onChange,
  onBlur,
  photoUploadProps,
  specBadge,
  manualOverrideKeys,
  allValues,
}: Props) {
  const localRef = useRef<PhotoUploaderHandle | null>(null);

  // Wrapper that optionally places a spec badge to the right
  const withBadge = (fieldEl: React.ReactNode) => {
    if (!specBadge) return fieldEl;
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>{fieldEl}</div>
        <div style={{ flex: "0 0 auto", minWidth: 150, paddingBottom: 2 }}>{specBadge}</div>
      </div>
    );
  };

  // Is this field in manual-override mode?
  const isManualMode =
    def.is_calculated &&
    manualOverrideKeys?.has(def.test_key) &&
    allValues?.[def.test_key + "_manual_mode"] === "1";

  const labelEl = (
    <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>
        {def.label}
        {def.unit && (
          <span style={{ color: "var(--ink-soft)", fontWeight: 400 }}> ({def.unit})</span>
        )}
        {def.is_calculated && !isManualMode && (
          <span style={{ color: "var(--ok)", fontWeight: 400 }}> — auto</span>
        )}
        {isManualMode && (
          <span style={{ color: "var(--warn)", fontWeight: 400 }}> — manual</span>
        )}
      </span>
      {/* Manual-entry toggle for supported calculated fields */}
      {def.is_calculated && manualOverrideKeys?.has(def.test_key) && (
        <button
          type="button"
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--line)",
            background: isManualMode ? "var(--warn-soft)" : "var(--bg-soft)",
            color: isManualMode ? "var(--warn)" : "var(--ink-soft)",
            cursor: "pointer",
            lineHeight: 1.4,
          }}
          onClick={() => {
            const newMode = isManualMode ? "0" : "1";
            onChange(def.test_key + "_manual_mode", newMode);
            // When switching back to auto, clear the manual value so the
            // auto-calc result takes over on next handleChange cycle
            if (newMode === "0") onChange(def.test_key, "");
          }}
        >
          {isManualMode ? "Use formula" : "Enter manually"}
        </button>
      )}
    </label>
  );

  // ── Photo ─────────────────────────────────────────────────────────────────
  if (def.input_type === "photo") {
    if (!photoUploadProps) {
      return (
        <div>
          {labelEl}
          <div style={{
            border: "1px dashed var(--line)", borderRadius: 8,
            padding: "12px", textAlign: "center",
            fontSize: 12, color: "var(--ink-soft)",
          }}>
            📷 Photo upload not available here yet
          </div>
        </div>
      );
    }

    const { factoryCode, factoryId, entityType, entityId, userId, onUploaded, uploaderRefs } = photoUploadProps;
    return (
      <div>
        <PhotoUploader
          ref={el => {
            localRef.current = el;
            uploaderRefs.current[def.test_key] = el;
          }}
          label={def.label}
          fieldKey={def.test_key}
          factoryCode={factoryCode}
          entityType={entityType}
          entityId={entityId}
          currentPath={value || null}
          userId={userId}
          factoryId={factoryId}
          onUploaded={(key, path) => {
            onChange(key, path);
            onUploaded(key, path);
          }}
        />
      </div>
    );
  }

  // ── Boolean ───────────────────────────────────────────────────────────────
  if (def.input_type === "boolean") {
    return withBadge(
      <div>
        {labelEl}
        <select value={value}
          onChange={e => onChange(def.test_key, e.target.value)}
          onBlur={e => onBlur?.(def.test_key, e.target.value)}>
          <option value="">— Select —</option>
          <option value="true">Yes / Pass</option>
          <option value="false">No / Fail</option>
        </select>
      </div>
    );
  }

  // ── Select (with "Other" free-text reveal) ────────────────────────────────
  if (def.input_type === "select" && def.options) {
    const otherKey   = def.test_key + "_other";
    const otherValue = allValues?.[otherKey] ?? "";
    const showOther  = value === "Other";

    return withBadge(
      <div>
        {labelEl}
        <select value={value}
          onChange={e => onChange(def.test_key, e.target.value)}
          onBlur={e => onBlur?.(def.test_key, e.target.value)}>
          <option value="">— Select —</option>
          {def.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {showOther && (
          <input
            type="text"
            placeholder="Please specify…"
            value={otherValue}
            style={{ marginTop: 6 }}
            onChange={e => onChange(otherKey, e.target.value)}
            onBlur={e => onBlur?.(otherKey, e.target.value)}
          />
        )}
      </div>
    );
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  if (def.input_type === "date") {
    return withBadge(
      <div>
        {labelEl}
        <input
          type="date"
          value={value}
          onChange={e => onChange(def.test_key, e.target.value)}
          onBlur={e => onBlur?.(def.test_key, e.target.value)}
        />
      </div>
    );
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  if (def.input_type === "text") {
    return withBadge(
      <div>
        {labelEl}
        <input
          type="text"
          value={value}
          placeholder={def.label}
          onChange={e => onChange(def.test_key, e.target.value)}
          onBlur={e => onBlur?.(def.test_key, e.target.value)}
        />
      </div>
    );
  }

  // ── Calculated field in manual-override mode → free-text input ───────────
  if (def.is_calculated && isManualMode) {
    return withBadge(
      <div>
        {labelEl}
        <input
          type="text"
          value={value}
          placeholder="Enter value manually…"
          onChange={e => onChange(def.test_key, e.target.value)}
          onBlur={e => onBlur?.(def.test_key, e.target.value)}
          style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
        />
      </div>
    );
  }

  // ── Number (default, includes calculated in auto mode) ────────────────────
  return withBadge(
    <div>
      {labelEl}
      <input
        type="number"
        step="any"
        value={value}
        placeholder={def.is_calculated ? "—" : "0"}
        disabled={def.is_calculated}
        onChange={e => onChange(def.test_key, e.target.value)}
        onBlur={e => onBlur?.(def.test_key, e.target.value)}
        style={
          def.is_calculated
            ? { background: "var(--ok-soft)", color: "var(--ok)" }
            : undefined
        }
      />
    </div>
  );
}
