import type { SocialPlatform } from '../social-limits';

/**
 * What a platform adapter says after one step of publishing one target. The
 * dispatcher turns it into the target's next state (social-dispatch.ts).
 */
export type PublishStep =
  | { kind: 'done'; remoteId: string | null; permalink: string | null; notes?: string[] }
  /** Instagram is still processing the container; poll it next tick. */
  | { kind: 'pending'; containerId: string; notes?: string[] }
  /** Transient: try again next tick, within the retry window. */
  | { kind: 'retry'; reason: string; clearContainer?: boolean }
  /** The content itself was refused; a person has to change something. clearContainer: Instagram reported the container ERROR, so nothing was published. */
  | { kind: 'fail'; reason: string; clearContainer?: boolean }
  /** The token no longer works; the target waits for a reconnect. */
  | { kind: 'auth'; reason: string };

export interface PostForPlatform {
  type: 'image' | 'carousel' | 'story';
  caption: string;
  /** url: public address (Instagram fetches it). load: the bytes from R2 (LinkedIn and X upload them). */
  media: { key: string; url: string; alt: string; load?: () => Promise<Uint8Array | null> }[];
}

export interface TargetState { containerId: string | null }

export interface PublishInput {
  /** org: the Buffer organisation, for a Buffer-backed connection. */
  account: { id: string; name: string | null; org?: string | null };
  /** Which platform this target is for; an adapter serving more than one (Buffer) needs it. */
  platform?: SocialPlatform;
  token: string;
  post: PostForPlatform;
  state: TargetState;
  now: number;
  /**
   * Records containerId on the target now, under this tick's lease, before
   * the adapter makes a call that creates something. True when written; false
   * when the lease was lost (make no further calls then). A step that follows
   * a successful checkpoint is applied on top of it, so a retry keeps it.
   */
  checkpoint: (containerId: string) => Promise<boolean>;
}

export type PublishStepFn = (input: PublishInput) => Promise<PublishStep>;
