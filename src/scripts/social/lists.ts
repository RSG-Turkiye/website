/** The approval queue (publishers) and the undated drafts list. */
import { api, ApiError, type Post } from './api';
import { deps, changed } from './context';
import { errorText, problemText, requeueLabelKey } from './messages';
import { esc, button, armConfirm } from './ui';
import { bgImage } from './preview';
import { openComposer } from './composer';
import { targetLines } from './side-panel';
import { dayKey, timeOf } from '../../lib/social-calendar';

const STALE_CODES = ['post_changed', 'not_found', 'not_pending', 'plan_taken', 'plan_has_post'];

const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '');

function card(p: Post, actions: string): string {
  const { t, tf } = deps();
  const thumb = p.media[0]
    ? `<div class="w-16 h-20 shrink-0 rounded bg-gray-200 bg-center bg-cover" style="${bgImage(p.media[0].url)}"></div>`
    : '<div class="w-16 h-20 shrink-0 rounded bg-gray-100"></div>';
  const alts = p.media.filter((m) => m.alt.trim()).length;
  return `<div data-post="${esc(p.id)}" class="flex gap-3 p-3 mb-3 bg-white rounded-2xl border border-border">${thumb}
    <div class="flex-1 min-w-0"><p class="font-medium text-navy truncate">${esc(p.planTitle || p.caption.split('\n')[0] || t(`admin.social.type.${p.type}`))}</p>
      <p class="text-xs text-gray-500">${esc(t(`admin.social.type.${p.type}`))} · ${esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(' + '))} · ${esc(when(p.scheduledAt))} · ${esc(p.authorEmail ?? '')} · ${esc(tf('admin.social.list.alt', { n: alts, m: p.media.length }))}</p>
      <div class="flex flex-wrap gap-2 mt-2">${actions}</div>
      <div data-reject class="hidden mt-2"><textarea rows="2" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
        ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div></div></div>`;
}

async function act(work: () => Promise<unknown>, doneKey: string, btn?: HTMLButtonElement): Promise<void> {
  const { t, showToast } = deps();
  if (btn) btn.disabled = true;
  try {
    await work();
    showToast(t(doneKey));
    changed();
  } catch (err) {
    showToast(err instanceof ApiError && err.code === 'not_ready' && err.problems.length
      ? err.problems.map(problemText).join(' ') : errorText(err), true);
    // The revision or state is stale: reload so the list shows the current posts.
    if (err instanceof ApiError && STALE_CODES.includes(err.code)) changed();
  } finally {
    // The list may have been re-rendered; a detached button is harmless.
    if (btn) btn.disabled = false;
  }
}

export async function refreshPendingCount(): Promise<void> {
  if (!deps().me.isPublisher) return;
  // The admin menu shows this count now (shell.ts refreshCounts); without
  // the pill there is nothing to fill, so skip the request.
  const pill = document.getElementById('socialPendingCount');
  if (!pill) return;
  const n = (await api.pending()).length;
  pill.textContent = String(n);
  pill.classList.toggle('hidden', n === 0);
}

export async function loadPending(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialPendingList');
  if (!list) return;
  const posts = await api.pending();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.approve'), 'data-act="approve"', 'ok'),
    button(t('admin.social.action.open'), 'data-act="open"'),
    button(t('admin.social.action.reject'), 'data-act="reject"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="approve"]')!.addEventListener('click', (e) => void act(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved', e.currentTarget as HTMLButtonElement));
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    el.querySelector('[data-act="reject"]')!.addEventListener('click', () => el.querySelector('[data-reject]')!.classList.remove('hidden'));
    el.querySelector('[data-act="rejectSend"]')!.addEventListener('click', (e) => {
      const note = el.querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
      void act(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected', e.currentTarget as HTMLButtonElement);
    });
  }
}

export async function loadDrafts(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialDraftList');
  if (!list) return;
  const posts = await api.drafts();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.edit'), 'data-act="open"', 'primary'),
    button(t('admin.social.action.delete'), 'data-act="delete"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    armConfirm(el.querySelector<HTMLButtonElement>('[data-act="delete"]')!, () => act(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  }
}

export async function loadPublished(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialPublishedList');
  if (!list) return;
  const posts = await api.done();
  const publisher = deps().me.isPublisher;
  const key = (p: Post) => (publisher ? requeueLabelKey(p) : null);
  list.innerHTML = posts.map((p) => {
    const k = key(p);
    return card(p, targetLines(p) + (k ? button(t(k), 'data-act="requeue"', 'ok') : ''));
  }).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    if (!key(p)) continue;
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`);
    el?.querySelector('[data-act="requeue"]')?.addEventListener('click', (e) => void act(() => api.requeue(p.id, p.revision), 'admin.social.done.requeued', e.currentTarget as HTMLButtonElement));
  }
}
