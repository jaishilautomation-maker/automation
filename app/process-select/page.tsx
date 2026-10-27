"use client";

// =============================================================================
// Process Selection Page — local development only
//
// Shown when NEXT_PUBLIC_FACTORY_CODE is not set (i.e. localhost).
// The developer picks A-20/1 or A-20. The choice is:
//   1. Stored in sessionStorage so factory-config.ts and select-module
//      can resolve the right FACTORY_CODE for the rest of the session.
//   2. Soft-navigated to /?process=<code> so the server auth gate passes.
//      select-module reads sessionStorage at runtime to detect local process.
// =============================================================================

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const PROCESS_KEY = "jsci_local_process";

export default function ProcessSelectPage() {
  const router = useRouter();

  // If already chosen this session, skip straight to the app
  useEffect(() => {
    const saved = sessionStorage.getItem(PROCESS_KEY);
    if (saved) {
      router.replace(`/?process=${encodeURIComponent(saved)}`);
    }
  }, [router]);

  const choose = (code: "A20_1" | "A20") => {
    sessionStorage.setItem(PROCESS_KEY, code);
    router.replace(`/?process=${encodeURIComponent(code)}`);
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #fff8f3 0%, #fff 60%)",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: "24px",
    }}>
      {/* Logo / brand */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          fontSize: 42, fontWeight: 800, color: "#b5451b",
          letterSpacing: "-1px", lineHeight: 1,
        }}>
          JSCI
        </div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 6, fontWeight: 500 }}>
          Jaishil Chemicals &amp; Industries
        </div>
      </div>

      <div style={{
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 4px 32px rgba(0,0,0,0.10)",
        padding: "36px 40px",
        maxWidth: 460,
        width: "100%",
        textAlign: "center",
      }}>
        <h2 style={{
          fontSize: 18, fontWeight: 700, color: "#1a1a1a",
          marginBottom: 8, marginTop: 0,
        }}>
          Select Process
        </h2>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 28, marginTop: 0 }}>
          Choose the factory process you want to work with in this session.
        </p>

        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          {/* A-20/1 */}
          <button
            type="button"
            onClick={() => choose("A20_1")}
            style={{
              flex: 1, padding: "22px 16px", borderRadius: 12,
              border: "2px solid #b5451b", background: "#fff8f3",
              cursor: "pointer", transition: "all 0.15s",
              color: "#b5451b",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#b5451b";
              (e.currentTarget as HTMLButtonElement).style.color = "#fff";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#fff8f3";
              (e.currentTarget as HTMLButtonElement).style.color = "#b5451b";
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>A-20/1</div>
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600 }}>Dombivli A-20/1</div>
            <div style={{ fontSize: 11, marginTop: 4, color: "#aaa" }}>Existing process</div>
          </button>

          {/* A-20 */}
          <button
            type="button"
            onClick={() => choose("A20")}
            style={{
              flex: 1, padding: "22px 16px", borderRadius: 12,
              border: "2px solid #1565c0", background: "#e3f2fd",
              cursor: "pointer", transition: "all 0.15s",
              color: "#1565c0",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#1565c0";
              (e.currentTarget as HTMLButtonElement).style.color = "#fff";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "#e3f2fd";
              (e.currentTarget as HTMLButtonElement).style.color = "#1565c0";
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>A-20</div>
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600 }}>Dombivli A-20</div>
            <div style={{ fontSize: 11, marginTop: 4, color: "#aaa" }}>New process</div>
          </button>
        </div>

        <p style={{ fontSize: 11, color: "#bbb", marginTop: 24, marginBottom: 0 }}>
          This selection is for local development only.
          Vercel deployments open their assigned process directly.
        </p>
      </div>
    </div>
  );
}
