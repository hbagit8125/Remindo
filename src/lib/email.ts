import { Resend } from "resend";
import { config } from "./config";

let _resend: Resend | null = null;
function resend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export async function sendEmail(subject: string, html: string) {
  if (!config.notifyEmail) throw new Error("NOTIFY_EMAIL is not set");
  const { data, error } = await resend().emails.send({
    from: config.emailFrom,
    to: [config.notifyEmail],
    subject,
    html,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return data?.id;
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ACCENT: Record<string, string> = { high: "#f43f5e", normal: "#6366f1", low: "#64748b" };

export function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="font-size:13px;color:#6b7280;margin-bottom:8px">⏰ Remindo</div>
  <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(title)}</h1>
    ${body}
  </div>
  <div style="font-size:12px;color:#9ca3af;margin-top:12px;text-align:center">
    <a href="${config.appUrl}" style="color:#6366f1;text-decoration:none">Open dashboard</a>
  </div>
</div></body></html>`;
}

function button(href: string, label: string, primary = false) {
  const style = primary
    ? "background:#111827;color:#fff"
    : "background:#f3f4f6;color:#111827";
  return `<a href="${href}" style="${style};display:inline-block;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;margin:0 8px 8px 0">${label}</a>`;
}

export function reminderEmail(opts: {
  title: string;
  notes: string | null;
  priority: string;
  whenText: string;
  headline: string;
  links: { done: string; snooze15: string; snooze60: string; tomorrow: string };
}) {
  const color = ACCENT[opts.priority] || ACCENT.normal;
  const body = `
    <div style="border-left:4px solid ${color};padding:4px 0 4px 12px;margin-bottom:16px">
      <div style="font-size:14px;color:${color};font-weight:600;text-transform:uppercase;letter-spacing:.04em">${esc(opts.headline)}</div>
      <div style="font-size:15px;color:#374151;margin-top:4px">${esc(opts.whenText)}</div>
    </div>
    ${opts.notes ? `<p style="font-size:14px;color:#4b5563;white-space:pre-wrap;margin:0 0 16px">${esc(opts.notes)}</p>` : ""}
    <div>
      ${button(opts.links.done, "✓ Done", true)}
      ${button(opts.links.snooze15, "Snooze 15m")}
      ${button(opts.links.snooze60, "Snooze 1h")}
      ${button(opts.links.tomorrow, "Tomorrow")}
    </div>`;
  return layout(opts.title, body);
}

export type DigestItem = { title: string; when: string; priority: string; tag?: string };

export function digestSection(heading: string, items: DigestItem[], empty?: string) {
  if (!items.length && !empty) return "";
  const rows = items.length
    ? items
        .map(
          (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;width:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${ACCENT[i.priority] || ACCENT.normal}"></span></td>
        <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:14px">${esc(i.title)}${i.tag ? ` <span style="font-size:11px;color:#6b7280;background:#f3f4f6;border-radius:6px;padding:2px 6px">${esc(i.tag)}</span>` : ""}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-align:right;white-space:nowrap">${esc(i.when)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td style="font-size:14px;color:#9ca3af;padding:8px 0">${esc(empty!)}</td></tr>`;
  return `<h2 style="font-size:14px;margin:20px 0 4px;color:#374151">${esc(heading)}</h2><table style="width:100%;border-collapse:collapse">${rows}</table>`;
}
