/**
 * CI-P1-04 inventory probe: which of the schema shapes the video-render contract wants
 * (`.trim()`, `.optional().default()`, `z.union` of objects, `.max()`) survives
 * `z.toJSONSchema(..., { io: "input" })`. `inputJsonSchema()` of CI-P1-03 answers `null` when Zod
 * cannot express a schema, and the new tool must be discoverable with a real contract.
 */
const { z } = require("zod");

const caption = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
});

const branch = z.object({
  template: z.object({ id: z.literal("existing_video_package"), version: z.number().int().positive().optional() }),
  materials: z.object({ video: z.string().trim(), cover: z.string().trim().optional() }),
  params: z
    .object({
      title: z.string().trim().max(120).optional(),
      captions: z.array(caption).max(500).optional(),
      subtitles: z.boolean().optional().default(true),
    })
    .optional()
    .default({}),
});

const union = z.union([branch]);
const refined = z.object({ a: z.number().int() }).refine((value) => value.a > 0);

for (const [label, schema] of [["branch", branch], ["union-of-one", union], ["refined", refined]]) {
  try {
    const json = z.toJSONSchema(schema, { io: "input" });
    console.log(`${label}: OK ${JSON.stringify(json).slice(0, 400)}`);
  } catch (error) {
    console.log(`${label}: THREW ${error.message}`);
  }
}

const parsed = branch.parse({ template: { id: "existing_video_package" }, materials: { video: " a.mp4 " } });
console.log(`defaults+trim: ${JSON.stringify(parsed)}`);
console.log(`zod version: ${require("zod/package.json").version}`);
