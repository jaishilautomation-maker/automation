// =============================================================================
// qc-photo-attachments — load a lab QC record's uploaded photos as email
// attachments.
//
// Lab QC photos live in the PRIVATE "qc-attachments" Storage bucket and are
// linked to their parent record via the `attachments` table (entity_id =
// the QC record id, which is the same value pages pass as notifyEvent's
// referenceId). A private bucket means a raw path/URL won't render in an
// email, so we download the bytes server-side (service role) and return them
// as EmailAttachment[] for sendEmail to attach.
//
// Server-only: uses SUPABASE_SERVICE_ROLE_KEY.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import type { EmailAttachment } from "./send-email";

const BUCKET = "qc-attachments";
const MAX_PHOTOS = 10;              // safety cap per email
const MAX_BYTES  = 8 * 1024 * 1024; // skip anything unexpectedly large (8 MB)

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Guess a MIME type + extension from the storage path. Photos are .jpg. */
function mimeFor(path: string): { contentType: string; ext: string } {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png"))  return { contentType: "image/png",  ext: "png" };
  if (lower.endsWith(".webp")) return { contentType: "image/webp", ext: "webp" };
  if (lower.endsWith(".gif"))  return { contentType: "image/gif",  ext: "gif" };
  return { contentType: "image/jpeg", ext: "jpg" }; // uploads are compressed JPEGs
}

/**
 * Return the uploaded photos for a QC record as INLINE email images.
 * `recordId` is the attachments.entity_id (== notifyEvent referenceId).
 * Each returned attachment carries a `cid` so it can be embedded in the HTML
 * via `<img src="cid:...">`. Never throws — returns [] on any error.
 */
/** Signed-URL validity: 7 days. The email is read soon after sending; after a
 *  week the inline preview stops loading but the attached file (Option 3) is
 *  always available as a permanent download. */
const SIGNED_URL_TTL_S = 7 * 24 * 60 * 60;

/** One resolved QC photo: both a signed URL (inline preview) and the raw bytes
 *  (permanent downloadable attachment). */
export interface QcPhoto {
  filename:    string;
  contentType: string;
  content:     Buffer;
  signedUrl:   string | null;
}

/**
 * Load a QC record's photos, resolving BOTH a signed URL (for an inline <img>
 * preview that keeps the HTML tiny so Gmail never clips it) AND the file bytes
 * (attached as a permanent download). `recordId` is attachments.entity_id
 * (== notifyEvent referenceId). Never throws — returns [] on any error.
 */
export async function loadQcPhotos(
  recordId: string | null | undefined,
): Promise<QcPhoto[]> {
  if (!recordId) return [];
  try {
    const supabase = admin();

    const { data: rows, error } = await supabase
      .from("attachments")
      .select("storage_path, file_name, mime_type")
      .eq("entity_id", recordId)
      .order("uploaded_at", { ascending: true })
      .limit(MAX_PHOTOS);
    if (error || !rows || rows.length === 0) return [];

    const out: QcPhoto[] = [];
    let i = 0;
    for (const row of rows as { storage_path: string; file_name: string | null; mime_type: string | null }[]) {
      i++;
      const { data: blob, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(row.storage_path);
      if (dlErr || !blob) continue;

      const arrayBuf = await blob.arrayBuffer();
      if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_BYTES) continue;

      const { contentType, ext } = mimeFor(row.storage_path);
      const filename =
        (row.file_name && /\.[a-z0-9]+$/i.test(row.file_name))
          ? row.file_name
          : `photo-${i}.${ext}`;

      // Signed URL for the inline preview (keeps the HTML body tiny).
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_S);

      out.push({
        filename,
        contentType: row.mime_type || contentType,
        content: Buffer.from(arrayBuf),
        signedUrl: signed?.signedUrl ?? null,
      });
    }
    return out;
  } catch (err) {
    console.error("[qc-photo-attachments] failed:", err);
    return [];
  }
}

/**
 * Convert resolved photos to EmailAttachment[] as PERMANENT DOWNLOADABLE files
 * (no `cid` — they are NOT inlined as base64, which is what previously bloated
 * the HTML and triggered Gmail's ~102 KB clip). The inline preview is handled
 * separately by buildPhotoHtml() using the signed URLs.
 */
export function photosToAttachments(photos: QcPhoto[]): EmailAttachment[] {
  return photos.map((p) => ({
    filename:    p.filename,
    contentType: p.contentType,
    content:     p.content,
    // no cid → downloadable attachment, not inline base64
  }));
}

/**
 * Build the inline-photo HTML block using SIGNED URLs (not cid:/base64), so the
 * HTML stays tiny and Gmail does not clip the message. Returns "" when there
 * are no photos with a usable URL.
 */
export function buildPhotoHtml(photos: QcPhoto[]): string {
  const withUrl = photos.filter((p) => p.signedUrl);
  if (withUrl.length === 0) return "";
  const imgs = withUrl
    .map(
      (p) => `<a href="${p.signedUrl}" target="_blank" style="text-decoration:none">` +
             `<img src="${p.signedUrl}" alt="${escapeAttr(p.filename)}" ` +
             `style="max-width:260px;max-height:260px;border:1px solid #e0e0e0;` +
             `border-radius:8px;margin:6px 8px 0 0;object-fit:contain" /></a>`,
    )
    .join("");
  return `<h4 style="margin:20px 0 8px;font-size:14px">Photos (${withUrl.length})</h4>` +
         `<div>${imgs}</div>` +
         `<p style="margin:6px 0 0;font-size:11px;color:#999">` +
         `Inline previews expire in 7 days; the full images are attached to this email.</p>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
