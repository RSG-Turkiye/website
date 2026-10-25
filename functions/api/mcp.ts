// The MCP endpoint for members' agents: Streamable HTTP, stateless, JSON
// answers only (no SSE, no Mcp-Session-Id), hand-rolled (Call 15). Every
// message is a POST with the member's token. Each tool runs the REST handler
// of its route in-process (functions/_lib/mcp-tools.ts), so the token can do
// through MCP exactly what it can do over REST, and nothing more.

import { jsonResponse, type Env } from '../_lib/auth';
import { authenticateAgent, unauthorized } from '../_lib/agent-tokens';
import { AGENT_INSTRUCTIONS } from '../_lib/agent-instructions';
import { argsProblem, callTool, mcpCharge, toolsFor } from '../_lib/mcp-tools';

/** The only Origin a browser may send: a page elsewhere must not reach a local agent's server (DNS rebinding). */
const SITE_ORIGIN = 'https://rsg-turkiye.iscbsc.org';
/** Preferred first. Any other version asked for in initialize gets the first. */
const VERSIONS = ['2025-06-18', '2025-03-26'];

type Id = string | number;
const result = (id: Id, value: unknown) => jsonResponse({ jsonrpc: '2.0', id, result: value });
const rpcError = (id: Id | null, code: number, message: string, status = 200) =>
  jsonResponse({ jsonrpc: '2.0', id, error: { code, message } }, status);

// GET is in the agent route table (an MCP client may open a stream with it),
// so it authenticates and counts like any other token request before the 405.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authenticateAgent(request, env, Math.floor(Date.now() / 1000), { charge: mcpCharge });
  if (auth.kind === 'refused') return auth.response;
  if (auth.kind === 'none') return unauthorized();
  const res = jsonResponse({ error: 'This MCP endpoint answers POST only', code: 'method_not_allowed' }, 405);
  res.headers.set('Allow', 'POST');
  return res;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== SITE_ORIGIN) return jsonResponse({ error: 'Forbidden', code: 'bad_origin' }, 403);

  // The token's own checks (rate, budget, size, leak) run here once for the
  // whole message; the tool's inner request spends only its route's quota.
  // A tool's quota is spent with the message; a social tool call, and the
  // handshake of a token that may do social work, may use the agents'
  // social reserve (mcpCharge).
  const now = Math.floor(Date.now() / 1000);
  const auth = await authenticateAgent(request, env, now, { charge: mcpCharge });
  if (auth.kind === 'refused') return auth.response;
  if (auth.kind === 'none') return unauthorized();

  let message: unknown;
  try {
    message = JSON.parse(await request.text());
  } catch {
    return rpcError(null, -32700, 'Parse error', 400);
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return rpcError(null, -32600, 'Send one JSON-RPC message as an object; batches are not supported', 400);
  }
  const msg = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = Object.hasOwn(msg, 'id');
  // A client's answer to a server request: this server never asks, so there is nothing to do.
  if (msg.method === undefined && hasId && ('result' in msg || 'error' in msg)) return new Response(null, { status: 202 });
  const idOk = typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isInteger(msg.id));
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || (hasId && !idOk)
    || (msg.params !== undefined && (typeof msg.params !== 'object' || msg.params === null || Array.isArray(msg.params)))) {
    return rpcError(idOk ? msg.id as Id : null, -32600, 'Invalid request', 400);
  }

  // After initialize the client names the negotiated version on every message;
  // a missing header means 2025-03-26, as the transport spec says.
  const version = request.headers.get('MCP-Protocol-Version');
  if (msg.method !== 'initialize' && version !== null && !VERSIONS.includes(version)) {
    return rpcError(idOk ? msg.id as Id : null, -32600, `Unsupported MCP-Protocol-Version; this server speaks ${VERSIONS.join(', ')}`, 400);
  }

  // A notification (notifications/initialized and the like) gets no answer.
  if (!hasId) return new Response(null, { status: 202 });
  const id = msg.id as Id;
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (msg.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return result(id, {
        protocolVersion: typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rsg-turkiye', version: '1' },
        instructions: AGENT_INSTRUCTIONS,
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: toolsFor(auth.agent).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      // A tool this token may not use now does not exist for it.
      const tool = toolsFor(auth.agent).find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, 'Unknown tool');
      const args = params.arguments ?? {};
      const problem = argsProblem(tool, args);
      if (problem) return rpcError(id, -32602, `Invalid arguments: ${problem}`);
      let answer: { status: number; body: unknown };
      try {
        answer = await callTool(tool, args as Record<string, unknown>, { user: auth.user, agent: auth.agent }, {
          env, origin: new URL(request.url).origin, authorization: request.headers.get('Authorization') ?? '', waitUntil: (p) => waitUntil(p),
        });
      } catch (e) {
        console.error('mcp: a tool failed', tool.name, e instanceof Error ? e.name : 'error');
        return rpcError(id, -32603, 'Internal error');
      }
      const content = [{ type: 'text', text: JSON.stringify(answer.body) }];
      return result(id, answer.status >= 400 ? { isError: true, content } : { content });
    }
    default:
      return rpcError(id, -32601, 'Method not found');
  }
};
