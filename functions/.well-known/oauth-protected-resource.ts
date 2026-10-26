// RFC 9728 protected resource metadata at the root well-known URL. The
// path-suffixed copy (oauth-protected-resource/api/mcp.ts) is the one our
// 401 names; clients that probe the root get the same document.
import { discoveryResponse, preflight, protectedResourceMetadata } from '../_lib/oauth-metadata';

export const onRequestGet: PagesFunction = () => discoveryResponse(protectedResourceMetadata());
export const onRequestOptions: PagesFunction = () => preflight();
