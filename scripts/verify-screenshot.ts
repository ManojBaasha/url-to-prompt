import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureScreenshots } from "../lib/screenshot.js";

async function main(): Promise<void> {
  const url = "https://example.com";
  console.log(`→ Capturing screenshots of ${url}...`);

  const { aboveFold, midPage, fullPage, meta } = await captureScreenshots(url);

  const outDir = join(process.cwd(), "tmp");
  await mkdir(outDir, { recursive: true });

  const outputs: Array<[string, Buffer]> = [
    ["above.png", aboveFold],
    ["mid.png", midPage],
    ["full.png", fullPage],
  ];

  for (const [name, buf] of outputs) {
    const p = join(outDir, name);
    await writeFile(p, buf);
    console.log(`  wrote ${p} (${buf.byteLength} bytes)`);
  }

  console.log("meta:", meta);
  console.log("OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
