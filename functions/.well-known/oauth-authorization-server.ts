// RFC 8414 authorization server metadata for the issuer
// https://rsg-turkiye.iscbsc.org (no path, so no path-suffixed copy).
import { authorizationServerMetadata, discoveryResponse, preflight } from '../_lib/oauth-metadata';

export const onRequestGet: PagesFunction = () => discoveryResponse(authorizationServerMetadata());
export const onRequestOptions: PagesFunction = () => preflight();
