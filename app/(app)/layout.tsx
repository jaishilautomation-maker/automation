import type React from "react";
import AppHeader from "@/components/AppHeader";
import AppNav from "@/components/AppNav";
import StatusBar from "@/components/StatusBar";
import DefaultPlaceholders from "@/components/DefaultPlaceholders";
import AuthGate from "@/components/AuthGate";
import { ModuleProvider } from "@/lib/module-context";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  // AuthGate guards every (app) route: it shows a bounded spinner while auth
  // resolves, redirects to /login when the session is missing/expired (instead
  // of hanging), and hosts the 90-min idle-logout watcher.
  return (
    <ModuleProvider>
      <AuthGate>
        <AppHeader />
        <AppNav />
        <main className="app-main">{children}</main>
        <StatusBar />
        <DefaultPlaceholders />
      </AuthGate>
    </ModuleProvider>
  );
}
