import { bufferConnect } from '../../../../_lib/buffer-connect';

/** "Connect through Buffer": admin only; see buffer-connect.ts. */
export const onRequestPost = bufferConnect('linkedin');
