import { z } from "zod";

const HexColor = z
  .string()
  .describe("Hex color string, e.g. '#0A0A0A' or '#FFFFFF'");

export const DesignPromptSchema = z.object({
  summary: z
    .string()
    .describe("1-2 sentence overall vibe of the site's visual design"),
  typography: z.object({
    primaryFontFamily: z.string(),
    secondaryFontFamily: z.string().optional(),
    headingStyle: z.string().describe("e.g. 'bold serif with tight tracking'"),
    bodyStyle: z.string(),
    notableTreatments: z.array(z.string()),
  }),
  colorPalette: z.object({
    background: HexColor,
    foreground: HexColor,
    accent: HexColor,
    additional: z.array(
      z.object({
        hex: HexColor,
        role: z.string().describe("e.g. 'subtle border', 'success state'"),
      })
    ),
  }),
  layout: z.object({
    gridStyle: z.string(),
    spacingDensity: z.enum(["tight", "comfortable", "airy"]),
    alignment: z.string(),
    notableLayoutPatterns: z.array(z.string()),
  }),
  components: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    })
  ),
  mood: z.array(z.string()).min(3).max(6),
  inspirationKeywords: z
    .array(z.string())
    .describe("Designers, eras, or movements the site evokes"),
});

export type DesignPrompt = z.infer<typeof DesignPromptSchema>;
