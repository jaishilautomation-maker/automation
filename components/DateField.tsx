"use client";

// =============================================================================
// DateField — a locale-independent date input that ALWAYS shows DD/MM/YYYY.
//
// Why this exists:
//   The native <input type="date"> renders its visible text in the browser's
//   locale format (MM/DD/YYYY on US-locale machines), and HTML gives no way to
//   force DD/MM/YYYY. This component is a drop-in replacement that keeps the
//   same value contract as the native input — the value and onChange payload
//   are ALWAYS an ISO "YYYY-MM-DD" string — so no storage/logic downstream
//   changes. Only the on-screen format becomes DD/MM/YYYY everywhere.
//
// Usage (drop-in for <input type="date" value={d} onChange={e => set(e.target.value)} />):
//   <DateField value={d} onChange={setD} />
//
//   value:    ISO "YYYY-MM-DD" (or "" when empty) — same as the native input.
//   onChange: receives ISO "YYYY-MM-DD" (or "" when cleared).
//
// Behaviour:
//   - A text box shows/accepts DD/MM/YYYY. It auto-inserts the slashes as the
//     user types digits, and commits to ISO on blur / valid entry.
//   - A small 📅 button opens the browser's native calendar picker (via a
//     visually-hidden <input type="date">). Picking a day writes ISO straight
//     through — the text box reflects it as DD/MM/YYYY.
// =============================================================================

import { useRef, useState } from "react";

interface DateFieldProps {
  /** ISO date string "YYYY-MM-DD", or "" for empty. */
  value: string;
  /** Called with ISO "YYYY-MM-DD" (or "" when cleared). */
  onChange: (isoDate: string) => void;
  /** Fired after the field settles (parity with native onBlur handlers). */
  onBlur?: () => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  name?: string;
  /** Earliest allowed date, ISO "YYYY-MM-DD". */
  min?: string;
  /** Latest allowed date, ISO "YYYY-MM-DD". */
  max?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for reuse / testing)
// ---------------------------------------------------------------------------

/** ISO "YYYY-MM-DD" -> display "DD/MM/YYYY". Returns "" for empty/invalid. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/**
 * Display "DD/MM/YYYY" -> ISO "YYYY-MM-DD".
 * Returns "" if the string is not a complete, real calendar date.
 */
export function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((display ?? "").trim());
  if (!m) return "";
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  // Round-trip through Date to reject impossible days (e.g. 31/02/2024).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Auto-format raw keystrokes into "DD/MM/YYYY" as the user types digits. */
function maskTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8); // DDMMYYYY
  const parts: string[] = [];
  if (digits.length >= 2) {
    parts.push(digits.slice(0, 2));
    if (digits.length >= 4) {
      parts.push(digits.slice(2, 4));
      if (digits.length > 4) parts.push(digits.slice(4));
      else parts.push("");
    } else {
      parts.push(digits.slice(2));
    }
    return parts.join("/");
  }
  return digits;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DateField({
  value,
  onChange,
  onBlur,
  disabled,
  required,
  className,
  style,
  id,
  name,
  min,
  max,
}: DateFieldProps) {
  // The text the user sees/edits (DD/MM/YYYY), plus the last ISO value we
  // synced it against. Storing the previous prop in STATE (not a ref) is the
  // React-documented way to adjust state when a prop changes during render —
  // it avoids both setState-in-effect cascades and ref-access-in-render.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [text, setText] = useState<string>(() => isoToDisplay(value));
  const [lastValue, setLastValue] = useState<string>(value);
  const pickerRef = useRef<HTMLInputElement>(null);

  if (value !== lastValue) {
    // External change (reset, server load, parent update). A half-typed entry
    // is preserved because, mid-typing, `value` has not yet changed (onChange
    // only commits once a complete, valid date is entered).
    setLastValue(value);
    if (displayToIso(text) !== value) setText(isoToDisplay(value));
  }

  const handleTextChange = (raw: string) => {
    const masked = maskTyping(raw);
    setText(masked);
    const iso = displayToIso(masked);
    // Commit as soon as a complete, valid date is typed; clear when emptied.
    if (iso) onChange(iso);
    else if (masked === "") onChange("");
  };

  const handleBlur = () => {
    const iso = displayToIso(text);
    if (iso) {
      setText(isoToDisplay(iso)); // normalise (e.g. "1/2/2025" never reaches here, but be safe)
      onChange(iso);
    } else if (text.trim() === "") {
      onChange("");
    } else {
      // Incomplete/invalid entry — snap back to the last committed value.
      setText(isoToDisplay(value));
    }
    onBlur?.();
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el || disabled) return;
    // showPicker() is supported in modern browsers; fall back to focus+click.
    if (typeof el.showPicker === "function") {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
    el.click();
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", width: "100%" }}>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        aria-label="Date (DD/MM/YYYY)"
        value={text}
        disabled={disabled}
        required={required}
        className={className}
        style={{ paddingRight: 34, ...style }}
        onChange={e => handleTextChange(e.target.value)}
        onBlur={handleBlur}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open calendar"
        tabIndex={-1}
        style={{
          position: "absolute",
          right: 6,
          background: "none",
          border: "none",
          cursor: disabled ? "default" : "pointer",
          fontSize: 15,
          lineHeight: 1,
          padding: 2,
          opacity: disabled ? 0.4 : 0.8,
        }}
      >
        📅
      </button>
      {/* Visually hidden native picker — only used to surface the calendar UI.
          Its own text format is locale-driven but never shown to the user. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ""}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => {
          onChange(e.target.value);
          setText(isoToDisplay(e.target.value));
          onBlur?.();
        }}
        style={{
          position: "absolute",
          right: 6,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </span>
  );
}
