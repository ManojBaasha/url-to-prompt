CREATE TABLE IF NOT EXISTS design_prompts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash        VARCHAR(64) UNIQUE NOT NULL,
  normalized_url  TEXT NOT NULL,
  original_url    TEXT NOT NULL,
  prompt          JSONB NOT NULL,
  model_used      VARCHAR(50) NOT NULL,
  screenshot_count INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  hit_count       INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_design_prompts_hash ON design_prompts(url_hash);
CREATE INDEX IF NOT EXISTS idx_design_prompts_expires ON design_prompts(expires_at);
