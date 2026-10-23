/**
 * Git's blob sha of a file's text: sha1 over "blob <byte length>\0" and the
 * UTF-8 bytes. The same number GitHub reports for a file, so the build can
 * write it into /cms-index.json and the PR shepherd can compare it with the
 * files a draft's pull request carried, without asking GitHub. Web Crypto,
 * so it runs both at build (Node) and in the Functions (Workers).
 */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(head.byteLength + body.byteLength);
  bytes.set(head, 0);
  bytes.set(body, head.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** gitBlobSha of every file, keyed by the same path. */
export async function gitBlobShas(files: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(files).map(async ([path, text]) => [path, await gitBlobSha(text)] as const));
  return Object.fromEntries(entries);
}
