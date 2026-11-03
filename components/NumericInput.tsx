import React, { forwardRef } from "react";

interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode"> {
  /** Allow decimal places (default: true) */
  allowDecimal?: boolean;
  /** Allow negative values (default: false) */
  allowNegative?: boolean;
  /** Maximum decimal places to show in inputMode hint */
  maxDecimals?: number;
  /** Label for the field */
  label?: string;
  /** Error message to display */
  error?: string;
  /** Show error state */
  showError?: boolean;
}

/**
 * NumericInput — A controlled numeric input component.
 *
 * Renders as type="text" with inputMode="decimal" or "numeric" for proper
 * mobile keyboard handling. Prevents scroll-wheel value changes and arrow keys.
 * Sanitizes on change and paste: only digits and decimals allowed.
 *
 * Features:
 * - No up/down spinner arrows (keyboard or visual)
 * - Accepts only digits, decimal point (.), and optionally minus (-)
 * - Allows partial states while typing: "", "0.", ".5", etc.
 * - Paste sanitization: "0.0076 g" becomes "0.0076"
 * - Never reformats or rounds on input
 * - Preserves existing label/placeholder/error styling
 */
const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(
  (
    {
      allowDecimal = true,
      allowNegative = false,
      maxDecimals,
      label,
      error,
      showError = !!error,
      onChange,
      onKeyDown,
      onWheel,
      onPaste,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    /**
     * Sanitize input: keep only digits, decimal point, and optional minus.
     * Returns the sanitized string without reformatting.
     */
    const sanitize = (value: string): string => {
      if (!value) return "";

      // Replace comma with period
      let sanitized = value.replace(/,/g, ".");

      // Allow only digits, decimal point, and optionally minus
      if (allowNegative) {
        sanitized = sanitized.replace(/[^\d.\-]/g, "");
      } else {
        sanitized = sanitized.replace(/[^\d.]/g, "");
      }

      if (!allowDecimal) {
        sanitized = sanitized.replace(/\./g, "");
      } else {
        // Ensure only one decimal point
        const parts = sanitized.split(".");
        if (parts.length > 2) {
          sanitized = parts[0] + "." + parts.slice(1).join("");
        }
      }

      // Ensure minus is only at start
      if (allowNegative) {
        const minusCount = (sanitized.match(/-/g) || []).length;
        if (minusCount > 1) {
          sanitized = sanitized.replace(/-/g, "");
          if (parseFloat(value) < 0) sanitized = "-" + sanitized;
        } else if (sanitized.indexOf("-") > 0) {
          sanitized = sanitized.replace(/-/g, "");
        }
      }

      return sanitized;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitize(e.target.value);
      if (onChange) {
        // Fire change with sanitized value
        onChange({
          ...e,
          target: { ...e.target, value: sanitized },
        } as React.ChangeEvent<HTMLInputElement>);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Block Arrow Up/Down keys (no increments/decrements)
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        return;
      }

      if (onKeyDown) {
        onKeyDown(e);
      }
    };

    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      // Prevent scroll-wheel from changing value
      e.currentTarget.blur();
      if (onWheel) {
        onWheel(e);
      }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedText = e.clipboardData.getData("text");
      const sanitized = sanitize(pastedText);

      // Manually update input value and trigger change
      const input = e.currentTarget;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;

      const newValue =
        input.value.substring(0, start) +
        sanitized +
        input.value.substring(end);

      const sanitizedFinal = sanitize(newValue);

      if (onChange) {
        onChange({
          ...e,
          target: { ...input, value: sanitizedFinal },
        } as unknown as React.ChangeEvent<HTMLInputElement>);
      }

      if (onPaste) {
        onPaste(e);
      }
    };

    const inputMode = allowDecimal ? "decimal" : "numeric";

    return (
      <div style={style ? { display: "flex", flexDirection: "column", ...style } : { display: "flex", flexDirection: "column" }}>
        {label && (
          <label
            style={{
              marginBottom: 4,
              fontSize: 13,
              fontWeight: 500,
              color: "#333",
            }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          onPaste={handlePaste}
          {...rest}
          style={{
            padding: "8px 12px",
            fontSize: 14,
            border: showError ? "1px solid #d32f2f" : "1px solid #ccc",
            borderRadius: "4px",
            fontFamily: "inherit",
            ...style,
          }}
        />
        {showError && error && (
          <span
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "#d32f2f",
            }}
          >
            {error}
          </span>
        )}
      </div>
    );
  },
);

NumericInput.displayName = "NumericInput";

export default NumericInput;
