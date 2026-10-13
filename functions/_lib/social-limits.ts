/**
 * What each platform accepts, counted one way for the composer and the
 * server alike (spec §2): plan 2b imports this file, so the panel can never
 * call a caption fine that the server then refuses.
 */
export type SocialPlatform = 'instagram' | 'linkedin' | 'x';
export type PostType = 'image' | 'carousel' | 'story';

export const ALL_PLATFORMS: SocialPlatform[] = ['instagram', 'linkedin', 'x'];
export const ENABLED_PLATFORMS: SocialPlatform[] = ALL_PLATFORMS;
export const POST_TYPES: PostType[] = ['image', 'carousel', 'story'];

export const CAPTION_LIMITS: Record<SocialPlatform, number> = { instagram: 2200, linkedin: 3000, x: 280 };
export const INSTAGRAM_MAX_HASHTAGS = 30;
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;
export const MAX_ALT_LENGTH = 1000;
/** X takes up to four photos in one post. */
export const X_MAX_IMAGES = 4;
/** X shortens every link to t.co and counts it as 23 characters, however long it is. */
export const X_URL_LENGTH = 23;
const URL_PATTERN = /https?:\/\/\S+/g;
/** Instagram never makes caption links clickable; the link goes to /links instead. */
export const LINK_IN_BIO_LINE = '🔗 Link profilde';

const FEED_MIN_RATIO = 4 / 5;
const FEED_MAX_RATIO = 1.91;
const STORY_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.01;

/**
 * Counts UTF-16 code units (string length). An emoji outside the Basic
 * Multilingual Plane counts as 2, on purpose: we do not know whether the
 * platforms count code points or code units, and counting units never
 * under-counts, so the panel never approves a caption the platform rejects.
 */
export function countChars(text: string): number {
  return text.length;
}

/** Characters as the platform counts them: countChars, except that X weighs each link as X_URL_LENGTH. */
export function countFor(platform: SocialPlatform, text: string): number {
  if (platform !== 'x') return countChars(text);
  return countChars(text.replace(URL_PATTERN, 'x'.repeat(X_URL_LENGTH)));
}

export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export interface CaptionSource {
  caption: string;
  captionOverrides: Partial<Record<SocialPlatform, string>>;
  link: string | null;
}

/** The text a platform will receive: its override if one is written, then the link in that platform's form. */
export function captionFor(src: CaptionSource, platform: SocialPlatform): string {
  const override = Object.hasOwn(src.captionOverrides, platform) ? src.captionOverrides[platform] : undefined;
  const base = override !== undefined && override.trim() !== '' ? override : src.caption;
  if (!src.link) return base;
  const tail = platform === 'instagram' ? LINK_IN_BIO_LINE : src.link;
  return base.trim() === '' ? tail : `${base}\n\n${tail}`;
}

export function ratioOk(type: PostType, width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const r = width / height;
  if (type === 'story') return Math.abs(r - STORY_RATIO) <= STORY_RATIO * RATIO_TOLERANCE;
  return r >= FEED_MIN_RATIO * (1 - RATIO_TOLERANCE) && r <= FEED_MAX_RATIO * (1 + RATIO_TOLERANCE);
}

export type CaptionProblem = {
  code: 'caption_too_long' | 'too_many_hashtags';
  platform: SocialPlatform;
  limit: number;
  actual: number;
};

/** A story shows no caption, so a story's caption is never checked. */
export function captionProblems(src: CaptionSource, platforms: SocialPlatform[], type: PostType): CaptionProblem[] {
  if (type === 'story') return [];
  const problems: CaptionProblem[] = [];
  for (const platform of platforms) {
    const text = captionFor(src, platform);
    const chars = countFor(platform, text);
    if (chars > CAPTION_LIMITS[platform]) {
      problems.push({ code: 'caption_too_long', platform, limit: CAPTION_LIMITS[platform], actual: chars });
    }
    if (platform === 'instagram') {
      const tags = countHashtags(text);
      if (tags > INSTAGRAM_MAX_HASHTAGS) {
        problems.push({ code: 'too_many_hashtags', platform, limit: INSTAGRAM_MAX_HASHTAGS, actual: tags });
      }
    }
  }
  return problems;
}
