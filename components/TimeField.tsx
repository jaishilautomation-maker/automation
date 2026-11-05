"use client";

// =============================================================================
// TimeField — a locale-independent time input that ALWAYS shows 12-hour
// hh:mm AM/PM format, while storing and emitting 24-hour HH:MM strings.
//
// Why this exists:
//   The native <input type="time"> renders in 24-hour format on most systems.
//   This component is a drop-in replacement that keeps the same value contract
//   — the value and onChange payload are ALWAYS a 24-hour "HH:MM" string or ""
//   — so no storage or downstream logic changes are required. Only the on-screen
//   format becomes 12-hour hh:mm AM/PM everywhere.
//
// Usage (drop-in for <input type="time" value={t} onChange={e => set(e.target.value)} />):
//   <TimeField value={t} onChange={setT} />
//
//   value:    24-hour "HH:MM" string (e.g. "14:30"), or "" for empty.
//   onChange: called with 24-hour "HH:MM" string (e.g. "14:30"), or "".
//
// Design notes on controlled-input pitfalls (minutes specifically):
//   React controlled inputs reset the DOM cursor/selection on every re-render.
//   For a 2-digit accumulator (type the tens digit then the units digit), if
//   the first keystroke triggers a state update + re-render before the second
//   keystroke lands, React may replace the DOM value with the current state
//   ("1") and reset the cursor. The second keystroke then fires onChange with
//   just "5" instead of the expected "15", making every minute appear as the
//   first digit only (padded to "0X").
//
//   Fix: both hour and minute inputs are driven by React refs (uncontrolled
//   DOM) during live editing. React state is only updated when a full value
//   is committed (2 digits entered, blur, or arrow key). External prop changes
//   (e.g. loading a saved record) sync via useEffect by writing directly to
//   the DOM input via the ref, bypassing React's controlled reconciliation.
//
// Conversion helpers are exported for use in display-only contexts (records,
// reports) where only a formatted string is needed without an interactive input.
// =============================================================================

import { useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Pure conversion helpers (exported)
// ---------------------------------------------------------------------------

/**
 * Convert a 24-hour "HH:MM" string to display "hh:mm AM/PM".
 * Returns "" for empty / invalid input.
 *
 * Examples:
 *   "09:30" → "09:30 AM"
 *   "13:45" → "01:45 PM"
 *   "00:00" → "12:00 AM"
 *   "12:00" → "12:00 PM"
 */
export function to12h(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${String(h).padStart(2, "0")}:${min} ${period}`;
}

/**
 * Convert display "hh:mm AM/PM" (or any 12-hour representation) back to
 * 24-hour "HH:MM". Returns "" for empty / invalid input.
 *
 * Accepts: "09:30 AM", "12:00 PM", "01:45 PM", "12:00 AM"
 */
export function from12h(display: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((display ?? "").trim());
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2]);
  const period = m[3].toUpperCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return "";
  if (period === "AM") {
    if (h === 12) h = 0;
  } else {
    if (h !== 12) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(hhmm: string): { hh: string; mm: string; period: "AM" | "PM" } {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return { hh: "", mm: "", period: "AM" };
  let h = Number(m[1]);
  const min = m[2];
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return { hh: String(h).padStart(2, "0"), mm: min, period };
}

/** Build a 24-hour HH:MM string from 12-hour parts. Returns "" if incomplete. */
function to24(hhStr: string, mmStr: string, period: "AM" | "PM"): string {
  if (!hhStr || !mmStr) return "";
  let h = Number(hhStr);
  const min = Number(mmStr);
  if (isNaN(h) || isNaN(min) || min < 0 || min > 59 || h < 1 || h > 12) return "";
  if (period === "AM") { if (h === 12) h = 0; }
  else                 { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TimeFieldProps {
  /** 24-hour "HH:MM" string, or "" for empty. */
  value: string;
  /** Called with 24-hour "HH:MM" string, or "" when cleared. */
  onChange: (hhmm: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
}

export default function TimeField({
  value,
  onChange,
  disabled,
  style,
  className,
  id,
}: TimeFieldProps) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  // We use uncontrolled DOM refs for the two text inputs so that React's
  // controlled-input reconciliation never clobbers mid-entry state.
  // The period <select> is still value-driven because it only ever holds a
  // fully-committed value (no partial entry).
  const hhRef     = useRef<HTMLInputElement>(null);
  const mmRef     = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLSelectElement>(null);

  // Track what we last emitted so that the external-sync effect can tell
  // whether a new `value` prop is genuinely external or our own echo.
  const lastEmittedRef = useRef<string>(value);

  // ── Initial render: populate DOM from prop ─────────────────────────────────
  // This runs once on mount. After that the sync effect handles updates.
  useEffect(() => {
    const p = parse(value);
    if (hhRef.current)     hhRef.current.value     = p.hh;
    if (mmRef.current)     mmRef.current.value     = p.mm;
    if (periodRef.current) periodRef.current.value = p.period;
    lastEmittedRef.current = value;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── External-value sync ────────────────────────────────────────────────────
  // Fires when the `value` prop changes. We only update the DOM if the new
  // value is genuinely external (not our own emit echoing back through the
  // parent's useState), so mid-entry keystrokes are never disrupted.
  useEffect(() => {
    if (value === lastEmittedRef.current) return; // our own echo — ignore
    const p = parse(value);
    if (hhRef.current)     hhRef.current.value     = p.hh;
    if (mmRef.current)     mmRef.current.value     = p.mm;
    if (periodRef.current) periodRef.current.value = p.period;
    lastEmittedRef.current = value;
  }, [value]);

  // ── Emit helper ────────────────────────────────────────────────────────────
  const emit = useCallback(
    (hhStr: string, mmStr: string, period: "AM" | "PM") => {
      const result = to24(hhStr, mmStr, period);
      lastEmittedRef.current = result;
      onChange(result);
    },
    [onChange],
  );

  // Helper to read the current period value from the select DOM node.
  function currentPeriod(): "AM" | "PM" {
    return (periodRef.current?.value ?? "AM") as "AM" | "PM";
  }

  // ── Hours handlers ─────────────────────────────────────────────────────────
  function handleHhChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw    = e.target.value;
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (!digits) {
      e.target.value = "";
      emit("", mmRef.current?.value ?? "", currentPeriod());
      return;
    }
    const n = Number(digits);
    if (n > 12) {
      // Restore previous valid value in DOM.
      e.target.value = hhRef.current?.dataset.last ?? "";
      return;
    }
    // Decide whether we have a complete hour yet.
    const complete = digits.length === 2 || (digits.length === 1 && n >= 2);
    if (complete) {
      const padded = digits.length === 1 ? `0${digits}` : digits;
      e.target.value                   = padded;
      (e.target as HTMLInputElement & { dataset: DOMStringMap }).dataset.last = padded;
      emit(padded, mmRef.current?.value ?? "", currentPeriod());
      if (padded !== "00") {
        // Clear minutes and move focus so the user enters fresh digits.
        if (mmRef.current) {
          mmRef.current.value = "";
        }
        mmRef.current?.focus();
      }
    } else {
      // Still waiting for second digit (only "0" or "1" here).
      e.target.value                   = digits;
      (e.target as HTMLInputElement & { dataset: DOMStringMap }).dataset.last = digits;
      // Emit with padded hour so parent has a value, but don't advance focus.
      emit(digits, mmRef.current?.value ?? "", currentPeriod());
    }
  }

  function handleHhKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = Number(hhRef.current?.value) || 12;
      let next = e.key === "ArrowUp" ? cur + 1 : cur - 1;
      if (next > 12) next = 1;
      if (next < 1)  next = 12;
      const padded = String(next).padStart(2, "0");
      if (hhRef.current) hhRef.current.value = padded;
      emit(padded, mmRef.current?.value ?? "", currentPeriod());
    }
    if (e.key === "Tab" && !e.shiftKey) {
      // Let native tab move focus to mm; blur will handle any pending emit.
    }
  }

  function handleHhBlur() {
    const val = hhRef.current?.value ?? "";
    if (val && val.length === 1) {
      const padded = `0${val}`;
      if (hhRef.current) hhRef.current.value = padded;
      emit(padded, mmRef.current?.value ?? "", currentPeriod());
    }
  }

  // ── Minutes handlers ───────────────────────────────────────────────────────
  // Key insight: we accumulate digits in the DOM input directly without going
  // through React state. The DOM input is never reset by React reconciliation
  // because it is uncontrolled (no `value` prop). We only read its current
  // value from the ref when we need to emit to the parent.
  function handleMmChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw    = e.target.value;
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    if (!digits) {
      e.target.value = "";
      // Do not emit — an empty minute means incomplete time; parent keeps "".
      lastEmittedRef.current = "";
      onChange("");
      return;
    }
    const n = Number(digits);
    if (n > 59) {
      // Reject: restore the last good value.
      e.target.value = e.target.dataset.last ?? "";
      return;
    }
    // Write the cleaned digits back to the DOM (handles non-numeric paste etc.)
    e.target.value          = digits;
    e.target.dataset.last   = digits;

    if (digits.length === 2) {
      // Complete — emit and advance to AM/PM.
      emit(hhRef.current?.value ?? "", digits, currentPeriod());
      periodRef.current?.focus();
    }
    // Single digit: just let it sit in the DOM. No emit, no state update.
    // The second digit will complete the pair and trigger emit above.
  }

  function handleMmKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = Number(mmRef.current?.value) || 0;
      let next = e.key === "ArrowUp" ? cur + 1 : cur - 1;
      if (next > 59) next = 0;
      if (next < 0)  next = 59;
      const padded = String(next).padStart(2, "0");
      if (mmRef.current) mmRef.current.value = padded;
      emit(hhRef.current?.value ?? "", padded, currentPeriod());
    }
    if (e.key === "Backspace") {
      const cur = mmRef.current?.value ?? "";
      if (!cur) {
        // Field already empty — move back to hours.
        hhRef.current?.focus();
      }
      // Otherwise let the browser delete the last character normally;
      // handleMmChange will fire and handle the result.
    }
  }

  function handleMmBlur() {
    // Commit whatever is in the minute field when the user leaves it.
    const val = mmRef.current?.value ?? "";
    if (!val) return; // nothing typed — leave as empty
    const padded = val.length === 1 ? `0${val}` : val;
    if (mmRef.current) mmRef.current.value = padded;
    emit(hhRef.current?.value ?? "", padded, currentPeriod());
  }

  // ── AM/PM handlers ─────────────────────────────────────────────────────────
  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value as "AM" | "PM";
    emit(hhRef.current?.value ?? "", mmRef.current?.value ?? "", val);
  }

  function handlePeriodKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      if (periodRef.current) periodRef.current.value = "AM";
      emit(hhRef.current?.value ?? "", mmRef.current?.value ?? "", "AM");
    }
    if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (periodRef.current) periodRef.current.value = "PM";
      emit(hhRef.current?.value ?? "", mmRef.current?.value ?? "", "PM");
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0,
    border: "1px solid var(--line, #ddd)",
    borderRadius: 8,
    overflow: "hidden",
    background: disabled ? "var(--surface, #f5f5f5)" : "#fff",
    opacity: disabled ? 0.6 : 1,
    height: 40,
    ...(style ?? {}),
  };

  const segStyle: React.CSSProperties = {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 14,
    textAlign: "center" as const,
    padding: "0 4px",
    height: "100%",
    color: "var(--ink, #333)",
    cursor: disabled ? "not-allowed" : "text",
  };

  const sepStyle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--ink-soft, #999)",
    padding: "0 1px",
    userSelect: "none",
    lineHeight: 1,
  };

  const periodStyle: React.CSSProperties = {
    border: "none",
    borderLeft: "1px solid var(--line, #ddd)",
    outline: "none",
    background: "var(--surface, #f5f5f5)",
    fontSize: 13,
    fontWeight: 700,
    padding: "0 8px 0 6px",
    height: "100%",
    color: "var(--ink, #333)",
    cursor: disabled ? "not-allowed" : "pointer",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    minWidth: 56,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // Both text inputs are intentionally uncontrolled (no `value` / `defaultValue`
  // props here — initial population and external-sync happen via refs in the
  // useEffect hooks above). The <select> is also uncontrolled for the same
  // reason; its initial value is set in the mount effect.
  return (
    <div style={containerStyle} className={className}>
      <input
        ref={hhRef}
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="hh"
        maxLength={2}
        disabled={disabled}
        onChange={handleHhChange}
        onKeyDown={handleHhKeyDown}
        onFocus={e => e.target.select()}
        onBlur={handleHhBlur}
        style={{ ...segStyle, width: 34 }}
        aria-label="Hours"
      />
      <span style={sepStyle}>:</span>
      <input
        ref={mmRef}
        type="text"
        inputMode="numeric"
        placeholder="mm"
        maxLength={2}
        disabled={disabled}
        onChange={handleMmChange}
        onKeyDown={handleMmKeyDown}
        onFocus={e => e.target.select()}
        onBlur={handleMmBlur}
        style={{ ...segStyle, width: 34 }}
        aria-label="Minutes"
      />
      <select
        ref={periodRef}
        disabled={disabled}
        onChange={handlePeriodChange}
        onKeyDown={handlePeriodKeyDown}
        style={periodStyle}
        aria-label="AM or PM"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
