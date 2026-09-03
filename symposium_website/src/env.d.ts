/// <reference types="astro/client" />

interface ImportMetaEnv {
  // The CMS overlay's origin. Read with a fallback in src/lib/content.ts, so
  // a local build needs no configuration; overridden in CI/tests to point
  // at a dead port to exercise the "overlay unreachable" path.
  readonly PUBLIC_API_BASE?: string;
}
