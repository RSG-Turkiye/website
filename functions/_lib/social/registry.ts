/**
 * Which publish step serves which platform. The dispatcher knows nothing
 * else about a platform; swapping LinkedIn's backend (for Buffer, say) is a
 * change to one entry here.
 */
import type { SocialPlatform } from '../social-limits';
import type { PublishStepFn } from './types';
import { instagramPublishStep } from './instagram';
import { linkedinPublishStep } from './linkedin';

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
};
