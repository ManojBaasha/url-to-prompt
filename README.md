# url-to-prompt

Give it a URL, get back a structured JSON "design prompt" describing the site's visual design language — typography, palette, layout, components, mood. Under the hood it screenshots the page in three viewport positions with headless Chromium, sends the images to Claude Sonnet 4.6 via tool-use for schema-validated output, and caches the result in Postgres keyed by a normalized URL hash. Exposes a Hono API on Vercel serverless Node runtime with OpenAPI docs at `/api/docs`.

## Required environment variables

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key for the vision call |
| `POSTGRES_URL` | Postgres connection string (auto-injected if you provision through Vercel → Storage → Neon) |
| `API_KEY` | Shared bearer token clients must send to call `/api/generate` and `/api/prompts*` |

Copy `.env.example` to `.env.local` for local dev, or run `vercel env pull .env.local` after linking.

## Local development

```bash
pnpm install
pnpm exec vercel link           # once, to connect to your Vercel project
pnpm exec vercel env pull .env.local
pnpm exec vercel dev            # http://localhost:3000
```

Unit tests: `pnpm test`. Type check: `pnpm type-check`. Verifier scripts: `pnpm verify:db`, `pnpm verify:screenshot`, `pnpm verify:vision`. OpenAPI snapshot + lint: `pnpm docs:export && pnpm docs:lint`.

## Deployment notes

- The `/api/generate` function takes ~15–40s for cache misses (screenshots + Claude call). `vercel.json` sets `maxDuration: 60` — this requires **Vercel Pro**. On Hobby the function will be killed at 10s and the first real request will fail.
- The function runs on the Node.js runtime (`config.runtime = "nodejs"`) because `puppeteer-core` + `@sparticuz/chromium` need it. Memory is pinned at `1769 MB` to give Chromium headroom.
- Screenshot env check: `process.env.VERCEL` routes to `@sparticuz/chromium` (Lambda-compatible binary); anything else uses full `puppeteer` for local dev.

## Example

```bash
curl -X POST https://<YOUR_DEPLOYMENT>/api/generate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://linear.app"}' | jq
```

Response shape:
```json
{
  "url": { "original": "...", "normalized": "...", "hash": "..." },
  "prompt": { "summary": "...", "typography": {...}, "colorPalette": {...}, "layout": {...}, "components": [...], "mood": [...], "inspirationKeywords": [...] },
  "meta": { "cached": false, "modelUsed": "claude-sonnet-4-6", "generatedAt": "...", "expiresAt": "...", "screenshotCount": 3 }
}
```

Browse cached prompts at `GET /api/prompts` (paginated, searchable via `?q=`), fetch a single one with `GET /api/prompts/:hash`. Full schema at `/api/docs`.
