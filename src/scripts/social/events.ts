/** Event mode (spec §1): list for everyone, open/close for publishers. */
import { api, ApiError } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { editorsCache } from './plan-dialog';
import { dayKey, timeOf } from '../../lib/social-calendar';
import { epochToIstanbulInput, istanbulInputToEpoch } from '../../lib/istanbul-time';

const CLOSE_STALE_CODES = ['already_closed', 'not_found'];
const when = (e: number) => `${dayKey(e)} ${timeOf(e)}`;
const field = 'mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy';

export async function loadEvents(): Promise<void> {
  const { t, tf, me, showToast } = deps();
  const list = document.getElementById('socialEventList');
  if (!list) return;
  const modes = await api.events();
  const now = Math.floor(Date.now() / 1000);
  list.innerHTML = modes.map((m) => {
    const state = m.active ? 'active' : m.closedAt !== null || m.endsAt <= now ? 'ended' : 'upcoming';
    const badge = state === 'active' ? 'bg-green-100 text-green-900' : state === 'ended' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-900';
    return `<div data-event="${esc(m.id)}" class="p-3 mb-2 bg-white rounded-2xl border border-border">
      <div class="flex flex-wrap items-center gap-2"><strong class="text-navy">${esc(m.name)}</strong>
        <span class="px-2 rounded-full text-xs ${badge}">${esc(t(`admin.social.events.${state}`))}</span>
        <span class="text-xs text-gray-500">${esc(when(m.startsAt))} - ${esc(when(m.endsAt))}</span></div>
      <p class="text-xs text-gray-500 mt-1">${esc(tf('admin.social.events.editors', { list: m.editorEmails.join(', ') }))}</p>
      ${me.isPublisher && state !== 'ended' ? `<div class="mt-2">${button(t('admin.social.events.close'), 'data-close-event', 'danger')}</div>` : ''}</div>`;
  }).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.events.none'))}</p>`;
  list.querySelectorAll<HTMLElement>('[data-event]').forEach((el) => {
    const b = el.querySelector<HTMLButtonElement>('[data-close-event]');
    if (b) armConfirm(b, async () => {
      try {
        await api.closeEvent(el.dataset.event!);
        showToast(t('admin.social.events.closed'));
        changed();
      } catch (err) {
        showToast(errorText(err), true);
        // Already closed or removed elsewhere (a server 404 carries no code): reload so the list shows the current state.
        if (err instanceof ApiError && (err.status === 404 || CLOSE_STALE_CODES.includes(err.code))) changed();
      }
    });
  });
  if (me.isPublisher) await renderForm();
}

async function renderForm(): Promise<void> {
  const { t, showToast } = deps();
  const form = document.getElementById('socialEventForm') as HTMLFormElement | null;
  if (!form || form.dataset.ready === '1') return;
  form.dataset.ready = '1';
  let people: Awaited<ReturnType<typeof editorsCache>> = [];
  try { people = await editorsCache(); } catch { people = []; }
  const now = Math.floor(Date.now() / 1000);
  form.innerHTML = `<h3 class="font-semibold text-navy mb-2">${esc(t('admin.social.events.newTitle'))}</h3>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.events.name'))}<input name="name" required maxlength="80" class="${field}"></label>
    <div class="flex flex-wrap gap-3 mt-2">
      <label class="block text-xs text-gray-500">${esc(t('admin.social.events.start'))}<input name="start" type="datetime-local" required class="${field}" value="${esc(epochToIstanbulInput(now))}"></label>
      <label class="block text-xs text-gray-500">${esc(t('admin.social.events.end'))}<input name="end" type="datetime-local" required class="${field}" value="${esc(epochToIstanbulInput(now + 2 * 86400))}"></label>
    </div>
    <fieldset class="mt-2 text-xs text-gray-500">${esc(t('admin.social.events.pickEditors'))}<div class="flex flex-wrap gap-3 mt-1">
      ${people.filter((p) => !p.isPublisher).map((p) => `<label class="inline-flex items-center gap-2 min-h-11 lg:min-h-0 text-sm text-navy"><input type="checkbox" name="editor" value="${esc(p.id)}"> ${esc(p.name ?? p.email)}</label>`).join('')}
    </div></fieldset>
    <button type="submit" class="mt-3 px-3 py-1.5 min-h-11 lg:min-h-0 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40 disabled:cursor-not-allowed">${esc(t('admin.social.events.open'))}</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      name: String(f.get('name')).trim(),
      startsAt: istanbulInputToEpoch(String(f.get('start'))) ?? -1,
      endsAt: istanbulInputToEpoch(String(f.get('end'))) ?? -1,
      editorIds: f.getAll('editor').map(String),
    };
    const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    submitBtn.disabled = true;
    void (async () => {
      try { await api.openEvent(body); showToast(t('admin.social.events.opened')); form.reset(); changed(); } catch (err) { showToast(errorText(err), true); } finally { submitBtn.disabled = false; }
    })();
  });
}
