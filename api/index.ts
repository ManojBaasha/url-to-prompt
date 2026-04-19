import type { IncomingMessage, ServerResponse } from "node:http";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";

import { assertHttpUrl, hashUrl, normalizeUrl } from "../lib/url.js";
import { captureScreenshots, ScreenshotError } from "../lib/screenshot.js";
import { generateDesignPrompt, VisionError } from "../lib/vision.js";
import {
  getCachedPrompt,
  getCachedPromptByHash,
  listCachedPrompts,
  setCachedPrompt,
  type CachedPrompt,
} from "../lib/cache.js";
import { DesignPromptSchema } from "../schemas/prompt.js";

export const config = {
  runtime: "nodejs",
};

const MODEL_USED = "claude-sonnet-4-6";
const SCREENSHOT_COUNT = 3;
const TTL_DAYS = 30;

const app = new OpenAPIHono().basePath("/api");

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
});

// -------- Health (public) --------

const HealthResponseSchema = z
  .object({
    status: z.string(),
    timestamp: z.string(),
  })
  .openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Health check",
  operationId: "health",
  security: [],
  responses: {
    200: {
      content: { "application/json": { schema: HealthResponseSchema } },
      description: "Health check",
    },
  },
});

app.openapi(healthRoute, (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

// -------- Bearer auth (protected routes) --------

const bearerAuth = createMiddleware(async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return c.json(
      { error: "Server misconfigured: API_KEY not set", code: "CONFIG" },
      500
    );
  }
  const header = c.req.header("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return c.json(
      { error: "Missing or invalid Authorization header", code: "AUTH_MISSING" },
      401
    );
  }
  const provided = Buffer.from(match[1] ?? "");
  const expected = Buffer.from(apiKey);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return c.json({ error: "Invalid API key", code: "AUTH_INVALID" }, 401);
  }
  await next();
});

app.use("/generate", bearerAuth);
app.use("/prompts", bearerAuth);
app.use("/prompts/*", bearerAuth);

// -------- Shared schemas --------

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi("Error");

// -------- POST /generate --------

const GenerateBodySchema = z
  .object({
    url: z.string().url(),
    refresh: z.boolean().optional().default(false),
  })
  .openapi("GenerateBody");

const GenerateResponseSchema = z
  .object({
    url: z.object({
      original: z.string(),
      normalized: z.string(),
      hash: z.string(),
    }),
    prompt: DesignPromptSchema,
    meta: z.object({
      cached: z.boolean(),
      modelUsed: z.string(),
      generatedAt: z.string(),
      expiresAt: z.string(),
      screenshotCount: z.number(),
    }),
  })
  .openapi("GenerateResponse");

const generateRoute = createRoute({
  method: "post",
  path: "/generate",
  summary: "Generate a design prompt for a URL",
  operationId: "generate",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: GenerateBodySchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: GenerateResponseSchema } },
      description: "Design prompt (cache hit or freshly generated)",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid request body",
    },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unauthorized",
    },
    422: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "URL blocked (SSRF, bad scheme, private address)",
    },
    502: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Upstream failure (screenshot or vision)",
    },
    500: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Internal error",
    },
  },
});

app.openapi(generateRoute, async (c) => {
  const body = c.req.valid("json");

  try {
    assertHttpUrl(body.url);
  } catch (err) {
    return c.json(
      {
        error: `URL blocked: ${err instanceof Error ? err.message : "rejected"}`,
        code: "URL_BLOCKED",
      },
      422
    );
  }

  const normalized = normalizeUrl(body.url);
  const hash = hashUrl(normalized);

  if (!body.refresh) {
    const cached = await getCachedPrompt(hash);
    if (cached) {
      return c.json(
        {
          url: {
            original: cached.original_url,
            normalized: cached.normalized_url,
            hash: cached.url_hash,
          },
          prompt: cached.prompt as z.infer<typeof DesignPromptSchema>,
          meta: {
            cached: true,
            modelUsed: cached.model_used,
            generatedAt: new Date(cached.created_at).toISOString(),
            expiresAt: new Date(cached.expires_at).toISOString(),
            screenshotCount: cached.screenshot_count,
          },
        },
        200
      );
    }
  }

  let screenshots;
  try {
    screenshots = await captureScreenshots(normalized);
  } catch (err) {
    if (err instanceof ScreenshotError) {
      return c.json(
        { error: `Screenshot failed: ${err.message}`, code: err.code },
        502
      );
    }
    throw err;
  }

  let prompt;
  try {
    prompt = await generateDesignPrompt(screenshots);
  } catch (err) {
    if (err instanceof VisionError) {
      return c.json(
        { error: `Vision failed: ${err.message}`, code: err.code },
        502
      );
    }
    throw err;
  }

  await setCachedPrompt({
    urlHash: hash,
    normalizedUrl: normalized,
    originalUrl: body.url,
    prompt,
    modelUsed: MODEL_USED,
    screenshotCount: SCREENSHOT_COUNT,
    ttlDays: TTL_DAYS,
  });

  const stored = await getCachedPromptByHash(hash, { includeExpired: true });
  if (!stored) {
    return c.json(
      { error: "Failed to persist cached prompt", code: "PERSIST_FAILED" },
      500
    );
  }

  return c.json(
    {
      url: { original: body.url, normalized, hash },
      prompt,
      meta: {
        cached: false,
        modelUsed: MODEL_USED,
        generatedAt: new Date(stored.created_at).toISOString(),
        expiresAt: new Date(stored.expires_at).toISOString(),
        screenshotCount: SCREENSHOT_COUNT,
      },
    },
    200
  );
});

