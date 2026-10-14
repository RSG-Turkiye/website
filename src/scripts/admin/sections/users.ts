/**
 * Users and roles: a list of rows with a detail panel (Kullanıcılar), and
 * one card per role with the people who hold it (Yetkiler). Every action the
 * old table row offered is still here; only the layout changed.
 */
import { RANK_LABELS, type Rank } from '../../../lib/badges';
import { escapeHtml } from '../../escape-html';
import { lang, t, tf, showToast, formatDate } from '../context';
import { row, chip, switchControl, armConfirm, BTN, emptyState } from '../ui-kit';
import { loadSenders } from './mail';

/** Each role as a switch: on → make_*, off → remove_*. Order and copy shown in the detail panel and on the Roles tab. */
export const ROLE_SWITCHES = [
  { flag: 'is_admin', on: 'make_admin', off: 'remove_admin', label: 'admin.roles.admin', hint: 'admin.roles.adminHint' },
  { flag: 'is_announcer', on: 'make_announcer', off: 'remove_announcer', label: 'admin.roles.announcer', hint: 'admin.roles.announcerHint' },
  { flag: 'is_writer', on: 'make_writer', off: 'remove_writer', label: 'admin.roles.writer', hint: 'admin.roles.writerHint' },
  { flag: 'is_sender', on: 'make_sender', off: 'remove_sender', label: 'admin.roles.sender', hint: 'admin.roles.senderHint' },
  { flag: 'is_symposium', on: 'make_symposium', off: 'remove_symposium', label: 'admin.roles.symposium', hint: 'admin.roles.symposiumHint' },
  { flag: 'is_social', on: 'make_social', off: 'remove_social', label: 'admin.roles.social', hint: 'admin.roles.socialHint' },
  { flag: 'is_social_publisher', on: 'make_social_publisher', off: 'remove_social_publisher', label: 'admin.roles.socialPublisher', hint: 'admin.roles.socialPublisherHint' },
] as const;

type RoleSwitch = (typeof ROLE_SWITCHES)[number];
type User = Record<string, any>;

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const CONFIRM = () => t('admin.users.detail.confirm');

let currentFilter = 'all';
let searchTimer: ReturnType<typeof setTimeout>;
let badgeCatalog: Array<{ code: string; name_en: string; name_tr: string }> = [];
/** The users the list last showed (before the client-side "has a role" filter). */
let listed: User[] = [];
let selectedId: string | null = null;
let meId: string | null = null;
/** Null until the Roles tab is first opened; after that it is kept fresh. */
let rolesUsers: User[] | null = null;

// English-only: the Turkish admin page never rendered rank management, so
// there is no Turkish wording to move here.
// Ranks come from lib/badges.ts, which is what renders a member's actual
// badge, so the dropdown cannot drift from what the member sees.
const RANK_EMOJI: Record<Rank, string> = {
  seed: '🌱', sprout: '🌿', sapling: '🌳', legacy_tree: '🌲',
};
const RANKS = (Object.keys(RANK_LABELS) as Rank[]).map((value) => ({
  value,
  label: `${RANK_EMOJI[value]} ${RANK_LABELS[value][lang]}`,
}));

/** The signed-in admin, so that taking admin from oneself asks twice. */
export function setCurrentUserId(id: string | null): void {
  meId = id;
}

const hasRole = (u: User) => ROLE_SWITCHES.some((r) => !!u[r.flag]);
const displayName = (u: User): string => u.display_name || u.email;

async function patchUser(userId: string, action: string, value?: string): Promise<boolean> {
  const res = await fetch('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, action, value }),
  });
  if (res.ok) {
    showToast(t('admin.toast.done'));
    return true;
  }
  const err = await res.json().catch(() => ({})) as { error?: string };
  showToast(err.error || t('admin.toast.error'), true);
  return false;
}

/** After a change: the list (keeping the selection), the Roles tab once opened, and the senders list, which shows the sender role too. */
async function refreshAfterChange(): Promise<void> {
  await Promise.all([loadUsers(), rolesUsers ? loadRolesView() : Promise.resolve(), loadSenders()]);
}

export async function doAction(userId: string, action: string, control: HTMLButtonElement | HTMLSelectElement | HTMLInputElement, value?: string) {
  control.disabled = true;
  if (await patchUser(userId, action, value)) {
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
    ...ROLE_SWITCHES.filter((r) => !!u[r.flag]).map((r) => chip(t(r.label), 'navy')),
    u.is_public === 0 ? chip(t('admin.badge.private'), 'amber') : '',
  ].join('');
}

