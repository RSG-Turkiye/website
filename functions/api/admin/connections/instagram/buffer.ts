import { bufferConnect } from '../../../../_lib/buffer-connect';

/** "Connect through Buffer": admin only; see buffer-connect.ts. DMs still need the direct connection. */
export const onRequestPost = bufferConnect('instagram');
