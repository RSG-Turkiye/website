/**
 * A JSON Schema per content type, for the panel's form and for checking a
 * draft before it becomes a pull request.
 *
 * `io: 'input'` because the files hold the schema's input: an event's dates
 * are "YYYY-MM-DD" strings that the schema turns into Dates, and a field with
 * a default may be left out.
 */

import { z } from "astro/zod";
import type { CmsType } from "./types";

/** Webinar `date` is `z.coerce.date()`, whose input JSON Schema cannot
 * express; in the files it is always a calendar day. */
const DAY = { type: "string", format: "date" } as const;

export function jsonSchemaFor(type: CmsType): Record<string, unknown> {
  if (type.format === "json") return z.toJSONSchema(type.schema, { io: "input" }) as Record<string, unknown>;

  const shape = (type.schema as z.ZodObject).shape;
  const withBody = z.object({ ...shape, body: z.string() });
  // Only webinars need `unrepresentable`: their date is z.coerce.date(), which
  // the override below replaces; events and workshops have no such field.
  return z.toJSONSchema(withBody, {
    io: "input",
    override: (ctx) => {
      if ((ctx.zodSchema as { _zod: { def: { type: string } } })._zod.def.type === "date") {
        for (const k of Object.keys(ctx.jsonSchema)) delete (ctx.jsonSchema as Record<string, unknown>)[k];
        Object.assign(ctx.jsonSchema, DAY);
      }
    },
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
