/** Create or edit a plan slot (spec §2: plans are dashed boxes until content is attached). */
import { api, type Editor, type Plan, type Platform, type PostType } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, overlay, closeOverlay } from './ui';
import { DEFAULT_TIME, dayKey, timeOf, epochAt } from '../../lib/social-calendar';

let editors: Editor[] | null = null;
export async function editorsCache(): Promise<Editor[]> {
  if (!editors) editors = await api.editors();
  return editors;
}

const PLATFORMS: Platform[] = ['instagram', 'linkedin', 'x'];
const TYPES: PostType[] = ['image', 'carousel', 'story'];
const input = 'mt-1 w-full px-3 py-2 lg:py-1.5 rounded-xl border border-border text-sm text-navy';

export async function openPlanDialog(opts: { plan?: Plan; date?: string }): Promise<void> {
  const { t, showToast } = deps();
  const plan = opts.plan;
  let people: Editor[] = [];
  try { people = await editorsCache(); } catch { people = []; }
  const tomorrow = dayKey(Math.floor(Date.now() / 1000) + 86400);
  const date = plan ? dayKey(plan.scheduledAt) : opts.date ?? tomorrow;
  const time = plan ? timeOf(plan.scheduledAt) : DEFAULT_TIME;
  const o = overlay();
  o.innerHTML = `<form data-plan class="max-w-lg mx-auto mt-10 bg-white rounded-2xl border border-border p-5 space-y-3">
    <h3 class="font-semibold text-navy">${esc(t(plan ? 'admin.social.plan.editTitle' : 'admin.social.plan.newTitle'))}</h3>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.title'))}<input name="title" required maxlength="120" class="${input}" value="${esc(plan?.title ?? '')}"></label>
    <div class="flex gap-3">
      <label class="block text-xs text-gray-500 flex-1">${esc(t('admin.social.plan.date'))}<input name="date" type="date" required class="${input}" value="${esc(date)}"></label>
      <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.time'))}<input name="time" type="time" required class="${input}" value="${esc(time)}"></label>
    </div>
    <fieldset class="text-xs text-gray-500">${esc(t('admin.social.plan.platforms'))}<div class="flex gap-4 mt-1">
      ${PLATFORMS.map((p) => `<label class="text-sm text-navy"><input type="checkbox" name="platform" value="${p}" ${(plan?.platforms ?? ['instagram']).includes(p) ? 'checked' : ''}> ${esc(t(`admin.connections.platform.${p}`))}</label>`).join('')}
    </div></fieldset>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.type'))}<select name="type" class="${input}">
      ${TYPES.map((x) => `<option value="${x}" ${(plan?.postType ?? 'image') === x ? 'selected' : ''}>${esc(t(`admin.social.type.${x}`))}</option>`).join('')}</select></label>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.assignee'))}<select name="assignee" class="${input}">
      <option value="">${esc(t('admin.social.plan.nobody'))}</option>
      ${people.map((e) => `<option value="${esc(e.id)}" ${plan?.assigneeId === e.id ? 'selected' : ''}>${esc(e.name ? `${e.name} (${e.email})` : e.email)}</option>`).join('')}</select></label>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.note'))}<textarea name="note" maxlength="500" rows="2" class="${input}">${esc(plan?.note ?? '')}</textarea></label>
    <div class="flex gap-2 justify-end">${button(t('admin.social.plan.cancel'), 'data-close')}
      <button type="submit" class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40 disabled:cursor-not-allowed">${esc(t('admin.social.plan.save'))}</button></div>
  </form>`;
  o.classList.remove('hidden');
  o.querySelector('[data-close]')!.addEventListener('click', closeOverlay);
  const form = o.querySelector<HTMLFormElement>('[data-plan]')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const scheduledAt = epochAt(String(f.get('date')), String(f.get('time')));
    const body = {
      title: String(f.get('title')).trim(),
      scheduledAt: scheduledAt ?? -1,
      platforms: f.getAll('platform').map(String) as Platform[],
      postType: String(f.get('type')) as PostType,
      assigneeId: String(f.get('assignee')) || null,
      note: String(f.get('note')),
    };
    const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    submitBtn.disabled = true;
    void (async () => {
      try {
        if (plan) await api.updatePlan(plan.id, body); else await api.createPlan(body);
        showToast(t('admin.social.done.saved'));
        closeOverlay();
        changed();
      } catch (err) {
        showToast(errorText(err), true);
      } finally {
        submitBtn.disabled = false;
      }
    })();
  });
}
