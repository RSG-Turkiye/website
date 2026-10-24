import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { cmsGate, rightsIn } from '../../_lib/cms-api';
import { CMS_TYPES } from '../../../src/lib/cms/types';
import { jsonSchemaFor } from '../../../src/lib/cms/json-schema';

/**
 * The content types this person can edit, each with its JSON Schema, for
 * API clients (plan 5). The admin panel does not build its form from it: it
 * has its own field model (src/scripts/admin/cms-form.ts), kept in step with
 * the schemas by tests/cms-form.test.ts, which fails on a schema key the
 * model does not cover.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const types = CMS_TYPES.filter((t) => rightsIn(gate.rights, t.group).edit).map((t) => ({
    key: t.key,
    group: t.group,
    format: t.format,
    label: t.label,
    canApprove: rightsIn(gate.rights, t.group).approve,
    schema: jsonSchemaFor(t),
  }));
  return jsonResponse({ types });
};
