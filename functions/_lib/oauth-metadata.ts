// The discovery documents of the agent OAuth server (plan 6): protected
// resource metadata (RFC 9728), which a client fetches after the 401 from
// /api/mcp, and authorization server metadata (RFC 8414), which tells it
// where to sign the member in. Static and free: no D1, no session. This file
// does not import agent-tokens.ts, so it stays off that module's import
// allowlist (tests/agent-tokens.test.ts).

import { jsonResponse } from './auth';
import { CMS_GROUPS } from './roles';
import { ISSUER, MCP_RESOURCE } from './oauth-config';

/** Plan 5's `area:level` strings, all twelve; parseScopes accepts each. */
export const SCOPES_SUPPORTED: readonly string[] = [...CMS_GROUPS.map((g) => `cms.${g}`), 'social']
  .flatMap((area) => [`${area}:read`, `${area}:draft`]);

export function protectedResourceMetadata(): object {
  return {
    resource: MCP_RESOURCE,
    // Claude uses the first entry only; ChatGPT needs it to equal `issuer` exactly.
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: SCOPES_SUPPORTED,
    resource_name: 'RSG-Türkiye',
  };
}

export function authorizationServerMetadata(): object {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // 'none' together with the CIMD flag is what makes Claude pick CIMD over DCR.
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    // RFC 9207: every authorization response carries `iss`; ChatGPT then uses its stable client id.
    authorization_response_iss_parameter_supported: true,
    // No offline_access: every connection gets a refresh token anyway (Call 5).
    scopes_supported: SCOPES_SUPPORTED,
  };
}

/** CORS for the endpoints that use no cookies (discovery, /oauth/token, /oauth/register); never /oauth/authorize. Discovery is read only (GET); token and registration are POST. */
export function cors(res: Response, methods = 'GET, OPTIONS'): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', methods);
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
  return res;
}

/** The answer to a browser's OPTIONS preflight. */
export function preflight(methods?: string): Response {
  return cors(new Response(null, { status: 204 }), methods);
}

/** A discovery document: JSON, CORS, cached an hour (it changes only with a deploy). */
export function discoveryResponse(doc: object): Response {
  const res = cors(jsonResponse(doc));
  res.headers.set('Cache-Control', 'public, max-age=3600');
  return res;
}
