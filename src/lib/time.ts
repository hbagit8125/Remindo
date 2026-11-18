import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { config } from "./config";

const TZ = () => config.tz;

/** Wall-clock time in the app timezone, as a Date whose UTC fields hold that wall time. */
export function toFakeUtc(d: Date, tz = TZ()): Date {
  return new Date(formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm:ss") + "Z");
}

/** Inverse of toFakeUtc. */
export function fromFakeUtc(d: Date, tz = TZ()): Date {
  return fromZonedTime(d.toISOString().slice(0, 19), tz);
}

/** "2026-11-20" + "16:30" in the app timezone -> real instant. */
export function localToUtc(date: string, time: string, tz = TZ()): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? time + ":00" : time}`, tz);
}

export function fmtLocal(d: Date, pattern: string, tz = TZ()) {
  return formatInTimeZone(d, tz, pattern);
}

/** Start and end (exclusive) of the local day containing `d`, plus `offsetDays`. */
export function localDayBounds(d: Date, offsetDays = 0, tz = TZ()) {
  const day = formatInTimeZone(new Date(d.getTime() + offsetDays * 86400000), tz, "yyyy-MM-dd");
  const start = fromZonedTime(`${day}T00:00:00`, tz);
  const end = new Date(start.getTime() + 86400000);
  return { day, start, end };
}

export function localNowContext(now = new Date(), tz = TZ()) {
  return {
    date: formatInTimeZone(now, tz, "yyyy-MM-dd"),
    time: formatInTimeZone(now, tz, "HH:mm"),
    weekday: formatInTimeZone(now, tz, "EEEE"),
    tz,
  };
}
