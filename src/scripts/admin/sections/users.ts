import { RANK_LABELS, type Rank } from '../../../lib/badges';
import { escapeHtml } from '../../escape-html';
import { lang, t, showToast, formatDate } from '../context';
import { loadSenders } from './mail';

// One width for both languages: the Turkish labels are the longer ones.
const moreMenuWidthClass = 'min-w-[180px]';

let currentFilter = 'all';
let searchTimer: ReturnType<typeof setTimeout>;
let badgeCatalog: Array<{ code: string; name_en: string; name_tr: string }> = [];

// English-only: the Turkish admin page never rendered rank management, so
// there is no Turkish wording to move here (see module comment above).
// Ranks come from lib/badges.ts, which is what renders a member's actual
// badge -- so the dropdown cannot drift from what the member sees.
const RANK_EMOJI: Record<Rank, string> = {
  seed: '🌱', sprout: '🌿', sapling: '🌳', legacy_tree: '🌲',
};
const RANKS = (Object.keys(RANK_LABELS) as Rank[]).map((value) => ({
  value,
  label: `${RANK_EMOJI[value]} ${RANK_LABELS[value][lang]}`,
}));

export async function doAction(userId: string, action: string, btn: HTMLButtonElement | HTMLSelectElement, value?: string) {
  btn.disabled = true;
  const res = await fetch('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, action, value }),
  });
  if (res.ok) {
    showToast(t('admin.toast.done'));
    loadUsers();
    loadSenders();
  } else {
    const err = await res.json() as { error: string };
    showToast(err.error || t('admin.toast.error'), true);
    btn.disabled = false;
  }
}

