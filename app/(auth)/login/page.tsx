"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { FACTORY_NAME } from "@/lib/factory-config";
import type { AppRole } from "@/lib/types";

const factoryName = FACTORY_NAME;

// Simplified role labels shown during self-registration.
// These map to the app_role enum values that require no factory_admin grant.
type SignupRole = "operator" | "stores" | "production" | "lab";

const ROLE_MAP: Record<SignupRole, AppRole> = {
  operator:   "operator",
  stores:     "stores",
  production: "production_incharge",
  lab:        "chemist",
};

const ROLES: { value: SignupRole; label: string }[] = [
  { value: "operator",   label: "Operator / ऑपरेटर" },
  { value: "stores",     label: "Stores / स्टोर्स" },
  { value: "production", label: "Production" },
  { value: "lab",        label: "Lab / QC" },
];

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [isSignup, setIsSignup]     = useState(false);
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [fullName, setFullName]     = useState("");
  const [role, setRole]             = useState<SignupRole | null>(null);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);

  const toggle = () => {
    setIsSignup(v => !v);
    setError("");
  };

  const handleSubmit = async () => {
    setError("");
    if (!isValidEmail(email)) { setError("Enter a valid email address."); return; }
    if (password.length < 6)  { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    try {
      if (isSignup) {
        if (password !== confirm) { setError("Passwords do not match."); return; }
        if (!role)                { setError("Please select your role."); return; }
        if (!fullName.trim())     { setError("Please enter your full name."); return; }

        // Pass full_name and initial role in metadata.
        // The DB trigger fn_handle_new_user() will create both the profiles
        // row and the user_roles row as SECURITY DEFINER, bypassing RLS.
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim(), role: ROLE_MAP[role!] } },
        });
        if (signUpErr) { setError(signUpErr.message); return; }

        if (data.session && data.user) {
          router.push("/");
          router.refresh();
        } else {
          setError(
            "Account created. If email confirmation is enabled, check your inbox before signing in."
          );
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) { setError(signInErr.message); return; }
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h2>{isSignup ? "Create account / खाता बनाएं" : "Sign in / लॉगिन"}</h2>
        <div className="auth-sub">JSCI · {factoryName}</div>

        {error && <div className="auth-error">{error}</div>}

        <label>Email / ईमेल</label>
        <input
          type="email"
          placeholder="name@company.com"
          autoComplete="username"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
        />

        <label>Password / पासवर्ड</label>
        <input
          type="password"
          placeholder="Password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
        />

        {isSignup && (
          <>
            <label>Confirm password / पासवर्ड की पुष्टि करें</label>
            <input
              type="password"
              placeholder="Confirm password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />

            <label>Full name / पूरा नाम</label>
            <input
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />

            <label>Your role / आपकी भूमिका</label>
            <div className="role-chip-group">
              {ROLES.map(r => (
                <div
                  key={r.value}
                  className={`role-chip${role === r.value ? " selected" : ""}`}
                  onClick={() => setRole(r.value)}
                >
                  {r.label}
                </div>
              ))}
            </div>
          </>
        )}

        <button
          className="btn btn-primary"
          type="button"
          style={{ marginTop: 16 }}
          disabled={loading}
          onClick={handleSubmit}
        >
          {loading
            ? isSignup ? "Creating…" : "Signing in…"
            : isSignup ? "Create account / खाता बनाएं" : "Sign in / लॉगिन करें"}
        </button>

        <div className="auth-toggle">
          {isSignup
            ? <>Already have an account? / पहले से खाता है? <a onClick={toggle}>Sign in / लॉगिन</a></>
            : <>New here? / नए हैं? <a onClick={toggle}>Create an account / खाता बनाएं</a></>}
        </div>

        <div className="small-note" style={{ marginTop: 14 }}>
          Your role decides what part of the job card you fill and in which language the form shows.
        </div>
      </div>
    </div>
  );
}
