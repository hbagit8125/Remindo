import { Suspense } from "react";
import { ListsRoute } from "@/components/screens/LifeScreens";

export default function Page() {
  return (
    <Suspense>
      <ListsRoute />
    </Suspense>
  );
}
