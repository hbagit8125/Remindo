import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      <Suspense fallback={null}>{children}</Suspense>
    </AppShell>
  );
}
