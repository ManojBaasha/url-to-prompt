import { sql } from "./db.js";

export type CachedPrompt = {
  id: string;
  url_hash: string;
  normalized_url: string;
  original_url: string;
  prompt: unknown;
  model_used: string;
  screenshot_count: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  hit_count: number;
};

export async function getCachedPrompt(urlHash: string): Promise<CachedPrompt | null> {
  const { rows } = await sql<CachedPrompt>`
    UPDATE design_prompts
    SET hit_count = hit_count + 1
    WHERE url_hash = ${urlHash} AND expires_at > NOW()
    RETURNING *
  `;
  return rows[0] ?? null;
}

export type SetCachedPromptInput = {
  urlHash: string;
  normalizedUrl: string;
  originalUrl: string;
  prompt: unknown;
  modelUsed: string;
  screenshotCount: number;
  ttlDays: number;
};

export async function setCachedPrompt(input: SetCachedPromptInput): Promise<void> {
  const {
    urlHash,
    normalizedUrl,
    originalUrl,
    prompt,
    modelUsed,
    screenshotCount,
    ttlDays,
  } = input;

  const promptJson = JSON.stringify(prompt);

  await sql`
    INSERT INTO design_prompts (
      url_hash,
      normalized_url,
      original_url,
      prompt,
      model_used,
      screenshot_count,
      expires_at
    ) VALUES (
      ${urlHash},
      ${normalizedUrl},
      ${originalUrl},
      ${promptJson}::jsonb,
      ${modelUsed},
      ${screenshotCount},
      NOW() + (${ttlDays}::int * INTERVAL '1 day')
    )
    ON CONFLICT (url_hash) DO UPDATE SET
      normalized_url = EXCLUDED.normalized_url,
      original_url = EXCLUDED.original_url,
      prompt = EXCLUDED.prompt,
      model_used = EXCLUDED.model_used,
      screenshot_count = EXCLUDED.screenshot_count,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW(),
      hit_count = 0
  `;
}

export type ListCachedPromptsOpts = {
  limit: number;
  offset: number;
  query?: string;
  includeExpired?: boolean;
};

export async function listCachedPrompts(
  opts: ListCachedPromptsOpts
): Promise<{ items: CachedPrompt[]; total: number }> {
  const { limit, offset, query, includeExpired = false } = opts;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!includeExpired) {
    conditions.push("expires_at > NOW()");
  }

  if (query) {
    params.push(`%${query}%`);
    conditions.push(`normalized_url ILIKE $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const filterParams = [...params];

  params.push(limit);
  const limitPos = params.length;
  params.push(offset);
  const offsetPos = params.length;

  const itemsSql = `
    SELECT * FROM design_prompts
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitPos} OFFSET $${offsetPos}
  `;
  const countSql = `SELECT COUNT(*)::int AS total FROM design_prompts ${whereClause}`;

  const [itemsResult, countResult] = await Promise.all([
    sql.query<CachedPrompt>(itemsSql, params),
    sql.query<{ total: number }>(countSql, filterParams),
  ]);

  return {
    items: itemsResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function getCachedPromptByHash(
  hash: string,
  opts?: { includeExpired?: boolean }
): Promise<CachedPrompt | null> {
  const includeExpired = opts?.includeExpired ?? true;

  if (includeExpired) {
    const { rows } = await sql<CachedPrompt>`
      SELECT * FROM design_prompts WHERE url_hash = ${hash}
    `;
    return rows[0] ?? null;
  }

  const { rows } = await sql<CachedPrompt>`
    SELECT * FROM design_prompts
    WHERE url_hash = ${hash} AND expires_at > NOW()
  `;
  return rows[0] ?? null;
}
