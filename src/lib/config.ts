export const config = {
  tz: process.env.APP_TIMEZONE || "Asia/Kolkata",
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  notifyEmail: process.env.NOTIFY_EMAIL || "",
  emailFrom: process.env.EMAIL_FROM || "Remindo <onboarding@resend.dev>",
  /** Minutes between escalation re-sends for unacknowledged high-priority reminders. */
  escalateAfterMin: Number(process.env.ESCALATE_AFTER_MIN || 30),
  maxEscalations: Number(process.env.MAX_ESCALATIONS || 2),
  /** Hour (local) used for all-day reminders such as birthdays. */
  allDayHour: process.env.ALL_DAY_TIME || "09:00",
};

export const DEFAULT_LEAD_TIMES: Record<string, number[]> = {
  high: [7 * 24 * 60, 24 * 60, 0],
  normal: [0],
  low: [0],
};

export function secret(name: "AUTH_SECRET" | "CRON_SECRET") {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
