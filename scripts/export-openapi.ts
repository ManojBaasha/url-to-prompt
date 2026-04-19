import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

async function main(): Promise<void> {
  const url = process.env.OPENAPI_URL ?? "http://localhost:3000/api/openapi.json";
  console.log(`→ Fetching ${url}...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const doc = await res.json();
  const yaml = YAML.stringify(doc);

  const outPath = join(process.cwd(), "api", "openapi-snapshot.yaml");
  await writeFile(outPath, yaml);
  console.log(`  wrote ${outPath} (${yaml.length} bytes)`);

  const paths = Object.keys((doc as { paths?: Record<string, unknown> }).paths ?? {});
  console.log("  paths:", paths);
  console.log("OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
