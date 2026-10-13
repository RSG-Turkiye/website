/** Details and actions for the item clicked on the calendar or board. */
import { api, ApiError, type Plan, type Post } from './api';
import { deps, changed } from './context';
import { errorText, problemText, publishErrorText, splitPublishError, requeueLabelKey } from './messages';
import { esc, button, armConfirm } from './ui';
import { dayKey, timeOf, planDue } from '../../lib/social-calendar';
import { findPlan, findPost } from './calendar-view';
import { openPlanDialog } from './plan-dialog';
import { openComposer } from './composer';

const side = () => document.getElementById('socialSide')!;
const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '-');
const row = (label: string, value: string) => `<p class="text-xs text-gray-500 mt-2">${esc(label)}</p><p class="text-sm text-navy">${value}</p>`;
const LOCKED = ['published', 'partially_published', 'cancelled'];
const STALE_CODES = ['post_changed', 'not_found', 'not_pending', 'plan_taken', 'plan_has_post'];

/** What the panel shows, so it can be redrawn from fresh data after an edit elsewhere. */
let shown: { kind: 'plan' | 'post'; id: string } | null = null;

export function hideSide(): void { shown = null; side().classList.add('hidden'); side().replaceChildren(); }

export function showSide(kind: 'plan' | 'post', id: string): void {
  if (kind === 'plan') { const p = findPlan(id); if (p) { shown = { kind, id }; renderPlan(p); } }
  else { const p = findPost(id); if (p) { shown = { kind, id }; renderPost(p); } }
}

/** After the calendar reloads: redraw the open panel from the new data (a stale revision gives false conflicts), or close it if the item is gone. */
export function refreshSide(): void {
  if (!shown || side().classList.contains('hidden')) return;
  const plan = shown.kind === 'plan' ? findPlan(shown.id) : undefined;
  const post = shown.kind === 'post' ? findPost(shown.id) : undefined;
  if (plan) renderPlan(plan); else if (post) renderPost(post); else hideSide();
}

async function run(work: () => Promise<unknown>, doneKey: string, btn?: HTMLButtonElement): Promise<void> {
  const { t, showToast } = deps();
  if (btn) btn.disabled = true;
  try {
    await work();
    showToast(t(doneKey));
    hideSide();
    changed();
  } catch (err) {
    showToast(err instanceof ApiError && err.code === 'not_ready' && err.problems.length
      ? err.problems.map(problemText).join(' ') : errorText(err), true);
    // The panel's revision or plan link is stale: close it and reload so retries do not hit the same conflict.
    if (err instanceof ApiError && STALE_CODES.includes(err.code)) {
      hideSide();
      changed();
    }
  } finally {
    // The panel may have been re-rendered; a detached button is harmless.
    if (btn) btn.disabled = false;
  }
}

function frame(title: string, body: string): void {
  const { t } = deps();
  side().innerHTML = `<div class="flex justify-between items-start gap-2"><h3 class="font-semibold text-navy">${esc(title)}</h3>
    ${button(t('admin.social.side.close'), 'data-close')}</div>${body}`;
  side().classList.remove('hidden');
  side().querySelector('[data-close]')!.addEventListener('click', hideSide);
}

function renderPlan(p: Plan): void {
  const { t } = deps();
  const now = Math.floor(Date.now() / 1000);
  frame(p.title, `
    ${planDue(p, now) ? `<p class="mt-2 text-xs font-semibold text-red">${esc(t('admin.social.side.dueSoon'))}</p>` : ''}
    ${row(t('admin.social.side.when'), esc(when(p.scheduledAt)))}
    ${row(t('admin.social.side.platforms'), esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(', ')))}
    ${row(t('admin.social.plan.type'), esc(t(`admin.social.type.${p.postType}`)))}
    ${row(t('admin.social.side.assignee'), esc(p.assigneeEmail ?? t('admin.social.plan.nobody')))}
    ${p.note ? row(t('admin.social.side.note'), esc(p.note)) : ''}
    <div class="flex flex-wrap gap-2 mt-4">
      ${button(t('admin.social.action.addContent'), 'data-act="content"', 'primary')}
      ${button(t('admin.social.action.editPlan'), 'data-act="edit"')}
      ${button(t('admin.social.action.deletePlan'), 'data-act="delete"', 'danger')}
    </div>`);
  side().querySelector('[data-act="content"]')!.addEventListener('click', () => void openComposer({ plan: p }));
  side().querySelector('[data-act="edit"]')!.addEventListener('click', () => void openPlanDialog({ plan: p }));
  armConfirm(side().querySelector<HTMLButtonElement>('[data-act="delete"]')!, () => run(() => api.deletePlan(p.id), 'admin.social.done.deleted'));
}