export function renderUsers(users: any[]) {
  const tbody = document.getElementById('userTableBody')!;
  const empty = document.getElementById('emptyState')!;

  if (users.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = users.map(u => {
    // Escaped, all three. The email column below has always been escaped;
    // these two were not, and a member controls both. A payload in either one
    // runs in the admin's browser, where a same-origin fetch to
    // /api/admin/users can hand its sender is_admin -- and a new account sorts
    // to the top of this very list.
    const name = escapeHtml(u.display_name || '—');
    const username = u.username ? `@${escapeHtml(u.username)}` : `<span class="text-gray-500">${t('admin.user.noProfile')}</span>`;
    const institution = u.institution ? `<span class="text-xs text-gray-500">${escapeHtml(u.institution)}</span>` : '';
    const memberBadge = u.is_member
      ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">${t('admin.badge.member')}</span>`
      : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">${t('admin.badge.pendingStatus')}</span>`;
    const adminBadge = u.is_admin
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.admin')}</span>`
      : '';
    const announcerBadge = u.is_announcer
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.announcer')}</span>`
      : '';
    const writerBadge = u.is_writer
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.writer')}</span>`
      : '';
    const symposiumBadge = u.is_symposium
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.symposium')}</span>`
      : '';
    const socialBadge = u.is_social_publisher
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.socialPublisher')}</span>`
      : u.is_social
        ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.social')}</span>`
        : '';
    const senderBadge = u.is_sender
      ? `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ml-1">${t('admin.badge.mail')}</span>`
      : '';
    const privateBadge = u.is_public === 0
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700">${t('admin.badge.private')}</span>`
      : '';

    const verifyBtn = u.is_member
      ? `<button data-id="${u.id}" data-action="unverify" class="action-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.unverify')}</button>`
      : `<button data-id="${u.id}" data-action="verify" class="action-btn text-xs px-3 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.verify')}</button>`;

    const rankSelect = `
      <select data-id="${u.id}" class="rank-select text-xs px-2 py-1.5 rounded-lg border border-border text-navy bg-white focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid focus:border-navy-mid">
        ${RANKS.map(r => `<option value="${r.value}" ${u.current_rank === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>`;

    const badgeChips = (() => {
      const earnedCodes = new Set((u.badge_codes || '').split(',').filter(Boolean));
      return badgeCatalog.map(b => `
        <button
          data-id="${u.id}"
          data-code="${b.code}"
          data-earned="${earnedCodes.has(b.code)}"
          class="badge-chip text-xs px-2 py-1 rounded-full border transition-colors ${
            earnedCodes.has(b.code)
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-gray-500 border-border hover:border-navy-mid'
          } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid"
          title="${lang === 'tr' ? b.name_en : b.name_tr}"
        >${lang === 'tr' ? b.name_tr : b.name_en}</button>`).join(' ');
    })();

    const moreActions = `
      <div class="relative inline-block">
        <button data-menu="${u.id}" class="more-btn text-xs px-2 py-1.5 rounded-lg border border-border text-gray-500 hover:text-navy hover:border-navy-mid transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">⋯</button>
        <div id="menu-${u.id}" class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-border py-1 z-10 ${moreMenuWidthClass}">
          ${u.is_admin
            ? `<button data-id="${u.id}" data-action="remove_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeAdmin')}</button>`
            : `<button data-id="${u.id}" data-action="make_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeAdmin')}</button>`
          }
          ${u.is_announcer
            ? `<button data-id="${u.id}" data-action="remove_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeAnnouncer')}</button>`
            : `<button data-id="${u.id}" data-action="make_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeAnnouncer')}</button>`
          }
          ${u.is_writer
            ? `<button data-id="${u.id}" data-action="remove_writer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeWriter')}</button>`
            : `<button data-id="${u.id}" data-action="make_writer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeWriter')}</button>`
          }
          ${u.is_symposium
            ? `<button data-id="${u.id}" data-action="remove_symposium" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSymposium')}</button>`
            : `<button data-id="${u.id}" data-action="make_symposium" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSymposium')}</button>`
          }
          ${u.is_social_publisher
            ? `<button data-id="${u.id}" data-action="remove_social_publisher" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSocialPublisher')}</button>`
            : `<button data-id="${u.id}" data-action="make_social_publisher" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSocialPublisher')}</button>`}
          ${u.is_social || u.is_social_publisher
            ? `<button data-id="${u.id}" data-action="remove_social" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSocial')}</button>`
            : `<button data-id="${u.id}" data-action="make_social" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSocial')}</button>`}
          ${u.is_sender
            ? `<button data-id="${u.id}" data-action="remove_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSender')}</button>`
            : `<button data-id="${u.id}" data-action="make_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSender')}</button>`
          }
          <button data-id="${u.id}" data-action="make_private" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makePrivate')}</button>
          <button data-id="${u.id}" data-action="clear_bio" class="action-btn block w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.clearBio')}</button>
        </div>
      </div>`;

    return `
      <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
        <td class="px-5 py-4">
          <div class="font-medium text-navy">${name}</div>
          <div class="text-xs text-gray-500 mt-0.5">${username}</div>
          ${institution}
        </td>
        <td class="px-5 py-4 text-gray-500"><span class="block max-w-[28ch] truncate" title="${escapeHtml(u.email)}">${escapeHtml(u.email)}</span></td>
        <td class="px-5 py-4">${memberBadge}${adminBadge}${announcerBadge}${writerBadge}${symposiumBadge}${socialBadge}${senderBadge}${privateBadge}</td>
        <td class="px-5 py-4">${rankSelect}</td>
        <td class="px-5 py-4"><div class="flex flex-wrap gap-1 max-w-[220px]">${badgeChips}</div></td>
        <td class="px-5 py-4 text-gray-500 tabular-nums">${formatDate(u.created_at)}</td>
        <td class="px-5 py-4 text-right">
          <div class="flex items-center justify-end gap-2">
            ${verifyBtn}
            ${moreActions}
          </div>
        </td>
      </tr>`;
  }).join('');

  // Action buttons
  tbody.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      doAction(b.dataset.id!, b.dataset.action!, b);
    });
  });

  {
    // Rank select
    tbody.querySelectorAll('.rank-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const s = e.currentTarget as HTMLSelectElement;
        doAction(s.dataset.id!, 'set_rank', s, s.value);
      });
    });

    // Badge chips (toggle award/revoke)
    tbody.querySelectorAll('.badge-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        const earned = b.dataset.earned === 'true';
        doAction(b.dataset.id!, earned ? 'revoke_badge' : 'award_badge', b, b.dataset.code);
      });
    });
  }

  // More menus
  tbody.querySelectorAll('.more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLButtonElement).dataset.menu!;
      const menu = document.getElementById(`menu-${id}`)!;
      // Close all others
      document.querySelectorAll('[id^="menu-"]').forEach(m => {
        if (m.id !== `menu-${id}`) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('[id^="menu-"]').forEach(m => m.classList.add('hidden'));
  }, { once: true });
}

export async function loadUsers() {
  const search = (document.getElementById('searchInput') as HTMLInputElement).value.trim();
  const params = new URLSearchParams({ filter: currentFilter });
  if (search) params.set('search', search);

  const res = await fetch(`/api/admin/users?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { users: any[]; badge_catalog?: typeof badgeCatalog };
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
