// RFC 9728 protected resource metadata for /api/mcp: PRM_URL, named in the
// WWW-Authenticate header of every 401 from the agent path.
import { discoveryResponse, preflight, protectedResourceMetadata } from '../../../_lib/oauth-metadata';

export const onRequestGet: PagesFunction = () => discoveryResponse(protectedResourceMetadata());
export const onRequestOptions: PagesFunction = () => preflight();
