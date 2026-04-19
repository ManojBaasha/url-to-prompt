import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateDesignPrompt } from "../lib/vision.js";

async function main(): Promise<void> {
  const tmpDir = join(process.cwd(), "tmp");

  console.log(`→ Reading screenshots from ${tmpDir}...`);
  const [aboveFold, midPage, fullPage] = await Promise.all([
    readFile(join(tmpDir, "above.png")),
    readFile(join(tmpDir, "mid.png")),
    readFile(join(tmpDir, "full.png")),
  ]);

  console.log(
    `  above: ${aboveFold.byteLength} bytes | mid: ${midPage.byteLength} bytes | full: ${fullPage.byteLength} bytes`
  );

  console.log("→ Calling generateDesignPrompt...");
  const result = await generateDesignPrompt({ aboveFold, midPage, fullPage });

  console.log("→ Result:");
  console.dir(result, { depth: null });

  console.log("OK");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
