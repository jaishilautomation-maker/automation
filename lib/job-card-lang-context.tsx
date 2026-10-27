"use client";
// =============================================================================
// LanguageContext — shared Hindi/English toggle for the Operator Section.
// Provided by production-job-card/page.tsx, consumed by all 6 job card forms.
// =============================================================================
import { createContext, useContext } from "react";

export type JobCardLang = "en" | "hi";

export const LanguageContext = createContext<JobCardLang>("en");

export function useJobCardLang(): JobCardLang {
  return useContext(LanguageContext);
}
