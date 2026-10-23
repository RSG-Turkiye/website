/**
 * Users and roles: a list of rows with a detail panel (Kullanıcılar), and
 * one card per role with the people who hold it (Yetkiler). Every action the
 * old table row offered is still here; only the layout changed.
 */
import { RANK_LABELS, type Rank } from '../../../lib/badges';
import { escapeHtml } from '../../escape-html';
import { lang, t, tf, showToast, formatDate, dateLocale } from '../context';
import { row, chip, switchControl, armConfirm, BTN, emptyState } from '../ui-kit';
import { loadSenders } from './mail';
import { roleDef, resolveExpiry, addMonths, grantableBy, type Duration } from '../../../../functions/_lib/roles';
import { epochToIstanbulInput, istanbulInputToEpoch } from '../../../lib/istanbul-time';

/**
 * Each role as a switch: on → make_*, off → remove_*. Order and copy shown in
 * the detail panel and on the Roles tab. `flag` is the users.is_* column; a
 * content role has none, so its flag is its role key and who holds it comes
 * from the grants the list carries (see held).
 */
export const ROLE_SWITCHES = [
  { flag: 'is_admin', role: 'admin', on: 'make_admin', off: 'remove_admin', label: 'admin.roles.admin', hint: 'admin.roles.adminHint' },
  { flag: 'is_announcer', role: 'announcer', on: 'make_announcer', off: 'remove_announcer', label: 'admin.roles.announcer', hint: 'admin.roles.announcerHint' },
  { flag: 'is_writer', role: 'writer', on: 'make_writer', off: 'remove_writer', label: 'admin.roles.writer', hint: 'admin.roles.writerHint' },
  { flag: 'is_sender', role: 'sender', on: 'make_sender', off: 'remove_sender', label: 'admin.roles.sender', hint: 'admin.roles.senderHint' },
  { flag: 'is_symposium', role: 'symposium', on: 'make_symposium', off: 'remove_symposium', label: 'admin.roles.symposium', hint: 'admin.roles.symposiumHint' },
  { flag: 'is_social', role: 'social', on: 'make_social', off: 'remove_social', label: 'admin.roles.social', hint: 'admin.roles.socialHint' },
  { flag: 'is_social_publisher', role: 'social_publisher', on: 'make_social_publisher', off: 'remove_social_publisher', label: 'admin.roles.socialPublisher', hint: 'admin.roles.socialPublisherHint' },
  { flag: 'content.etkinlikler.edit', role: 'content.etkinlikler.edit', on: 'make_content.etkinlikler.edit', off: 'remove_content.etkinlikler.edit', label: 'admin.roles.etkinliklerEdit', hint: 'admin.roles.etkinliklerEditHint' },
  { flag: 'content.etkinlikler.approve', role: 'content.etkinlikler.approve', on: 'make_content.etkinlikler.approve', off: 'remove_content.etkinlikler.approve', label: 'admin.roles.etkinliklerApprove', hint: 'admin.roles.etkinliklerApproveHint' },
] as const;

type RoleSwitch = (typeof ROLE_SWITCHES)[number];
type User = Record<string, any>;

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const CONFIRM = () => t('admin.users.detail.confirm');

let currentFilter = 'all';
let searchTimer: ReturnType<typeof setTimeout>;
let badgeCatalog: Array<{ code: string; name_en: string; name_tr: string }> = [];
/** The users the list last showed. */
let listed: User[] = [];
let selectedId: string | null = null;
let meId: string | null = null;
/** Null until the Roles tab is first opened; after that it is kept fresh. */
let rolesUsers: User[] | null = null;
/**
 * Who is granting, for the duration rule. An admin by default; a non-admin
 * approver sees only the cards of the roles they may grant, with the choices
 * the rule allows them (a month at most).
 */
let granter = { isAdmin: true, activeRoles: [] as string[] };

export function setGranter(g: { isAdmin: boolean; activeRoles: string[] }): void {
  granter = g;
}

// Ranks and their labels in both languages come from lib/badges.ts, which is
// what renders a member's actual badge, so the dropdown cannot drift from
// what the member sees.
const RANK_EMOJI: Record<Rank, string> = {
  seed: '🌱', sprout: '🌿', sapling: '🌳', legacy_tree: '🌲',
};
const RANKS = (Object.keys(RANK_LABELS) as Rank[]).map((value) => ({
  value,
  label: `${RANK_EMOJI[value]} ${RANK_LABELS[value][lang]}`,
}));

