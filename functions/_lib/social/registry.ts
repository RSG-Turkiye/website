/**
 * Which publish step serves which platform. The dispatcher knows nothing
 * else about a platform. LinkedIn and X go through Buffer when their
 * connection says so (publisherFor), so switching back is a reconnect.
 */
import type { SocialPlatform } from '../social-limits';
import type { PublishStepFn } from './types';
import { instagramPublishStep } from './instagram';
import { linkedinPublishStep } from './linkedin';
import { xPublishStep } from './x';
import { bufferPublishStep } from './buffer';

export const PLATFORM_LABEL: Record<SocialPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X' };

/**
 * Never connected means skipped, not waiting: LinkedIn can be ticked while
 * its API access is still being approved without holding the post's
 * Instagram half in "scheduled". Instagram is the main channel and waits.
 */
export const SKIP_WHEN_UNCONNECTED: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>(['linkedin', 'x']);

export const PUBLISHERS: Partial<Record<SocialPlatform, PublishStepFn>> = {
  instagram: (i) => instagramPublishStep({ igUserId: i.account.id, token: i.token, post: i.post, state: i.state }),
  linkedin: linkedinPublishStep,
  x: xPublishStep,
};

/** Platforms Buffer can carry for us (spec 2026-10-19). Instagram stays direct. */
export const BUFFER_PLATFORMS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>(['linkedin', 'x']);

/** The step for one target: Buffer's when the platform's connection is a Buffer one, the direct adapter otherwise. */
export function publisherFor(platform: SocialPlatform, via?: 'buffer'): PublishStepFn | undefined {
  return via === 'buffer' && BUFFER_PLATFORMS.has(platform) ? bufferPublishStep : PUBLISHERS[platform];
}
