import { z } from "zod";

/** "YYYY-MM-DD" that is a real calendar date (no 30 Feb). */
export const isoDay = (msg = "date must be YYYY-MM-DD") =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, msg)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, "That date doesn't exist");