/**
 * The signed-in admin. The server refuses removing one's own admin role, so
 * their own Admin switch is shown locked and the Admin card has no × for them.
 */
export function setCurrentUserId(id: string | null): void {
  meId = id;
}

const isSelfAdmin = (userId: string, flag: string) => flag === 'is_admin' && userId === meId;
/** The column when the role has one, else a live grant. */
const held = (u: User, r: RoleSwitch): boolean =>
  !!u[r.flag] || !!(u.grants as Grant[] | undefined)?.some((g) => g.role === r.role);
const displayName = (u: User): string => u.display_name || u.email;

/** The server's refusal codes for a duration, in the panel's language. */
const DURATION_ERRORS: Record<string, Parameters<typeof t>[0]> = {
  too_long: 'admin.roles.err.tooLong',
  permanent_not_allowed: 'admin.roles.err.permanentNotAllowed',
  in_the_past: 'admin.roles.err.inThePast',
  bad_duration: 'admin.roles.err.badDuration',
  not_allowed: 'admin.roles.err.notAllowed',
};

/** True on success. A refusal or a network failure says so in a toast and returns false. */
async function patchUser(userId: string, action: string, value?: string, duration?: Duration): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, action, value, duration }),
    });
    if (res.ok) {
      showToast(t('admin.toast.done'));
      return true;
    }
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
    const coded = err.code && Object.hasOwn(DURATION_ERRORS, err.code) ? t(DURATION_ERRORS[err.code]) : '';
    showToast(coded || err.error || t('admin.toast.error'), true);
  } catch {
    showToast(t('admin.toast.error'), true);
  }
  return false;
}

/** After a change: the list (keeping the selection), the Roles tab once opened, and the senders list, which shows the sender role too. */
async function refreshAfterChange(): Promise<void> {
  // An approver has only the Roles tab; the list and senders are an admin's.
  if (!granter.isAdmin) return loadRolesView();
  await Promise.all([loadUsers(), rolesUsers ? loadRolesView() : Promise.resolve(), loadSenders()]);
}

export async function doAction(userId: string, action: string, control: HTMLButtonElement | HTMLSelectElement | HTMLInputElement, value?: string, duration?: Duration) {
  control.disabled = true;
  if (await patchUser(userId, action, value, duration)) {
    await refreshAfterChange();
    return;
  }
  control.disabled = false;
  // A switch already shows the new state; put it back.
  if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = !control.checked;
}

function membershipChip(u: User): string {
  return u.is_member ? chip(t('admin.badge.member'), 'green') : chip(t('admin.badge.pendingStatus'), 'neutral');
}

function rowChips(u: User): string {
  return [
    membershipChip(u),
    ...ROLE_SWITCHES.filter((r) => held(u, r)).map((r) => chip(t(r.label), 'navy')),
    u.is_public === 0 ? chip(t('admin.badge.private'), 'amber') : '',
  ].join('');
}

export function renderUsers(users: User[]) {
  listed = users;
  const box = document.getElementById('usersList')!;
  document.getElementById('emptyState')!.classList.toggle('hidden', users.length > 0);

  box.innerHTML = users.map((u) => row({
    title: displayName(u),
    subtitle: u.email,
    chips: rowChips(u),
    attrs: `data-user="${escapeHtml(String(u.id))}" role="button" tabindex="0"`,
    selected: u.id === selectedId,
  })).join('');

  box.querySelectorAll<HTMLElement>('[data-user]').forEach((el) => {
    el.classList.add('cursor-pointer', 'hover:border-navy-mid', ...FOCUS.split(' '));
    el.addEventListener('click', () => select(el.dataset.user!));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(el.dataset.user!);
      }
    });
  });

  const current = users.find((u) => u.id === selectedId);
  if (current) {
    renderDetail(current);
  } else {
    selectedId = null;
    renderDetail(null);
    closeDetail();
  }
}

