import { RRule } from "rrule";
import { fromFakeUtc, toFakeUtc } from "./time";

export type Schedulable = {
  id: string;
  dueAt: Date;
  rrule: string | null;
  leadTimes: number[];
  version: number;
};

/** Occurrences of a reminder whose time falls in [from, to]. */
export function occurrencesBetween(r: Pick<Schedulable, "dueAt" | "rrule">, from: Date, to: Date): Date[] {
  if (!r.rrule) {
    return r.dueAt >= from && r.dueAt <= to ? [r.dueAt] : [];
  }
  // rrule works on UTC fields, so run it on local wall-clock time and convert back.
  // This keeps "every day at 9am" at 9am local time.
  const rule = new RRule({ ...RRule.parseString(r.rrule), dtstart: toFakeUtc(r.dueAt) });
  return rule.between(toFakeUtc(from), toFakeUtc(to), true).map((d) => fromFakeUtc(d));
}

export type PlannedAlert = {
  reminderId: string;
  occurrenceAt: Date;
  alertAt: Date;
  leadMinutes: number;
  dedupeKey: string;
};

export function alertKey(r: Pick<Schedulable, "id" | "version">, occ: Date, lead: number) {
  return `${r.id}:v${r.version}:${occ.toISOString()}:L${lead}`;
}

/** Every alert (occurrence minus lead time) whose send time falls in [from, to]. */
export function alertsBetween(r: Schedulable, from: Date, to: Date): PlannedAlert[] {
  const maxLead = Math.max(0, ...r.leadTimes);
  const occs = occurrencesBetween(r, from, new Date(to.getTime() + maxLead * 60000));
  const out: PlannedAlert[] = [];
  for (const occ of occs) {
    for (const lead of r.leadTimes) {
      const alertAt = new Date(occ.getTime() - lead * 60000);
      if (alertAt >= from && alertAt <= to) {
        out.push({ reminderId: r.id, occurrenceAt: occ, alertAt, leadMinutes: lead, dedupeKey: alertKey(r, occ, lead) });
      }
    }
  }
  return out.sort((a, b) => a.alertAt.getTime() - b.alertAt.getTime());
}

export function describeRrule(rrule: string | null): string {
  if (!rrule) return "";
  try {
    return RRule.fromString(rrule).toText();
  } catch {
    return "repeats";
  }
}
