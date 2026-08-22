// =============================================================================
// Photo upload utility for Lab QC forms
//
// Flow:
//   1. compressImage()  — resize to ≤1200px, convert to JPEG ~0.82 quality
//                         (targets ~200–300 KB per architecture spec §15)
//   2. uploadQcPhoto()  — upload compressed blob to Supabase Storage bucket
//                         `qc-attachments`, returns the storage_path string
//   3. insertAttachment() — writes one row to `attachments` table linking
//                           the file to its parent QC record
//
// Storage path convention (matches schema comment in 001_initial_schema.sql):
//   {factory_code}/{entity_type}/{entity_id}/{uuid}.jpg
//
// All three steps are called from PhotoUploader.tsx. The storage_path string
// is what gets stored in test_results JSONB as the photo field value — the
// full signed URL is fetched separately for display.
// =============================================================================

import { createClient } from "./supabase-browser";
import type { AttachmentEntityType } from "./types";

// ---------------------------------------------------------------------------
// 1. Client-side image compression using Canvas API (no extra dependency)
// ---------------------------------------------------------------------------

/**
 * Compress an image File to JPEG, resizing so the longest dimension ≤ maxPx.
 * Returns a Blob ready for upload.
 */
export async function compressImage(
  file: File,
  maxPx = 1200,
  quality = 0.82
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions keeping aspect ratio
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) {
          height = Math.round((height * maxPx) / width);
          width  = maxPx;
        } else {
          width  = Math.round((width * maxPx) / height);
          height = maxPx;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob failed"));
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to load"));
    };

    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 2. Upload to Supabase Storage
// ---------------------------------------------------------------------------

const BUCKET = "qc-attachments";

/**
 * Compress and upload a photo to Supabase Storage.
 * Returns the storage_path string (not a signed URL — that is fetched
 * separately when displaying the photo).
 */
export async function uploadQcPhoto(
  file: File,
  factoryCode: string,
  entityType: AttachmentEntityType,
  entityId: string
): Promise<{ storagePath: string; sizeBytes: number; fileName: string }> {
  const supabase = createClient();

  // Compress
  const compressed = await compressImage(file);

  // Build path: {factory_code}/{entity_type}/{entity_id}/{uuid}.jpg
  const uuid = crypto.randomUUID();
  const storagePath = `${factoryCode}/${entityType}/${entityId}/${uuid}.jpg`;

  // Upload
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, compressed, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) throw new Error("Upload failed: " + uploadError.message);

  return {
    storagePath,
    sizeBytes: compressed.size,
    fileName: file.name,
  };
}

// ---------------------------------------------------------------------------
// 3. Insert attachment row
// ---------------------------------------------------------------------------

/**
 * Write a row to the `attachments` table linking the uploaded file to
 * its parent QC record.
 * Call this AFTER the QC row has been inserted (so entity_id is known).
 */
export async function insertAttachment(params: {
  entityType: AttachmentEntityType;
  entityId: string;
  factoryId: string;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("attachments").insert({
    entity_type:  params.entityType,
    entity_id:    params.entityId,
    factory_id:   params.factoryId,
    storage_path: params.storagePath,
    file_name:    params.fileName,
    mime_type:    "image/jpeg",
    size_bytes:   params.sizeBytes,
    uploaded_by:  params.uploadedBy,
  });
  if (error) throw new Error("Attachment record failed: " + error.message);
}

// ---------------------------------------------------------------------------
// 4. Get a short-lived signed URL for displaying a stored photo
// ---------------------------------------------------------------------------

/**
 * Returns a signed URL valid for 1 hour, or null on error.
 * Used by PhotoUploader to render the uploaded image preview.
 */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600); // 1 hour
  if (error || !data) return null;
  return data.signedUrl;
}
