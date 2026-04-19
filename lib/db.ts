import { sql } from "@vercel/postgres";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export { sql };

export async function runMigration(): Promise<void> {
  const migrationPath = join(__dirname, "..", "migrations", "001_init.sql");
  const migrationSql = await readFile(migrationPath, "utf-8");

  const statements = migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sql.query(stmt);
  }
}
