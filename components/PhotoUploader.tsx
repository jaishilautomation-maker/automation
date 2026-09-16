"use client";

// =============================================================================
// PhotoUploader — self-contained photo upload widget for Lab QC forms.
//
// Props:
//   label        — field label (from qc_test_definitions.label)
//   fieldKey     — test_key value (stored in test_results JSONB)
//   factoryCode  — e.g. 'DBV_20_1' (used in Storage path)
//   entityType   — AttachmentEntityType (e.g. 'rm_qc')
//   entityId     — UUID of the parent QC row (null until the row is saved)
//   currentPath  — existing storage_path if editing an already-saved record
//   onUploaded   — called with (fieldKey, storagePath) after successful upload
//   userId       — auth.users.id of the current user
//   factoryId    — UUID of the factory (for attachments table)
//
// State machine:
//   idle → picking file → compressing → uploading → done | error
//
// When entityId is null (form not yet saved), the upload is deferred:
//   the component holds the compressed blob + local preview in state,
//   and exposes a flush(entityId) method via ref for the parent to call
//   after the QC row INSERT completes.
// =============================================================================

import {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useEffect,
} from "react";
import {
  compressImage,
  uploadQcPhoto,
  insertAttachment,
  getSignedUrl,
} from "@/lib/upload";
import type { AttachmentEntityType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadState = "idle" | "compressing" | "uploading" | "done" | "error";

export interface PhotoUploaderHandle {
  /**
   * Called by the parent after the QC row is inserted.
   * Uploads the pending blob and inserts the attachment row.
   * No-op if nothing is pending.
   */
  flush(entityId: string): Promise<void>;
  /** True if a file has been picked but not yet uploaded (entity not saved). */
  hasPending: boolean;
}

interface Props {
  label: string;
  fieldKey: string;
  factoryCode: string;
  entityType: AttachmentEntityType;
  entityId: string | null;      // null = QC row not saved yet
  currentPath?: string | null;  // pre-existing storage_path when editing
  userId: string;
  factoryId: string;
  onUploaded: (fieldKey: string, storagePath: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PhotoUploader = forwardRef<PhotoUploaderHandle, Props>(function PhotoUploader(
  { label, fieldKey, factoryCode, entityType, entityId, currentPath, userId, factoryId, onUploaded },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, setState]         = useState<UploadState>("idle");
  const [error, setError]         = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress]   = useState<string>("");

  // Deferred upload: compressed blob + original filename held until flush()
  const pendingBlob     = useRef<Blob | null>(null);
  const pendingFileName = useRef<string>("");

  // Load existing photo preview on mount / when currentPath changes
  useEffect(() => {
    if (!currentPath) return;
    getSignedUrl(currentPath).then(url => {
      if (url) setPreviewUrl(url);
    });
  }, [currentPath]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // -------------------------------------------------------------------------
  // Exposed handle
  // -------------------------------------------------------------------------
  useImperativeHandle(ref, () => ({
    hasPending: pendingBlob.current !== null,
    async flush(eid: string) {
      if (!pendingBlob.current) return;
      await doUpload(pendingBlob.current, pendingFileName.current, eid);
      pendingBlob.current = null;
      pendingFileName.current = "";
    },
  }));

  // -------------------------------------------------------------------------
  // Core upload logic (shared by immediate + deferred paths)
  // -------------------------------------------------------------------------
  async function doUpload(blob: Blob, fileName: string, eid: string) {
    setState("uploading");
    setProgress("Uploading…");
    try {
      // Build path manually (blob already compressed — reuse uploadQcPhoto's
      // path convention but skip the compress step since we already have a blob)
      const uuid        = crypto.randomUUID();
      const storagePath = `${factoryCode}/${entityType}/${eid}/${uuid}.jpg`;

      const { createClient } = await import("@/lib/supabase-browser");
      const supabase = createClient();

      const { error: uploadErr } = await supabase.storage
        .from("qc-attachments")
        .upload(storagePath, blob, { contentType: "image/jpeg", upsert: false });

      if (uploadErr) throw new Error(uploadErr.message);

      await insertAttachment({
        entityType,
        entityId:    eid,
        factoryId,
        storagePath,
        fileName,
        sizeBytes:   blob.size,
        uploadedBy:  userId,
      });

      onUploaded(fieldKey, storagePath);
      setState("done");
      setProgress("");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress("");
    }
  }

  // -------------------------------------------------------------------------
  // File selection handler
  // -------------------------------------------------------------------------
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setState("compressing");
    setProgress("Compressing…");

    try {
      const compressed = await compressImage(file);

      // Show local preview immediately
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(compressed));

      if (entityId) {
        // QC row already exists — upload immediately
        await doUpload(compressed, file.name, entityId);
      } else {
        // QC row not saved yet — hold blob, parent calls flush() after save
        pendingBlob.current     = compressed;
        pendingFileName.current = file.name;
        setState("idle"); // show preview, no spinner
        setProgress("Photo ready — will upload when you save.");
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Compression failed");
      setProgress("");
    }

    // Reset file input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const busy = state === "compressing" || state === "uploading";

  return (
    <div>
      <label>
        {label}
        {state === "done" && (
          <span style={{ color: "var(--ok)", fontWeight: 400 }}> ✓ uploaded</span>
        )}
      </label>

      {/* Preview area */}
      {previewUrl ? (
        <div style={{ marginBottom: 8 }}>
          <img
            src={previewUrl}
            alt={label}
            style={{
              maxWidth: "100%",
              maxHeight: 220,
              borderRadius: 8,
              border: "1px solid var(--line)",
              objectFit: "contain",
              background: "#f5f5f5",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: 8,
            padding: "18px 12px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--ink-soft)",
            marginBottom: 8,
            cursor: "pointer",
          }}
          onClick={() => !busy && inputRef.current?.click()}
        >
          📷 Tap to add photo
        </div>
      )}

      {/* Progress / status */}
      {progress && (
        <div className="field-hint" style={{ marginBottom: 6 }}>
          {busy && (
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid var(--clay)",
                borderTopColor: "transparent",
                animation: "spin 0.7s linear infinite",
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
          )}
          {progress}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="field-hint"
          style={{ color: "var(--warn)", marginBottom: 6 }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "6px 12px" }}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {previewUrl ? "Replace photo" : "Choose photo"}
        </button>

        {previewUrl && !busy && state !== "done" && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "6px 12px", color: "var(--warn)" }}
            onClick={() => {
              if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
              pendingBlob.current = null;
              pendingFileName.current = "";
              setState("idle");
              setProgress("");
              setError(null);
              onUploaded(fieldKey, "");
            }}
          >
            Remove
          </button>
        )}
      </div>

      {/* Hidden file input — accepts images, prefers camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Spin keyframe — injected inline once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
});

export default PhotoUploader;
