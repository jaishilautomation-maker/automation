import type React from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Factory name is resolved at build time from NEXT_PUBLIC_FACTORY_NAME env var.
// Each Vercel deployment sets its own value; defaults to "Dombivli A-20/1".
const factoryName = process.env.NEXT_PUBLIC_FACTORY_NAME ?? "Dombivli A-20/1";

export const metadata: Metadata = {
  title: `JSCI · ${factoryName}`,
  description: `Job card and quality control system — JSCI ${factoryName}`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
