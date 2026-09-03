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
// Component
// ---------------------------------------------------------------------------

export default function LoginPage() {
  const { profileError } = useAuth();

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

      // Session is now active. auth-context's onAuthStateChange will fire,
      // load the profile, and the root redirect (app/page.tsx) will push
      // the user to /select-module. No manual router.push needed here.
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
      <div className="auth-card">

        <h2>Sign in / लॉगिन</h2>
        <div className="auth-sub">JSCI · {FACTORY_NAME}</div>

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
              className="btn btn-primary"
              type="button"
              style={{ marginTop: 16 }}
              disabled={loading}
              onClick={handleSendOtp}
            >
              {loading ? "Sending…" : "Send OTP via WhatsApp"}
            </button>

            <div className="small-note" style={{ marginTop: 14 }}>
              You will receive a 6-digit code on WhatsApp.
              Accounts are set up by your admin — contact admin if you can&apos;t log in.
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
