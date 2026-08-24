// =============================================================================
// HMAC-SHA256 signature utilities for the QC Exchange protocol.
//
// Used by:
//   A-20/1  app/api/qc-exchange/send/route.ts         — creates signature
//   A-20    app/api/qc-exchange/receive/route.ts       — verifies signature
//
// The shared secret is stored server-side only in both Vercel projects:
//   QC_EXCHANGE_SECRET=<random 32+ char string>
// It is NEVER prefixed with NEXT_PUBLIC_ and never sent to the browser.
//
// Algorithm: HMAC-SHA256 over the raw request body string.
// Header name: X-QC-Exchange-Sig
// Format: hex-encoded HMAC digest
// =============================================================================

/**
 * Creates an HMAC-SHA256 signature of `body` using `secret`.
 * Returns a lowercase hex string.
 * Uses the Web Crypto API (available in both Node.js 18+ and Edge runtime).
 */
export async function createHmacSignature(body: string, secret: string): Promise<string> {
  const encoder   = new TextEncoder();
  const keyData   = encoder.encode(secret);
  const bodyData  = encoder.encode(body);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, bodyData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies that `signature` matches the HMAC-SHA256 of `body` with `secret`.
 * Uses a constant-time comparison to prevent timing attacks.
 */
export async function verifyHmacSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expected = await createHmacSignature(body, secret);

  // Constant-time comparison (prevents timing-based signature oracle)
  if (expected.length !== signature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}
