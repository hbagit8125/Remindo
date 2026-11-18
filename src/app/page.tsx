import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Dashboard />
    </Suspense>
  );
}