/** One line per platform: what happened, a link when there is one, and why when it did not work. */
export function targetLines(p: Post): string {
  const { t } = deps();
  if (!p.targets.length) return '';
  return `<div class="mt-3"><p class="text-xs text-gray-500">${esc(t('admin.social.side.targets'))}</p>${p.targets.map((x) => `
    <p class="text-sm text-navy mt-1"><strong>${esc(t(`admin.connections.platform.${x.platform}`))}</strong>: ${esc(t(`admin.social.target.${x.status}`))}
      ${x.permalink?.startsWith('https://') ? ` · <a href="${esc(x.permalink)}" target="_blank" rel="noopener" class="underline">${esc(t('admin.social.side.viewPost'))}</a>` : ''}</p>
    ${x.lastError && x.status !== 'published' ? `<p class="text-xs text-red">${esc(publishErrorText(x.lastError))}</p>${splitPublishError(x.lastError).detail ? `<p class="text-xs text-gray-500 break-words">${esc(splitPublishError(x.lastError).detail)}</p>` : ''}` : ''}`).join('')}</div>`;
}

function renderPost(p: Post): void {
  const { t, me } = deps();
  const mine = p.createdBy === me.id;
  const canEdit = !LOCKED.includes(p.status) && (me.isPublisher || mine);
  const actions: string[] = [];
  actions.push(button(t(canEdit ? 'admin.social.action.edit' : 'admin.social.action.open'), 'data-act="open"', 'primary'));
  if (canEdit && (p.status === 'draft' || p.status === 'rejected')) {
    actions.push(button(t(me.isPublisher ? 'admin.social.action.schedule' : 'admin.social.action.submit'), 'data-act="submit"', 'ok'));
    actions.push(button(t('admin.social.action.delete'), 'data-act="delete"', 'danger'));
  }
  if (me.isPublisher && p.status === 'pending_approval') {
    actions.push(button(t('admin.social.action.approve'), 'data-act="approve"', 'ok'));
    actions.push(button(t('admin.social.action.reject'), 'data-act="reject"', 'danger'));
  }
  if ((me.isPublisher || mine) && (p.status === 'pending_approval' || p.status === 'scheduled')) {
    actions.push(button(t('admin.social.action.cancel'), 'data-act="cancel"', 'danger'));
  }
  const requeueKey = requeueLabelKey(p);
  if (me.isPublisher && requeueKey) actions.push(button(t(requeueKey), 'data-act="requeue"', 'ok'));
  frame(p.planTitle || t(`admin.social.type.${p.type}`), `
    <p class="mt-1 text-xs font-semibold">${esc(t(`admin.social.status.${p.status}`))}</p>
    ${!canEdit && !LOCKED.includes(p.status) ? `<p class="mt-2 text-xs text-gray-500">${esc(t('admin.social.side.readOnly'))}</p>` : ''}
    ${row(t('admin.social.side.when'), esc(when(p.scheduledAt)))}
    ${row(t('admin.social.side.platforms'), esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(', ')))}
    ${row(t('admin.social.side.author'), esc(p.authorEmail ?? ''))}
    ${p.reviewNote ? row(t('admin.social.side.reviewNote'), esc(p.reviewNote)) : ''}
    ${targetLines(p)}
    ${p.media[0] ? `<img src="${esc(p.media[0].url)}" alt="${esc(p.media[0].alt)}" class="mt-3 w-full max-h-48 object-cover rounded-lg">` : ''}
    <div class="flex flex-wrap gap-2 mt-4">${actions.join('')}</div>
    <div data-reject class="hidden mt-3"><textarea rows="3" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
      ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div>`);

  const q = (s: string) => side().querySelector<HTMLButtonElement>(`[data-act="${s}"]`);
  q('open')?.addEventListener('click', () => void openComposer({ postId: p.id }));
  q('submit')?.addEventListener('click', (e) => void run(() => api.action(p.id, 'submit', { revision: p.revision }),
    me.isPublisher ? 'admin.social.done.scheduled' : 'admin.social.done.submitted', e.currentTarget as HTMLButtonElement));
  q('approve')?.addEventListener('click', (e) => void run(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved', e.currentTarget as HTMLButtonElement));
  q('requeue')?.addEventListener('click', (e) => void run(() => api.requeue(p.id, p.revision), 'admin.social.done.requeued', e.currentTarget as HTMLButtonElement));
  q('reject')?.addEventListener('click', () => side().querySelector('[data-reject]')!.classList.remove('hidden'));
  q('rejectSend')?.addEventListener('click', (e) => {
    const note = side().querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
    void run(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected', e.currentTarget as HTMLButtonElement);
  });
  const del = q('delete'); if (del) armConfirm(del, () => run(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  const cancel = q('cancel'); if (cancel) armConfirm(cancel, () => run(() => api.action(p.id, 'cancel', { revision: p.revision }), 'admin.social.done.cancelled'));
}
