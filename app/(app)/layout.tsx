import type React from "react";
import AppHeader from "@/components/AppHeader";
import AppNav from "@/components/AppNav";
import StatusBar from "@/components/StatusBar";
import DefaultPlaceholders from "@/components/DefaultPlaceholders";
import { ModuleProvider } from "@/lib/module-context";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleProvider>
      <AppHeader />
      <AppNav />
      <main className="app-main">{children}</main>
      <StatusBar />
      <DefaultPlaceholders />
    </ModuleProvider>
  );
}
