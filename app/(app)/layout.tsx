import type React from "react";
import AppHeader from "@/components/AppHeader";
import AppNav from "@/components/AppNav";
import StatusBar from "@/components/StatusBar";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <AppNav />
      <main className="app-main">{children}</main>
      <StatusBar />
    </>
  );
}
