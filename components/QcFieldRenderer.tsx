"use client";

// =============================================================================
// QcFieldRenderer — renders a single qc_test_definitions field as a form input.
//
// Photo fields delegate to PhotoUploader (compress + Storage upload).
// All other field types render inline.
//
// For photo fields the parent must supply photoUploadProps so the uploader
// knows the factory, entity type, and user.  If photoUploadProps is omitted
// the field falls back to the "coming soon" placeholder (safe default for
// pages not yet wired up).
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
  photoUploadProps?: PhotoUploadProps;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QcFieldRenderer({ def, value, onChange, photoUploadProps }: Props) {
  const localRef = useRef<PhotoUploaderHandle | null>(null);

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
    if (!photoUploadProps) {
      // Fallback if parent hasn't wired up upload context yet
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
