import { redirect } from "next/navigation";

/** Old address; reminders now live under Plan. */
export default function Page() {
  redirect("/plan?view=reminders");
}
