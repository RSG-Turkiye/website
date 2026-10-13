/**
 * The only place the social panel talks to the server. A non-OK answer
 * becomes an ApiError carrying the server's code, so every caller can turn it
 * into a sentence (messages.ts) instead of a generic failure.
 */
export type Platform = 'instagram' | 'linkedin' | 'x';
export type PostType = 'image' | 'carousel' | 'story';
export type PostStatus =
  | 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'partially_published' | 'failed' | 'rejected' | 'cancelled';

export interface MediaItem { key: string; alt: string; url: string; width?: number; height?: number }
export interface Post {
  id: string; type: PostType; caption: string; captionOverrides: Partial<Record<Platform, string>>; link: string | null;
  media: MediaItem[]; platforms: Platform[]; scheduledAt: number | null; status: PostStatus; revision: number;
  createdBy: string; authorEmail: string | null; approvedBy: string | null; approvedAt: number | null; reviewNote: string | null;
  planId: string | null; planTitle: string | null; eventModeId: string | null; createdAt: number; updatedAt: number;
  targets: { platform: Platform; status: string; permalink: string | null; lastError: string | null }[];
}
export interface Plan {
  id: string; title: string; scheduledAt: number; platforms: Platform[]; postType: PostType; assigneeId: string | null;
  assigneeEmail: string | null; note: string; postId: string | null; postStatus: PostStatus | null; createdBy: string; createdAt: number;
}
export interface Editor { id: string; email: string; name: string | null; isPublisher: boolean }
export interface EventMode {
  id: string; name: string; startsAt: number; endsAt: number; editorIds: string[]; editorEmails: string[];
  openedBy: string; closedAt: number | null; active: boolean;
}
export interface Problem { code: string; index?: number; platform?: Platform; limit?: number; actual?: number }

export interface DraftBody {
  type: PostType; caption: string; captionOverrides: Partial<Record<Platform, string>>; link: string | null;
  media: { key: string; alt: string }[]; platforms: Platform[]; scheduledAt: number | null; planId?: string;
}
export interface PlanBody {
  title: string; scheduledAt: number; platforms: Platform[]; postType: PostType; assigneeId: string | null; note: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public problems: Problem[] = []) {
    super(code);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { code?: string; problems?: Problem[] };
  if (!res.ok) throw new ApiError(res.status, data.code ?? `http_${res.status}`, data.problems ?? []);
  return data as T;
}

const id = (s: string) => encodeURIComponent(s);
type Result = { ok: true; revision: number; status: PostStatus };

export const api = {
  plans: (from: number, to: number) => call<{ plans: Plan[] }>('GET', `/api/social/plans?from=${from}&to=${to}`).then((r) => r.plans),
  createPlan: (body: PlanBody) => call<{ id: string }>('POST', '/api/social/plans', body),
  updatePlan: (planId: string, body: Partial<PlanBody>) => call<{ ok: true }>('PATCH', `/api/social/plans/${id(planId)}`, body),
  deletePlan: (planId: string) => call<{ ok: true }>('DELETE', `/api/social/plans/${id(planId)}`),
  posts: (from: number, to: number) => call<{ posts: Post[] }>('GET', `/api/social/posts?from=${from}&to=${to}`).then((r) => r.posts),
  pending: () => call<{ posts: Post[] }>('GET', '/api/social/posts?status=pending_approval').then((r) => r.posts),
  drafts: () => call<{ posts: Post[] }>('GET', '/api/social/posts?drafts=1').then((r) => r.posts),
  post: (postId: string) => call<Post>('GET', `/api/social/posts/${id(postId)}`),
  createPost: (body: DraftBody) => call<{ id: string; revision: number }>('POST', '/api/social/posts', body),
  updatePost: (postId: string, body: DraftBody & { revision: number }) => call<Result>('PATCH', `/api/social/posts/${id(postId)}`, body),
  deletePost: (postId: string, revision: number) => call<{ ok: true }>('DELETE', `/api/social/posts/${id(postId)}`, { revision }),
  action: (postId: string, action: 'submit' | 'approve' | 'reject' | 'cancel', body: { revision: number; note?: string }) =>
    call<Result>('POST', `/api/social/posts/${id(postId)}/${action}`, body),
  editors: () => call<{ editors: Editor[] }>('GET', '/api/social/editors').then((r) => r.editors),
  events: () => call<{ modes: EventMode[] }>('GET', '/api/social/event-modes').then((r) => r.modes),
  openEvent: (body: { name: string; startsAt: number; endsAt: number; editorIds: string[] }) => call<{ id: string }>('POST', '/api/social/event-modes', body),
  closeEvent: (eventId: string) => call<{ ok: true }>('POST', `/api/social/event-modes/${id(eventId)}/close`),
};
