/** Length of a string in UTF-8 bytes: what Instagram's 1000-byte limit and the server count. */
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
