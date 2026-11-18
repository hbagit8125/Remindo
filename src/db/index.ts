import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

/** Lazily connect so builds don't need DATABASE_URL. */
export function db() {
  // Integration tests inject an in-memory database here.
  const testDb = (globalThis as { __testDb?: NeonHttpDatabase<typeof schema> }).__testDb;
  if (testDb) return testDb;
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}

export * from "./schema";