export function renderUsers(users: User[]) {
  listed = users;
  const shown = currentFilter === 'roles' ? users.filter(hasRole) : users;
  const box = document.getElementById('usersList')!;
  document.getElementById('emptyState')!.classList.toggle('hidden', shown.length > 0);

  box.innerHTML = shown.map((u) => row({
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

  const current = shown.find((u) => u.id === selectedId);
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
  `<h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-5 mb-2">${t(key)}</h4>`;

/** armConfirm's two clicks, for a switch: the hint says "click again" and the first flip is undone. */
function armSwitch(sw: HTMLInputElement): void {
  const hint = sw.parentElement!.querySelector('label span:last-child')!;
  const original = hint.textContent;
  let timer: ReturnType<typeof setTimeout> | null = null;
  sw.addEventListener('click', (e) => {
    if (sw.dataset.armed === '1') {
      if (timer) clearTimeout(timer);
      sw.dataset.armed = '';
      hint.textContent = original;
      return;
    }
    e.preventDefault();
    sw.dataset.armed = '1';
    hint.textContent = CONFIRM();
    timer = setTimeout(() => { sw.dataset.armed = ''; hint.textContent = original; }, 4000);
  });
}

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
    <h3 class="text-base font-semibold text-navy break-words">${escapeHtml(displayName(u))}</h3>
    <p class="text-xs text-gray-500 break-all">${escapeHtml(u.email)}</p>
    ${meta ? `<p class="text-xs text-gray-500 break-words">${escapeHtml(meta)}</p>` : ''}
    <p class="text-xs text-gray-500">${t('admin.table.joined')}: ${formatDate(u.created_at)}</p>

    ${heading('admin.users.detail.membership')}
    <div class="flex flex-wrap items-center gap-2">
      ${membershipChip(u)}
      <button type="button" data-action="${u.is_member ? 'unverify' : 'verify'}" class="${BTN.secondary}">${t(u.is_member ? 'admin.action.unverify' : 'admin.action.verify')}</button>
    </div>

    ${heading('admin.users.detail.roles')}
    <div>${ROLE_SWITCHES.map((r) => switchControl({
      id: `role-${r.flag}`,
      checked: !!u[r.flag],
      label: t(r.label),
      hint: t(r.hint),
      attrs: `data-flag="${r.flag}" data-action-on="${r.on}" data-action-off="${r.off}"`,
    })).join('')}</div>

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
    // The server allows it; this only stops a slip.
    if (sw.dataset.flag === 'is_admin' && id === meId && sw.checked) armSwitch(sw);
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
  // "Has a role" is filtered here, from everyone the server returns.
  const params = new URLSearchParams({ filter: currentFilter === 'roles' ? 'all' : currentFilter });
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

/** Everyone the server lists (its 100-row cap applies), for the role cards. */
export async function loadRolesView(): Promise<void> {
  const res = await fetch('/api/admin/users?filter=all');
  if (!res.ok) return;
  const data = await res.json() as { users: User[] };
  renderRolesView(data.users);
}

function personChip(u: User, r: RoleSwitch): string {
  const name = escapeHtml(displayName(u));
  return `<span data-person="${escapeHtml(String(u.id))}" class="inline-flex items-center gap-1 max-w-full pl-3 rounded-full bg-gray-100 text-xs text-gray-600">
    <span class="truncate" title="${escapeHtml(u.email)}">${name}</span>
    <button type="button" data-remove="${r.off}" aria-label="${escapeHtml(tf('admin.roles.removePerson', { name: displayName(u) }))}"
      class="shrink-0 min-w-11 min-h-11 lg:min-w-7 lg:min-h-7 px-2 inline-flex items-center justify-center rounded-full text-gray-500 hover:text-red ${FOCUS}">×</button>
  </span>`;
}

export function renderRolesView(users: User[]): void {
  rolesUsers = users;
  const box = document.getElementById('rolesView');
  if (!box) return;
  box.innerHTML = `<h2 class="text-lg font-semibold text-navy mb-4">${t('admin.nav.roles')}</h2>
    <div class="grid gap-3 lg:grid-cols-2">${ROLE_SWITCHES.map((r) => {
      const people = users.filter((u) => !!u[r.flag]);
      return `<div data-role-card="${r.flag}" class="bg-white rounded-2xl border border-border p-4 min-w-0">
        <h3 class="text-sm font-semibold text-navy">${t(r.label)}</h3>
        <p class="text-xs text-gray-500 mb-3">${t(r.hint)}</p>
        <div class="flex flex-wrap items-center gap-1">
          ${people.length ? people.map((u) => personChip(u, r)).join('') : `<p class="text-xs text-gray-500">${t('admin.roles.nobody')}</p>`}
        </div>
        <button type="button" data-add-role aria-expanded="false" class="mt-3 ${BTN.ghost} border border-dashed border-border">+ ${t('admin.roles.addPerson')}</button>
        <div data-add-box class="hidden mt-2">
          <input data-add-input type="search" placeholder="${escapeHtml(t('admin.roles.addPlaceholder'))}" aria-label="${escapeHtml(t('admin.roles.addPlaceholder'))}"
            class="w-full min-h-11 lg:min-h-9 px-3 rounded-xl border border-border text-sm text-navy placeholder-gray-500 focus:outline-none focus:border-navy-mid ${FOCUS}" />
          <div data-add-results class="flex flex-col gap-1 mt-2"></div>
        </div>
      </div>`;
    }).join('')}</div>`;

  for (const r of ROLE_SWITCHES) {
    const card = box.querySelector<HTMLElement>(`[data-role-card="${r.flag}"]`)!;
    card.querySelectorAll<HTMLElement>('[data-person]').forEach((p) => {
      const btn = p.querySelector('button') as HTMLButtonElement;
      armConfirm(btn, CONFIRM(), () => doAction(p.dataset.person!, r.off, btn));
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
    input.addEventListener('input', () => {
      const q = input.value.trim().toLocaleLowerCase(lang);
      const matches = q
        ? users.filter((u) => !u[r.flag] && `${u.display_name ?? ''} ${u.email}`.toLocaleLowerCase(lang).includes(q)).slice(0, 8)
        : [];
      results.innerHTML = matches.map((u) => `<button type="button" data-add-user="${escapeHtml(String(u.id))}"
        class="text-left min-h-11 lg:min-h-9 px-3 py-1 rounded-xl border border-border hover:border-navy-mid min-w-0 ${FOCUS}">
        <span class="block text-sm text-navy truncate">${escapeHtml(displayName(u))}</span>
        <span class="block text-xs text-gray-500 truncate">${escapeHtml(u.email)}</span>
      </button>`).join('');
      results.querySelectorAll<HTMLButtonElement>('[data-add-user]').forEach((b) => {
        b.addEventListener('click', () => doAction(b.dataset.addUser!, r.on, b));
      });
    });
  }
}