function select(id: string): void {
  const u = listed.find((x) => x.id === id);
  if (!u) return;
  selectedId = id;
  document.querySelectorAll<HTMLElement>('#usersList [data-user]').forEach((el) => {
    const on = el.dataset.user === id;
    el.classList.toggle('border-navy-mid', on);
    el.classList.toggle('bg-navy-light/40', on);
    el.classList.toggle('border-border', !on);
  });
  renderDetail(u);
  // From lg up the detail is its own scroll box: start each person at the top.
  document.getElementById('userDetail')!.scrollTop = 0;
  openDetail();
}

/** Phone only: the detail replaces the list. On a wide screen both always show. */
function openDetail(): void {
  document.getElementById('usersPane')!.classList.add('hidden', 'lg:block');
  document.getElementById('userDetail')!.classList.remove('hidden');
  if (window.matchMedia('(max-width: 1023px)').matches) document.getElementById('userDetail')!.scrollIntoView({ block: 'start' });
}

function closeDetail(): void {
  document.getElementById('usersPane')!.classList.remove('hidden', 'lg:block');
  document.getElementById('userDetail')!.classList.add('hidden');
}

const heading = (key: Parameters<typeof t>[0]) =>
  `<h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-5 lg:mt-4 mb-2 lg:mb-1">${t(key)}</h4>`;

function renderDetail(u: User | null): void {
  const box = document.getElementById('userDetail')!;
  if (!u) {
    box.innerHTML = emptyState(t('admin.users.detail.select'));
    return;
  }
  const id = String(u.id);
  const meta = [u.username ? `@${u.username}` : '', u.institution || ''].filter(Boolean).join(' · ');
  const earned = new Set(String(u.badge_codes || '').split(',').filter(Boolean));
  const badgeChips = badgeCatalog.map((b) => {
    const on = earned.has(b.code);
    return `<button type="button" data-code="${escapeHtml(b.code)}" data-earned="${on}"
      class="badge-chip min-h-11 lg:min-h-0 text-xs px-3 py-1 rounded-full border transition-colors ${on ? 'bg-navy text-white border-navy' : 'bg-white text-gray-500 border-border hover:border-navy-mid'} ${FOCUS}"
      title="${escapeHtml(lang === 'tr' ? b.name_en : b.name_tr)}">${escapeHtml(lang === 'tr' ? b.name_tr : b.name_en)}</button>`;
  }).join('');

  box.innerHTML = `
    <button type="button" id="userDetailBack" aria-label="${escapeHtml(t('admin.nav.back'))}"
      class="lg:hidden w-11 h-11 -ml-2 mb-1 inline-flex items-center justify-center rounded-xl text-navy text-2xl ${FOCUS}">‹</button>
    <h3 class="text-base lg:text-sm font-semibold text-navy break-words">${escapeHtml(displayName(u))}</h3>
    <p class="text-xs text-gray-500 break-all">${escapeHtml(u.email)}</p>
    ${meta ? `<p class="text-xs text-gray-500 break-words">${escapeHtml(meta)}</p>` : ''}
    <p class="text-xs text-gray-500">${t('admin.table.joined')}: ${formatDate(u.created_at)}</p>

    ${heading('admin.users.detail.membership')}
    <div class="flex flex-wrap items-center gap-2">
      ${membershipChip(u)}
      <button type="button" data-action="${u.is_member ? 'unverify' : 'verify'}" class="${BTN.secondary}">${t(u.is_member ? 'admin.action.unverify' : 'admin.action.verify')}</button>
    </div>

    ${heading('admin.users.detail.roles')}
    <div>${ROLE_SWITCHES.map((r) => {
      const locked = isSelfAdmin(id, r.flag);
      return switchControl({
        id: `role-${r.flag}`,
        checked: held(u, r),
        label: t(r.label),
        hint: t(locked ? 'admin.roles.adminSelfHint' : r.hint),
        attrs: `data-flag="${r.flag}" data-action-on="${r.on}" data-action-off="${r.off}"${locked ? ' disabled' : ''}`,
      });
    }).join('')}</div>

    ${heading('admin.users.detail.profile')}
    <div class="flex flex-wrap items-center gap-2">
      ${u.is_public === 0 ? chip(t('admin.badge.private'), 'amber') : ''}
      <button type="button" data-action="make_private" class="${BTN.secondary}">${t('admin.action.makePrivate')}</button>
      <button type="button" data-action="clear_bio" class="${BTN.danger}">${t('admin.action.clearBio')}</button>
    </div>

    ${heading('admin.users.detail.rank')}
    <select class="rank-select w-full min-h-11 lg:min-h-9 text-sm px-3 rounded-xl border border-border text-navy bg-white focus:outline-none focus:border-navy-mid ${FOCUS}">
      ${RANKS.map((r) => `<option value="${r.value}" ${u.current_rank === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
    </select>

    ${badgeCatalog.length ? `${heading('admin.users.detail.badges')}<div class="flex flex-wrap gap-1">${badgeChips}</div>` : ''}
  `;

  box.querySelector('#userDetailBack')!.addEventListener('click', closeDetail);

  const verify = box.querySelector('[data-action="verify"], [data-action="unverify"]') as HTMLButtonElement;
  verify.addEventListener('click', () => doAction(id, verify.dataset.action!, verify));

  for (const action of ['make_private', 'clear_bio']) {
    const btn = box.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;
    armConfirm(btn, CONFIRM(), () => doAction(id, action, btn));
  }

  box.querySelectorAll<HTMLInputElement>('input[role="switch"]').forEach((sw) => {
    sw.addEventListener('change', () => doAction(id, sw.checked ? sw.dataset.actionOn! : sw.dataset.actionOff!, sw));
  });

  const rank = box.querySelector('.rank-select') as unknown as HTMLSelectElement;
  rank.addEventListener('change', () => doAction(id, 'set_rank', rank, rank.value));

  box.querySelectorAll<HTMLButtonElement>('.badge-chip').forEach((b) => {
    b.addEventListener('click', () => doAction(id, b.dataset.earned === 'true' ? 'revoke_badge' : 'award_badge', b, b.dataset.code));
  });
}

export async function loadUsers() {
  const search = (document.getElementById('searchInput') as HTMLInputElement).value.trim();
  // "Has a role" is filter=roles, filtered by the server before its 100-row cap.
  const params = new URLSearchParams({ filter: currentFilter });
  if (search) params.set('search', search);

  const res = await fetch(`/api/admin/users?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { users: User[]; badge_catalog?: typeof badgeCatalog };
  badgeCatalog = data.badge_catalog ?? [];
  renderUsers(data.users);
}

export function setupUsersFilters(): void {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = (btn as HTMLButtonElement).dataset.filter!;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter'));
      btn.classList.add('active-filter');
      loadUsers();
    });
  });

  document.getElementById('searchInput')!.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, 350);
  });
}

