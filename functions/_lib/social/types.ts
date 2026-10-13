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
  media: { key: string; url: string; alt: string }[];
}

export interface TargetState { containerId: string | null }