// -------- GET /prompts (list) and GET /prompts/:hash --------

const PromptItemSchema = z
  .object({
    hash: z.string(),
    url: z.object({
      original: z.string(),
      normalized: z.string(),
    }),
    prompt: DesignPromptSchema,
    meta: z.object({
      modelUsed: z.string(),
      screenshotCount: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
      expiresAt: z.string(),
      hitCount: z.number(),
      isExpired: z.boolean(),
    }),
  })
  .openapi("PromptItem");

const ListResponseSchema = z
  .object({
    items: z.array(PromptItemSchema),
    pagination: z.object({
      limit: z.number(),
      offset: z.number(),
      total: z.number(),
      hasMore: z.boolean(),
    }),
  })
  .openapi("ListResponse");

function rowToItem(row: CachedPrompt): z.infer<typeof PromptItemSchema> {
  const expiresAt = new Date(row.expires_at);
  return {
    hash: row.url_hash,
    url: {
      original: row.original_url,
      normalized: row.normalized_url,
    },
    prompt: row.prompt as z.infer<typeof DesignPromptSchema>,
    meta: {
      modelUsed: row.model_used,
      screenshotCount: row.screenshot_count,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: expiresAt.toISOString(),
      hitCount: row.hit_count,
      isExpired: expiresAt.getTime() <= Date.now(),
    },
  };
}

const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    q: z.string().min(1).optional(),
    includeExpired: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v === "true" || v === "1"),
  })
  .openapi("ListQuery");

const listRoute = createRoute({
  method: "get",
  path: "/prompts",
  summary: "List cached design prompts",
  operationId: "listPrompts",
  security: [{ bearerAuth: [] }],
  request: { query: ListQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: ListResponseSchema } },
      description: "Paginated cached prompts",
    },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unauthorized",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const { limit, offset, q, includeExpired } = c.req.valid("query");
  const { items, total } = await listCachedPrompts({
    limit,
    offset,
    query: q,
    includeExpired,
  });
  const mapped = items.map(rowToItem);
  return c.json(
    {
      items: mapped,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + mapped.length < total,
      },
    },
    200
  );
});

const HashParamSchema = z
  .object({
    hash: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/),
  })
  .openapi("HashParam");

const getRoute = createRoute({
  method: "get",
  path: "/prompts/{hash}",
  summary: "Fetch a single cached prompt by its hash",
  operationId: "getPromptByHash",
  security: [{ bearerAuth: [] }],
  request: { params: HashParamSchema },
  responses: {
    200: {
      content: { "application/json": { schema: PromptItemSchema } },
      description: "A single cached prompt",
    },
    400: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Invalid hash",
    },
    401: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Unauthorized",
    },
    404: {
      content: { "application/json": { schema: ErrorSchema } },
      description: "Not found",
    },
  },
});

app.openapi(getRoute, async (c) => {
  const { hash } = c.req.valid("param");
  const row = await getCachedPromptByHash(hash);
  if (!row) {
    return c.json(
      { error: `No cached prompt for hash ${hash}`, code: "NOT_FOUND" },
      404
    );
  }
  return c.json(rowToItem(row), 200);
});

// -------- OpenAPI spec + Redoc docs (public) --------

app.get("/openapi.json", (c) =>
  c.json(
    app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Design Prompt API",
        version: "0.1.0",
        description:
          "Capture a URL's visual design language and return a structured, cached design prompt.",
      },
      servers: [
        { url: "http://localhost:3000", description: "Local dev" },
      ],
    })
  )
);

const DOCS_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Design Prompt API</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

app.get("/docs", (c) => c.html(DOCS_HTML));

// -------- Vercel Node adapter --------

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else if (v != null) headers.set(k, v);
  }
  const init: RequestInit = { method: req.method ?? "GET", headers };
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const body = await readBody(req);
    if (body.length > 0) init.body = new Uint8Array(body);
  }
  return new Request(url.toString(), init);
}

async function writeWebResponse(
  res: ServerResponse,
  webRes: Response
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const body = webRes.body
    ? Buffer.from(await webRes.arrayBuffer())
    : undefined;
  if (body) res.end(body);
  else res.end();
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const webReq = await toWebRequest(req);
    const webRes = await app.fetch(webReq);
    await writeWebResponse(res, webRes);
  } catch (err) {
    console.error("[api] handler error:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "internal" }));
  }
}
