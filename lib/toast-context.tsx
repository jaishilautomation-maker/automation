"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

interface ToastContextValue {
  showToast: (msg: string, isWarn?: boolean) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [isWarn, setIsWarn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, warn = false) => {
    setMessage(msg);
    setIsWarn(warn);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="toast"
        style={{ background: isWarn ? "var(--warn)" : "var(--ok)" }}
        aria-live="polite"
        aria-atomic="true"
        role="status"
        data-visible={visible}
        // We drive visibility via CSS class
        ref={(el) => {
          if (!el) return;
          if (visible) el.classList.add("show");
          else el.classList.remove("show");
        }}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