// Roles tab

/** Everyone who holds a role, for the role cards; the server filters before its 100-row cap. */
export async function loadRolesView(): Promise<void> {
  const res = await fetch('/api/admin/users?filter=roles');
  if (!res.ok) return;
  const data = await res.json() as { users: User[] };
  renderRolesView(data.users);
}

// Durations

const DAY = 86400;
const MONTH_CHOICES = [1, 2, 3, 6, 12] as const;

const nowSeconds = () => Math.floor(Date.now() / 1000);
/** YYYY-MM-DD of `ts` in Istanbul, whatever the browser's timezone. */
const istanbulDay = (ts: number) => epochToIstanbulInput(ts).slice(0, 10);

/**
 * The choices the server would accept for this role now, from the same rule
 * it runs (functions/_lib/roles.ts). Its 400 stays the final word.
 */
function allowedDurations(r: RoleSwitch, now: number) {
  const def = roleDef(r.role)!;
  const months = MONTH_CHOICES.filter((m) => resolveExpiry(def, { months: m }, now, granter).ok);
  const permanent = resolveExpiry(def, { permanent: true }, now, granter).ok;
  return { months, permanent, latest: addMonths(now, Math.max(...months)), leader: def.level === 'leader' };
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_UNITS = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TR_TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

/** The Turkish dative ending for a word as it is read aloud: Kasım → a, Ekim → e, altı → ya. */
function trDative(spoken: string): string {
  const vowels = spoken.match(/[aıoueiöü]/g) ?? ['a'];
  const v = 'aıou'.includes(vowels[vowels.length - 1]) ? 'a' : 'e';
  return /[aıoueiöü]$/.test(spoken) ? `y${v}` : v;
}

/**
 * "until 30 Nov" / "30 Kasım'a kadar", with the year only when it is not this
 * year. `ends` is the first moment without the role, so the day shown is the
 * one of the second before it: a date picked as "until 30 Nov" ends at 00:00
 * on 1 Dec and shows 30 Nov; a grant by months ends mid-day and shows that day.
 */
function untilLabel(ends: number): string {
  const last = ends - 1;
  const day = istanbulDay(last);
  const year = Number(day.slice(0, 4));
  const withYear = year !== Number(istanbulDay(nowSeconds()).slice(0, 4));
  const date = new Date(last * 1000).toLocaleDateString(dateLocale, {
    day: 'numeric', month: lang === 'tr' ? 'long' : 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'Europe/Istanbul',
  });
  if (lang !== 'tr') return tf('admin.roles.until', { date });
  // The ending follows the word read last: the month name, or the year's last spoken number.
  const spoken = withYear
    ? TR_UNITS[year % 10] || TR_TENS[Math.floor(year / 10) % 10] || (year % 1000 ? 'yüz' : 'bin')
    : TR_MONTHS[Number(day.slice(5, 7)) - 1];
  return tf('admin.roles.until', { date: `${date}'${trDative(spoken)}` });
}

/** The live grant's end for this person and role; null when permanent or when only the legacy flag is set. */
const grantEnd = (u: User, r: RoleSwitch): number | null =>
  (u.grants as Grant[] | undefined)?.find((g) => g.role === r.role)?.expires_at ?? null;

/**
 * The duration choice, for adding and renewing alike. A picked date is
 * inclusive: the role is held through that day and ends at 00:00 Istanbul the
 * next day. So the earliest date is today and the latest is the last day whose
 * following midnight the rule still accepts. Istanbul has no DST, so a day is
 * always 86400 s. Renewing a dated grant preselects the longest month count,
 * never Permanent, which stays an explicit choice.
 */
function durationPicker(r: RoleSwitch, who: string, confirmLabel: string, renewing = false): string {
  const now = nowSeconds();
  const { months, permanent, latest, leader } = allowedDurations(r, now);
  const preset = renewing ? String(months[months.length - 1]) : leader && permanent ? 'permanent' : String(months[0]);
  const lastDay = istanbulDay(latest - DAY);
  const choices: [string, string][] = [
    ...months.map((m): [string, string] => [String(m), m === 1 ? t('admin.roles.oneMonth') : tf('admin.roles.months', { n: m })]),
    ['date', t('admin.roles.untilDate')],
    ...(permanent ? [['permanent', t('admin.roles.permanent')] as [string, string]] : []),
  ];
  const field = `min-h-11 lg:min-h-9 text-sm px-3 rounded-xl border border-border text-navy bg-white focus:outline-none focus:border-navy-mid ${FOCUS}`;
  return `<div data-picker class="mt-2 p-3 lg:p-2 rounded-xl border border-navy-mid bg-navy-light/40 min-w-0">
    <p class="text-sm font-medium text-navy truncate mb-2">${escapeHtml(who)}</p>
    <div class="flex flex-wrap items-center gap-2">
      <select data-duration aria-label="${escapeHtml(t('admin.roles.duration'))}" class="${field}">
        ${choices.map(([v, label]) => `<option value="${v}"${v === preset ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
      </select>
      <input data-until type="date" aria-label="${escapeHtml(t('admin.roles.endDate'))}"
        min="${istanbulDay(now)}" max="${lastDay}" value="${lastDay}" class="hidden ${field}" />
      <div class="flex items-center gap-2">
        <button type="button" data-picker-confirm class="${BTN.primary}">${escapeHtml(confirmLabel)}</button>
        <button type="button" data-picker-cancel class="${BTN.ghost}">${t('admin.roles.cancel')}</button>
      </div>
    </div>
    <p data-not-later class="hidden mt-2 text-xs text-gray-600"></p>
  </div>`;
}

/**
 * Wires a picker rendered into `slot`; `onConfirm` gets the chosen duration
 * and the button to disable. With `currentEnd` (a renew), a choice that would
 * not end later disables the button and says why: the server would keep the
 * old grant, and a "done" toast would claim a change that did not happen.
 */
function armPicker(slot: HTMLElement, onConfirm: (d: Duration, btn: HTMLButtonElement) => void, onCancel: () => void, currentEnd: number | null = null): void {
  const select = slot.querySelector('[data-duration]') as unknown as HTMLSelectElement;
  const until = slot.querySelector<HTMLInputElement>('[data-until]')!;
  const confirm = slot.querySelector('[data-picker-confirm]') as HTMLButtonElement;
  const note = slot.querySelector<HTMLElement>('[data-not-later]')!;
  const chosen = (): Duration | null => {
    if (select.value === 'permanent') return { permanent: true };
    if (select.value === 'date') {
      const start = istanbulInputToEpoch(`${until.value}T00:00`);
      return start === undefined ? null : { until: start + DAY };
    }
    return { months: Number(select.value) as 1 };
  };
  const check = () => {
    if (currentEnd === null) return;
    const d = chosen();
    const end = !d ? null : 'until' in d ? d.until : 'months' in d ? addMonths(nowSeconds(), d.months) : Infinity;
    const notLater = end !== null && end <= currentEnd;
    confirm.disabled = notLater;
    note.textContent = notLater ? tf('admin.roles.notLater', { until: untilLabel(currentEnd) }) : '';
    note.classList.toggle('hidden', !notLater);
  };
  select.addEventListener('change', () => {
    until.classList.toggle('hidden', select.value !== 'date');
    if (select.value === 'date') until.focus();
    check();
  });
  until.addEventListener('input', check);
  until.addEventListener('change', check);
  confirm.addEventListener('click', () => {
    const d = chosen();
    if (!d) {
      showToast(t('admin.roles.err.badDuration'), true);
      return;
    }
    onConfirm(d, confirm);
  });
  slot.querySelector('[data-picker-cancel]')!.addEventListener('click', onCancel);
  check();
  select.focus();
}

type Grant = { role: string; expires_at: number | null };

function personChip(u: User, r: RoleSwitch, now: number): string {
  const name = escapeHtml(displayName(u));
  // A holder with no live grant row (the legacy flag alone) shows no date.
  const ends = grantEnd(u, r);
  const soon = ends !== null && ends - now <= 7 * DAY;
  const icon = `shrink-0 min-w-11 min-h-11 lg:min-w-7 lg:min-h-7 px-2 inline-flex items-center justify-center rounded-full text-gray-500 ${FOCUS}`;
  const renew = ends === null ? '' : `
    <button type="button" data-renew aria-label="${escapeHtml(tf('admin.roles.renewPerson', { name: displayName(u) }))}"
      title="${escapeHtml(t('admin.roles.renew'))}" class="${icon} hover:text-navy">↻</button>`;
  // No × on one's own Admin chip: the server refuses it (see setCurrentUserId).
  const remove = isSelfAdmin(String(u.id), r.flag) ? '' : `
    <button type="button" data-remove="${r.off}" aria-label="${escapeHtml(tf('admin.roles.removePerson', { name: displayName(u) }))}"
      class="${icon} hover:text-red">×</button>`;
  return `<span data-person="${escapeHtml(String(u.id))}"${soon ? ' data-ends-soon' : ''} class="inline-flex items-center gap-1 max-w-full pl-3 ${remove || renew ? '' : 'pr-3 min-h-11 lg:min-h-7'} rounded-full ${soon ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'} text-xs">
    <span class="truncate min-w-0" title="${escapeHtml(u.email)}">${name}</span>${ends === null ? '' : `<span class="shrink-0 whitespace-nowrap ${soon ? 'font-medium' : ''}">· ${escapeHtml(untilLabel(ends))}</span>`}${renew}${remove}
  </span>`;
}

/** People who match `q` on the server (not only the role holders loaded) and lack the role. */
async function searchToAdd(q: string, r: RoleSwitch): Promise<User[]> {
  try {
    const res = await fetch(`/api/admin/users?${new URLSearchParams({ filter: 'all', search: q })}`);
    if (!res.ok) return [];
    const data = await res.json() as { users: User[] };
    return data.users.filter((u) => !held(u, r)).slice(0, 8);
  } catch {
    return [];
  }
}

export function renderRolesView(users: User[]): void {
  rolesUsers = users;
  const box = document.getElementById('rolesView');
  if (!box) return;
  const now = nowSeconds();
  const mine = granter.isAdmin ? null : grantableBy(granter.activeRoles) as string[];
  const cards = ROLE_SWITCHES.filter((r) => !mine || mine.includes(r.role));
  box.innerHTML = `<h2 class="text-lg font-semibold text-navy mb-4 lg:sr-only">${t('admin.nav.roles')}</h2>
    <div class="grid gap-3 lg:grid-cols-2">${cards.map((r) => {
      const people = users.filter((u) => held(u, r));
      return `<div data-role-card="${r.flag}" class="bg-white rounded-2xl border border-border p-4 lg:p-3 min-w-0">
        <h3 class="text-sm font-semibold text-navy">${t(r.label)}</h3>
        <p class="text-xs text-gray-500 mb-3">${t(r.hint)}</p>
        <div class="flex flex-wrap items-center gap-1">
          ${people.length ? people.map((u) => personChip(u, r, now)).join('') : `<p class="text-xs text-gray-500">${t('admin.roles.nobody')}</p>`}
        </div>
        <div data-renew-slot></div>
        <button type="button" data-add-role aria-expanded="false" class="mt-3 ${BTN.ghost} border border-dashed border-border">+ ${t('admin.roles.addPerson')}</button>
        <div data-add-box class="hidden mt-2">
          <input data-add-input type="search" placeholder="${escapeHtml(t('admin.roles.addPlaceholder'))}" aria-label="${escapeHtml(t('admin.roles.addPlaceholder'))}"
            class="w-full min-h-11 lg:min-h-9 px-3 rounded-xl border border-border text-sm text-navy placeholder-gray-500 focus:outline-none focus:border-navy-mid ${FOCUS}" />
          <div data-add-results class="flex flex-col gap-1 mt-2"></div>
        </div>
      </div>`;
    }).join('')}</div>`;

  for (const r of cards) {
    const card = box.querySelector<HTMLElement>(`[data-role-card="${r.flag}"]`)!;
    const renewSlot = card.querySelector('[data-renew-slot]') as HTMLElement;
    card.querySelectorAll<HTMLElement>('[data-person]').forEach((p) => {
      const remove = p.querySelector<HTMLButtonElement>('[data-remove]');
      if (remove) armConfirm(remove, CONFIRM(), () => doAction(p.dataset.person!, r.off, remove));
      p.querySelector('[data-renew]')?.addEventListener('click', () => {
        const u = users.find((x) => String(x.id) === p.dataset.person)!;
        renewSlot.innerHTML = durationPicker(r, displayName(u), t('admin.roles.renew'), true);
        armPicker(renewSlot, (d, btn) => void doAction(p.dataset.person!, r.on, btn, undefined, d), () => { renewSlot.innerHTML = ''; }, grantEnd(u, r));
      });
    });

    const toggle = card.querySelector('[data-add-role]') as HTMLButtonElement;
    const addBox = card.querySelector('[data-add-box]') as HTMLElement;
    const input = card.querySelector('[data-add-input]') as HTMLInputElement;
    const results = card.querySelector('[data-add-results]') as HTMLElement;
    toggle.addEventListener('click', () => {
      const open = addBox.classList.toggle('hidden') === false;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) input.focus();
    });
    let timer: ReturnType<typeof setTimeout>;
    let latest = '';
    const showMatches = async (q: string) => {
      latest = q;
      const matches = q ? await searchToAdd(q, r) : [];
      if (q !== latest) return; // a newer search has started
      results.innerHTML = matches.map((u) => `<button type="button" data-add-user="${escapeHtml(String(u.id))}"
        class="text-left min-h-11 lg:min-h-9 px-3 py-1 rounded-xl border border-border hover:border-navy-mid min-w-0 ${FOCUS}">
        <span class="block text-sm text-navy truncate">${escapeHtml(displayName(u))}</span>
        <span class="block text-xs text-gray-500 truncate">${escapeHtml(u.email)}</span>
      </button>`).join('');
      results.querySelectorAll<HTMLButtonElement>('[data-add-user]').forEach((b) => {
        b.addEventListener('click', () => {
          const u = matches.find((x) => String(x.id) === b.dataset.addUser)!;
          results.innerHTML = durationPicker(r, displayName(u), t('admin.roles.add'));
          armPicker(results, (d, btn) => void doAction(b.dataset.addUser!, r.on, btn, undefined, d), () => void showMatches(latest));
        });
      });
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void showMatches(input.value.trim()), 350);
    });
  }
}
