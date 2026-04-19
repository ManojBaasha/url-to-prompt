import { runMigration, sql } from "../lib/db.js";
import {
  getCachedPrompt,
  setCachedPrompt,
  type CachedPrompt,
  type SetCachedPromptInput,
} from "../lib/cache.js";

const FIXTURE_HASH = "v".repeat(64);

const FIXTURE: SetCachedPromptInput = {
  urlHash: FIXTURE_HASH,
  normalizedUrl: "https://example.com/verify-db",
  originalUrl: "https://example.com/verify-db?utm_source=test",
  prompt: { title: "Example", sections: ["hero", "features"] },
  modelUsed: "claude-opus-4-7",
  screenshotCount: 2,
  ttlDays: 7,
};

function assertRowMatchesFixture(row: CachedPrompt): void {
  const mismatches: string[] = [];
  if (row.url_hash !== FIXTURE.urlHash) mismatches.push(`url_hash: ${row.url_hash}`);
  if (row.normalized_url !== FIXTURE.normalizedUrl)
    mismatches.push(`normalized_url: ${row.normalized_url}`);
  if (row.original_url !== FIXTURE.originalUrl)
    mismatches.push(`original_url: ${row.original_url}`);
  if (row.model_used !== FIXTURE.modelUsed) mismatches.push(`model_used: ${row.model_used}`);
  if (row.screenshot_count !== FIXTURE.screenshotCount)
    mismatches.push(`screenshot_count: ${row.screenshot_count}`);
  if (JSON.stringify(row.prompt) !== JSON.stringify(FIXTURE.prompt))
    mismatches.push(`prompt: ${JSON.stringify(row.prompt)}`);
  if (mismatches.length > 0) {
    throw new Error(`Row does not match fixture: ${mismatches.join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log("→ Running migration...");
  await runMigration();

  console.log("→ Clearing any previous fixture row...");
  await sql`DELETE FROM design_prompts WHERE url_hash = ${FIXTURE_HASH}`;

  console.log("→ Inserting fixture via setCachedPrompt...");
  await setCachedPrompt(FIXTURE);

  console.log("→ First getCachedPrompt — expect hit_count = 1...");
  const first = await getCachedPrompt(FIXTURE_HASH);
  if (!first) throw new Error("Expected cached prompt on first read, got null");
  assertRowMatchesFixture(first);
  if (first.hit_count !== 1) {
    throw new Error(`Expected hit_count=1 after first read, got ${first.hit_count}`);
  }

  console.log("→ Second getCachedPrompt — expect hit_count = 2...");
  const second = await getCachedPrompt(FIXTURE_HASH);
  if (!second) throw new Error("Expected cached prompt on second read, got null");
  if (second.hit_count !== 2) {
    throw new Error(`Expected hit_count=2 after second read, got ${second.hit_count}`);
  }

  console.log("→ Cleaning up fixture row...");
  await sql`DELETE FROM design_prompts WHERE url_hash = ${FIXTURE_HASH}`;

  console.log("OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
