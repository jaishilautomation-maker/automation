"use client";

// =============================================================================
// Login page — phone number + WhatsApp OTP (2-step)
//
// Step 1: Enter phone number → "Send OTP" → supabase.auth.signInWithOtp({ phone })
//         Supabase fires the Send SMS Hook → Interakt delivers OTP via WhatsApp.
//
// Step 2: Enter 6-digit OTP → "Verify" → supabase.auth.verifyOtp({ phone, token, type: "sms" })
//         On success: auth-context picks up the new session via onAuthStateChange,
//         loads the profile, and the root page.tsx redirects to /select-module.
//
// Self-registration is intentionally removed. Accounts are admin-provisioned only.
// If a valid OTP is entered but no profiles row matches the phone, auth-context
// signs the session back out and shows "Account not found — contact admin".
// =============================================================================

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "@/lib/auth-context";
import { FACTORY_NAME } from "@/lib/factory-config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_RESEND_COOLDOWN_S = 30; // seconds before "Resend OTP" is enabled

// Supabase client created ONCE outside the component so the same instance
// is used for both signInWithOtp and verifyOtp — a new instance on re-render
// loses the pending OTP session state and causes "token expired" errors.
const supabase = createClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a raw phone input to E.164 digits only (no + prefix).
 *  Supabase stores phone without the leading + internally, so we strip it
 *  to ensure signInWithOtp and verifyOtp use the exact same format.
 *  Accepts: 10-digit local, 91XXXXXXXXXX, +91XXXXXXXXXX */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10)                            return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && raw.startsWith("+91"))   return digits; // strip +
  return null; // unrecognised format
}

// ---------------------------------------------------------------------------
// Brand logo — the Jaishil mark, served from public/favicon.ico (which is the
// Jaishil logo). Falls back to the inline SVG recreation only if the image
// fails to load, so the card never renders empty.
// ---------------------------------------------------------------------------
function JaishilLogo() {
  const [imgFailed, setImgFailed] = useState(false);

  if (!imgFailed) {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicon.ico"
          alt="Jaishil"
          width={72}
          height={72}
          style={{ objectFit: "contain" }}
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  // Inline SVG fallback (crisp at any size, no asset required).
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <svg width="72" height="72" viewBox="0 0 120 120" role="img" aria-label="Jaishil">
        <rect x="6" y="6" width="108" height="108" rx="16" fill="#fff" stroke="#e4e4e7" />
        {/* black swoosh monogram */}
        <path
          d="M78 24 L52 86 q-3 8 -12 8 h-6 l20 -50 q3 -8 -3 -8 h-8 l4 -10 q2 -6 9 -6 h14 q10 0 7 12 z"
          fill="#111"
        />
        {/* green bar */}
        <rect x="30" y="74" width="60" height="9" rx="2" fill="#1a9e5f" />
        <text
          x="60" y="106" textAnchor="middle"
          fontFamily="Arial, sans-serif" fontWeight="700" fontSize="15" fill="#1a9e5f"
          letterSpacing="1"
        >
          JAISHIL
        </text>
      </svg>
    </div>
  );
}

