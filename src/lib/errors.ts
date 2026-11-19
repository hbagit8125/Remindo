import { sendEmail, layout, esc } from "./email";
import { shouldAlert } from "./settings";
import { sendTelegram, h } from "./telegram";

/**
 * Tell you when something behind the scenes breaks (a cron job, a delivery that
 * keeps failing). At most one alert per job per hour. Tries email and Telegram,
 * so one broken channel can't hide the problem.
 */
export async function reportError(job: string, message: string) {
  console.error(`[remindo:${job}]`, message);
  try {
    if (!(await shouldAlert(job))) return;
  } catch {
    // If the database itself is down we still try to tell you.
  }
  await Promise.allSettled([
    sendEmail(
      `⚠️ Remindo: ${job} failed`,
      layout(
        `Something went wrong: ${job}`,
        `<pre style="white-space:pre-wrap;font-size:13px;background:#f3f4f6;border-radius:8px;padding:12px;color:#374151">${esc(message.slice(0, 2000))}</pre>
         <p style="font-size:13px;color:#6b7280">Check <b>Vercel → Logs</b> for details. You'll get at most one of these per hour for this job.</p>`,
      ),
    ),
    sendTelegram(`⚠️ <b>Remindo: ${h(job)} failed</b>\n<code>${h(message.slice(0, 500))}</code>`),
  ]);
}

/** Wrap a cron handler so failures are reported instead of silently returning 500. */
export async function runJob<T>(job: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    const msg = (e as Error).stack || String(e);
    await reportError(job, msg);
    return { error: (e as Error).message };
  }
}

