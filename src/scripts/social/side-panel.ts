/** Details and actions for the item clicked on the calendar or board. */
import { api, ApiError, type Plan, type Post } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { dayKey, timeOf, planDue } from '../../lib/social-calendar';
import { findPlan, findPost } from './calendar-view';
import { openPlanDialog } from './plan-dialog';
import { openComposer } from './composer';

const side = () => document.getElementById('socialSide')!;
const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '-');
const row = (label: string, value: string) => `<p class="text-xs text-gray-500 mt-2">${esc(label)}</p><p class="text-sm text-navy">${value}</p>`;
const LOCKED = ['published', 'partially_published', 'failed', 'cancelled'];
const STALE_CODES = ['post_changed', 'not_found', 'not_pending', 'plan_taken', 'plan_has_post'];

export function hideSide(): void { side().classList.add('hidden'); side().replaceChildren(); }

export function showSide(kind: 'plan' | 'post', id: string): void {
  if (kind === 'plan') { const p = findPlan(id); if (p) renderPlan(p); }
  else { const p = findPost(id); if (p) renderPost(p); }
}

async function run(work: () => Promise<unknown>, doneKey: string): Promise<void> {
  const { t, showToast } = deps();
  try {
    await work();
    showToast(t(doneKey));
    hideSide();
    changed();
  } catch (err) {
    showToast(errorText(err), true);
    // The panel's revision or plan link is stale: close it and reload so retries do not hit the same conflict.
    if (err instanceof ApiError && STALE_CODES.includes(err.code)) {
      hideSide();
      changed();
    }
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
  frame(p.planTitle || t(`admin.social.type.${p.type}`), `
    <p class="mt-1 text-xs font-semibold">${esc(t(`admin.social.status.${p.status}`))}</p>
    ${!canEdit && !LOCKED.includes(p.status) ? `<p class="mt-2 text-xs text-gray-500">${esc(t('admin.social.side.readOnly'))}</p>` : ''}
    ${row(t('admin.social.side.when'), esc(when(p.scheduledAt)))}
    ${row(t('admin.social.side.platforms'), esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(', ')))}
    ${row(t('admin.social.side.author'), esc(p.authorEmail ?? ''))}
    ${p.reviewNote ? row(t('admin.social.side.reviewNote'), esc(p.reviewNote)) : ''}
    ${p.media[0] ? `<img src="${esc(p.media[0].url)}" alt="${esc(p.media[0].alt)}" class="mt-3 w-full max-h-48 object-cover rounded-lg">` : ''}
    <div class="flex flex-wrap gap-2 mt-4">${actions.join('')}</div>
    <div data-reject class="hidden mt-3"><textarea rows="3" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
      ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div>`);

  const q = (s: string) => side().querySelector<HTMLButtonElement>(`[data-act="${s}"]`);
  q('open')?.addEventListener('click', () => void openComposer({ postId: p.id }));
  q('submit')?.addEventListener('click', () => void run(() => api.action(p.id, 'submit', { revision: p.revision }),
    me.isPublisher ? 'admin.social.done.scheduled' : 'admin.social.done.submitted'));
  q('approve')?.addEventListener('click', () => void run(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved'));
  q('reject')?.addEventListener('click', () => side().querySelector('[data-reject]')!.classList.remove('hidden'));
  q('rejectSend')?.addEventListener('click', () => {
    const note = side().querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
    void run(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected');
  });
  const del = q('delete'); if (del) armConfirm(del, () => run(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  const cancel = q('cancel'); if (cancel) armConfirm(cancel, () => run(() => api.action(p.id, 'cancel', { revision: p.revision }), 'admin.social.done.cancelled'));
}
