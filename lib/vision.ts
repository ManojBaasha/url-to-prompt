import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DesignPromptSchema, type DesignPrompt } from "../schemas/prompt.js";

export type VisionErrorCode =
  | "MISSING_API_KEY"
  | "API_ERROR"
  | "NO_TOOL_USE"
  | "INVALID_OUTPUT";

export class VisionError extends Error {
  readonly code: VisionErrorCode;
  constructor(
    code: VisionErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "VisionError";
    this.code = code;
  }
}

const MODEL = "claude-sonnet-4-6";
const TOOL_NAME = "record_design_prompt";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a senior design director analyzing a website's visual design language so that another team can recreate its style in an unrelated product. You will receive three PNG screenshots of the same URL: the first is the above-the-fold viewport, the second is a mid-page viewport, and the third is the entire page as a single long image.

Describe only what is actually visible in the screenshots. Use precise design vocabulary: name type classifications (geometric sans, transitional serif, monospace, etc.), spacing rhythms, grid choices, component treatments, and color relationships. When uncertain about intent, describe what you see rather than guessing. Prefer concrete, specific adjectives over vague ones.

Return your analysis by calling the record_design_prompt tool. Do not respond with prose — only tool use.`;

function imageBlock(buf: Buffer) {
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: buf.toString("base64"),
    },
  };
}

export async function generateDesignPrompt(screenshots: {
  aboveFold: Buffer;
  midPage: Buffer;
  fullPage: Buffer;
}): Promise<DesignPrompt> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new VisionError("MISSING_API_KEY", "ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const jsonSchema = z.toJSONSchema(DesignPromptSchema) as Record<string, unknown>;
  delete jsonSchema["$schema"];

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Records the structured design analysis of the provided screenshots.",
          input_schema: jsonSchema as Anthropic.Messages.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Above-the-fold viewport:" },
            imageBlock(screenshots.aboveFold),
            { type: "text", text: "Mid-page viewport:" },
            imageBlock(screenshots.midPage),
            {
              type: "text",
              text: "Full page composite (long image showing overall composition):",
            },
            imageBlock(screenshots.fullPage),
            {
              type: "text",
              text: "Call record_design_prompt with your structured analysis.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new VisionError(
      "API_ERROR",
      `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME
  );

  if (!toolUse) {
    throw new VisionError(
      "NO_TOOL_USE",
      `Model did not call ${TOOL_NAME}. Stop reason: ${response.stop_reason}`
    );
  }

  const parsed = DesignPromptSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new VisionError(
      "INVALID_OUTPUT",
      `Model output failed schema validation: ${parsed.error.message}`,
      { cause: parsed.error }
    );
  }

  return parsed.data;
}
