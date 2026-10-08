"use client";

// =============================================================================
// DefaultPlaceholders — gives every text-like form field a default placeholder
// ("यहाँ लिखो") when it doesn't already have one.
//
// Why a runtime helper instead of CSS:
//   HTML placeholders live on the element's `placeholder` attribute; CSS cannot
//   inject the TEXT (::placeholder only styles existing placeholder text).
//   Rather than hand-edit hundreds of inputs across every page, this component
//   mounts once in the (app) layout and stamps a default placeholder on any
//   text/number/email/password/search/tel/url input and <textarea> that is
//   missing one. Inputs that already define a specific placeholder (e.g.
//   "जैसे 780") are left untouched.
//
// Excluded on purpose: date/time/select/checkbox/radio/file/number-spinners
//   where a placeholder is meaningless or not rendered. (number IS included —
//   browsers do render its placeholder when empty.)
// =============================================================================

import { useEffect } from "react";

const DEFAULT_PLACEHOLDER = "यहाँ लिखो";

// input types that visibly render a placeholder
const TEXT_LIKE_TYPES = new Set([
  "text", "number", "email", "password", "search", "tel", "url", "",
]);

function stampField(el: HTMLInputElement | HTMLTextAreaElement) {
  // Skip if it already has a non-empty placeholder.
  const existing = el.getAttribute("placeholder");
  if (existing && existing.trim() !== "") return;

  if (el.tagName === "TEXTAREA") {
    el.setAttribute("placeholder", DEFAULT_PLACEHOLDER);
    return;
  }
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  if (TEXT_LIKE_TYPES.has(type)) {
    el.setAttribute("placeholder", DEFAULT_PLACEHOLDER);
  }
}

function stampAll(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    .forEach(stampField);
}

export default function DefaultPlaceholders() {
  useEffect(() => {
    // Initial pass over whatever is already rendered.
    stampAll(document);

    // Re-stamp as new fields mount (route changes, conditional sections, rows).
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as Element;
          if (el.matches("input, textarea")) {
            stampField(el as HTMLInputElement | HTMLTextAreaElement);
          }
          // Also check descendants of the added subtree.
          stampAll(el);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