/** WhatsApp glyph for the Send-OTP button. */
function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
      style={{ marginRight: 8, verticalAlign: "-3px" }}>
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.9-4.44 9.9-9.9S17.5 2 12.04 2zm0 18.02c-1.48 0-2.93-.4-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79.98-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const router = useRouter();
  const { profileError } = useAuth();

  // Preserve ?process= param through the login flow for local dev
  const processParam = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("process") ?? ""
    : "";

  // ── Form state ────────────────────────────────────────────────────────────
  const [step, setStep]       = useState<"phone" | "otp">("phone");
  const [phone, setPhone]     = useState("");     // raw user input
  const [e164, setE164]       = useState("");     // normalised E.164 for Supabase
  const [otp, setOtp]         = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // ── Resend cooldown ───────────────────────────────────────────────────────
  const [cooldown, setCooldown]         = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldown(OTP_RESEND_COOLDOWN_S);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(cooldownTimer.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

  // ── Step 1: Send OTP ──────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    setError("");
    const normalised = toE164(phone.trim());
    if (!normalised) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }

    setLoading(true);
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        phone: normalised,
      });

      if (otpErr) {
        setError(otpErr.message);
        return;
      }

      setE164(normalised);
      setStep("otp");
      startCooldown();
    } catch {
      setError("Could not reach the server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    setError("");
    if (otp.trim().length !== 6 || !/^\d{6}$/.test(otp.trim())) {
      setError("Enter the 6-digit code from WhatsApp.");
      return;
    }

    if (!e164) {
      // Should never happen, but guard against state loss on re-render
      setError("Session expired — please go back and re-enter your number.");
      return;
    }

    setLoading(true);
    try {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        phone: e164,
        token: otp.trim(),
        type:  "sms",
      });

      if (verifyErr) {
        // Common case: wrong/expired code
        setError(verifyErr.message);
        return;
      }

      // Session is live — navigate to root which server-redirects to /select-module
      // Pass the process param so the server gate is satisfied in local dev
      router.push(processParam ? `/?process=${encodeURIComponent(processParam)}` : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Resend ────────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (cooldown > 0) return;
    setOtp("");
    setError("");
    // Re-use handleSendOtp but with the already-normalised number
    setLoading(true);
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        phone: e164,
      });
      if (otpErr) { setError(otpErr.message); return; }
      startCooldown();
    } catch {
      setError("Could not reach the server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="auth-wrap">
      <div className="auth-card auth-card-centered">

        <JaishilLogo />

        <h2 style={{ textAlign: "center", fontSize: 22, marginTop: 14 }}>Sign in / लॉगिन</h2>
        <div
          className="auth-brand"
          style={{ textAlign: "center", color: "var(--clay)", fontWeight: 700, fontSize: 14, marginTop: 2 }}
        >
          JSCI — {FACTORY_NAME}
        </div>
        <div className="auth-sub" style={{ textAlign: "center", marginBottom: 20 }}>
          Plot No. A/20/1, MIDC, Dombivli (East)
        </div>

        {error && <div className="auth-error">{error}</div>}

        {/* Account-not-found guard: shown after OTP succeeds but no profile exists */}
        {profileError === "not_found" && (
          <div className="auth-error" style={{ marginBottom: 12 }}>
            Account not found — contact your admin to get access.
          </div>
        )}

        {/* ── Step 1: phone entry ── */}
        {step === "phone" && (
          <>
            <label>Mobile number / मोबाइल नंबर</label>
            <div style={{ display: "flex", gap: 8 }}>
              <span
                style={{
                  padding: "10px 12px",
                  background: "var(--surface-raised, #f4f4f5)",
                  border: "1px solid var(--border, #e4e4e7)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--ink-secondary, #71717a)",
                  whiteSpace: "nowrap",
                  lineHeight: "1.4",
                }}
              >
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="9876543210"
                autoComplete="tel"
                maxLength={13}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSendOtp()}
                style={{ flex: 1 }}
              />
            </div>

            <button
              className="btn btn-whatsapp"
              type="button"
              style={{ marginTop: 16, width: "100%" }}
              disabled={loading}
              onClick={handleSendOtp}
            >
              <WhatsAppIcon />
              {loading ? "Sending…" : "Send OTP on WhatsApp"}
            </button>

            <div className="small-note" style={{ marginTop: 14, textAlign: "center" }}>
              6-digit OTP will be sent to your WhatsApp.<br />
              खाता पंजीकृत होने पर लॉगिन कर सकते हैं।
            </div>
          </>
        )}

        {/* ── Step 2: OTP entry ── */}
        {step === "otp" && (
          <>
            <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--ink-secondary, #71717a)" }}>
              A 6-digit code was sent to <strong>+{e164}</strong> via WhatsApp.
            </p>

            <label>OTP code / कोड</label>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="123456"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && handleVerifyOtp()}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />

            <button
              className="btn btn-primary"
              type="button"
              style={{ marginTop: 16 }}
              disabled={loading || otp.length !== 6}
              onClick={handleVerifyOtp}
            >
              {loading ? "Verifying…" : "Verify / जाँचें"}
            </button>

            <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={cooldown > 0 || loading}
                onClick={handleResend}
                style={{ fontSize: 13 }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>

              <button
                className="btn btn-ghost"
                type="button"
                disabled={loading}
                onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                style={{ fontSize: 13 }}
              >
                ← Change number
              </button>
            </div>

            <div className="small-note" style={{ marginTop: 12 }}>
              Didn&apos;t receive the code? Check your WhatsApp (not SMS).
              Wait {OTP_RESEND_COOLDOWN_S}s before requesting again.
            </div>
          </>
        )}

      </div>
    </div>
  );
}
