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
export async function loadQcPhotoAttachments(
  recordId: string | null | undefined,
): Promise<EmailAttachment[]> {
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

    const out: EmailAttachment[] = [];
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

      out.push({
        filename,
        contentType: row.mime_type || contentType,
        content: Buffer.from(arrayBuf),
        cid: `qcphoto${i}@jsci`,
      });
    }
    return out;
  } catch (err) {
    console.error("[qc-photo-attachments] failed:", err);
    return [];
  }
}

/**
 * Build an HTML block that renders the inline photos (referenced by their cids)
 * so recipients see the images in the email body. Returns "" when there are
 * no photos.
 */
export function buildPhotoHtml(attachments: EmailAttachment[]): string {
  const inline = attachments.filter(a => a.cid);
  if (inline.length === 0) return "";
  const imgs = inline
    .map(
      a => `<img src="cid:${a.cid}" alt="${a.filename}" style="max-width:260px;max-height:260px;` +
           `border:1px solid #e0e0e0;border-radius:8px;margin:6px 8px 0 0;object-fit:contain" />`,
    )
    .join("");
  return `<h4 style="margin:20px 0 8px;font-size:14px">Photos (${inline.length})</h4>` +
         `<div>${imgs}</div>`;
}
