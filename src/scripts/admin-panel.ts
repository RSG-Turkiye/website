// Shared client-side logic for the admin panel, used by both the English
// (/admin) and Turkish (/tr/admin) pages via AdminShell.astro. This used to
// be two 900-line near-clones of this file, one per language, with every
// user-facing string duplicated and hand-translated in place. All of that
// copy now lives in src/i18n/ui.ts under the `admin.*` keys; this module
// looks up the current page's language from the <html lang> attribute that
// BaseLayout already sets, and renders the same markup either way.
//
// Two behavioural differences between the two languages predate this
// refactor and are reproduced here exactly rather than resolved one way or
// the other:
//
//   - Rank & badge management (the extra "Rank" / "Badges" table columns,
//     the rank <select>, and the badge-chip toggles) only ever existed on
//     the English admin page. The Turkish page never had it. There is no
//     Turkish copy to move for it, so it stays as plain English constants
//     gated behind `showRankAndBadges`.
//   - The "more actions" dropdown is a few pixels wider on the Turkish page
//     (180px vs 160px) because the translated action labels are longer.
//
// Both are preserved as discovered, not as a decision made in this pass.

import { useTranslations } from '../i18n/ui';

type Lang = 'en' | 'tr';

const lang: Lang = document.documentElement.lang === 'tr' ? 'tr' : 'en';
const t = useTranslations(lang);

function tf(key: Parameters<typeof t>[0], vars: Record<string, string | number>): string {
  let result: string = t(key);
  for (const [k, v] of Object.entries(vars)) {
    result = result.split(`{${k}}`).join(String(v));
  }
  return result;
}

// See the module comment above: this pairing (rank/badges + menu width)
// reproduces a pre-existing English/Turkish behavioural gap, not a new flag.
const showRankAndBadges = lang === 'en';
const moreMenuWidthClass = lang === 'en' ? 'min-w-[160px]' : 'min-w-[180px]';
const dateLocale = lang === 'en' ? 'en-GB' : 'tr-TR';

let currentFilter = 'all';
let searchTimer: ReturnType<typeof setTimeout>;
let badgeCatalog: Array<{ code: string; name_en: string; name_tr: string }> = [];
let canManageAnnouncements = false;

// English-only: the Turkish admin page never rendered rank management, so
// there is no Turkish wording to move here (see module comment above).
const RANKS = [
  { value: 'seed', label: '🌱 Seed' },
  { value: 'sprout', label: '🌿 Sprout' },
  { value: 'sapling', label: '🌳 Sapling' },
  { value: 'legacy_tree', label: '🌲 Legacy Tree' },
];

const ATTACHMENT_ERRORS: Record<string, string> = {
  unsupported_type: t('admin.errors.unsupportedType'),
  missing_filename: t('admin.errors.missingFilename'),
  invalid_filename: t('admin.errors.invalidFilename'),
  empty_file: t('admin.errors.emptyFile'),
  attachments_too_large: t('admin.errors.attachmentsTooLarge'),
  missing_fields: t('admin.errors.missingFields'),
  malformed_request: t('admin.errors.malformedRequest'),
  forbidden: t('admin.errors.forbidden'),
  not_authenticated: t('admin.errors.notAuthenticated'),
};

function showToast(message: string, isError = false) {
  const toast = document.getElementById('toast')!;
  toast.textContent = message;
  toast.style.background = isError ? '#dc2626' : '#0f2045';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function formatDate(ts: number) {
  // Pinned to Istanbul, like the rest of the site's admin- and
  // member-facing dates -- two timezones on one screen is worse than
  // either. Date-only, so this only matters right around midnight, but
  // it also governs the announcement and blog-submission dates rendered
  // further down this page, not just anything from the scheduled-send
  // feature.
  return new Date(ts * 1000).toLocaleDateString(dateLocale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
}

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string));
}

function renderAnnouncements(items: any[]) {
  const tbody = document.getElementById('announcementsTableBody')!;
  const empty = document.getElementById('announcementsEmptyState')!;

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = items.map(a => `
    <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
      <td class="px-5 py-4 text-navy font-medium">${escapeHtml(a.title)}</td>
      <td class="px-5 py-4 text-gray-400">${formatDate(a.expires_at)}</td>
      <td class="px-5 py-4 text-gray-400">${a.show_as_popup ? t('admin.announcements.popupYes') : t('admin.announcements.popupNo')}</td>
      <td class="px-5 py-4 text-right">
        <button data-id="${a.id}" class="edit-announcement-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-navy-mid hover:text-navy transition-colors mr-2">${t('admin.announcements.edit')}</button>
        <button data-id="${a.id}" class="delete-announcement-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">${t('admin.announcements.delete')}</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-announcement-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
      const item = items.find(a => a.id === id);
      if (!item) return;
      (document.getElementById('announcementEditId') as HTMLInputElement).value = item.id;
      (document.getElementById('annTitle') as HTMLInputElement).value = item.title;
      (document.getElementById('annDescription') as HTMLTextAreaElement).value = item.description;
      (document.getElementById('annButtonText') as HTMLInputElement).value = item.button_text;
      (document.getElementById('annButtonUrl') as HTMLInputElement).value = item.button_url;
      const expiresDate = new Date(item.expires_at * 1000);
      const localExpiresDateStr = `${expiresDate.getFullYear()}-${String(expiresDate.getMonth() + 1).padStart(2, '0')}-${String(expiresDate.getDate()).padStart(2, '0')}`;
      (document.getElementById('annExpiresAt') as HTMLInputElement).value = localExpiresDateStr;
      (document.getElementById('annShowAsPopup') as HTMLInputElement).checked = item.show_as_popup;
      document.getElementById('cancelEditBtn')!.classList.remove('hidden');
    });
  });

  tbody.querySelectorAll('.delete-announcement-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      const res = await fetch(`/api/admin/announcements/${b.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { showToast(t('admin.toast.deleted')); await loadAnnouncements(); }
      else { showToast(t('admin.toast.error'), true); b.disabled = false; }
    });
  });
}

async function loadAnnouncements() {
  const res = await fetch('/api/admin/announcements');
  if (!res.ok) return;
  const data = await res.json() as { announcements: any[] };
  renderAnnouncements(data.announcements);
}

// One-time wiring of the announcement form's submit/cancel listeners.
// Must run exactly once for the page's lifetime — loadAnnouncements() is
// called repeatedly (after every create/update/delete) and #announcementForm
// / #cancelEditBtn are static DOM nodes, so attaching listeners inside
// loadAnnouncements would stack a new listener on every reload.
function setupAnnouncementForm() {
  if (!canManageAnnouncements) return;

  const form = document.getElementById('announcementForm') as HTMLFormElement;
  const cancelBtn = document.getElementById('cancelEditBtn')!;

  function resetForm() {
    form.reset();
    (document.getElementById('announcementEditId') as HTMLInputElement).value = '';
    cancelBtn.classList.add('hidden');
  }

  cancelBtn.addEventListener('click', resetForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = (document.getElementById('announcementEditId') as HTMLInputElement).value;
    const expiresDate = (document.getElementById('annExpiresAt') as HTMLInputElement).value;
    const body = {
      title: (document.getElementById('annTitle') as HTMLInputElement).value,
      description: (document.getElementById('annDescription') as HTMLTextAreaElement).value,
      button_text: (document.getElementById('annButtonText') as HTMLInputElement).value,
      button_url: (document.getElementById('annButtonUrl') as HTMLInputElement).value,
      show_as_popup: (document.getElementById('annShowAsPopup') as HTMLInputElement).checked,
      expires_at: Math.floor(new Date(expiresDate + 'T23:59:59').getTime() / 1000),
    };

    const url = editId ? `/api/admin/announcements/${editId}` : '/api/admin/announcements';
    const method = editId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      showToast(editId ? t('admin.toast.updated') : t('admin.toast.created'));
      resetForm();
      await loadAnnouncements();
    } else {
      const err = await res.json() as { error: string };
      showToast(err.error || t('admin.toast.error'), true);
    }
  });
}

async function doAction(userId: string, action: string, btn: HTMLButtonElement | HTMLSelectElement, value?: string) {
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

function renderUsers(users: any[]) {
  const tbody = document.getElementById('userTableBody')!;
  const empty = document.getElementById('emptyState')!;

  if (users.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = users.map(u => {
    const name = u.display_name || '—';
    const username = u.username ? `@${u.username}` : `<span class="text-gray-300">${t('admin.user.noProfile')}</span>`;
    const institution = u.institution ? `<span class="text-xs text-gray-400">${u.institution}</span>` : '';
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
    const senderBadge = u.is_sender
      ? `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ml-1">${t('admin.badge.mail')}</span>`
      : '';
    const privateBadge = u.is_public === 0
      ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-50 text-yellow-700">${t('admin.badge.private')}</span>`
      : '';

    const verifyBtn = u.is_member
      ? `<button data-id="${u.id}" data-action="unverify" class="action-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">${t('admin.action.unverify')}</button>`
      : `<button data-id="${u.id}" data-action="verify" class="action-btn text-xs px-3 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors">${t('admin.action.verify')}</button>`;

    const rankSelect = showRankAndBadges ? `
      <select data-id="${u.id}" class="rank-select text-xs px-2 py-1.5 rounded-lg border border-border text-navy bg-white focus:outline-none focus:border-navy-mid">
        ${RANKS.map(r => `<option value="${r.value}" ${u.current_rank === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>` : '';

    const badgeChips = showRankAndBadges ? (() => {
      const earnedCodes = new Set((u.badge_codes || '').split(',').filter(Boolean));
      return badgeCatalog.map(b => `
        <button
          data-id="${u.id}"
          data-code="${b.code}"
          data-earned="${earnedCodes.has(b.code)}"
          class="badge-chip text-xs px-2 py-1 rounded-full border transition-colors ${
            earnedCodes.has(b.code)
              ? 'bg-navy text-white border-navy'
              : 'bg-white text-gray-400 border-border hover:border-navy-mid'
          }"
          title="${b.name_en}"
        >${b.name_tr}</button>`).join(' ');
    })() : '';

    const moreActions = `
      <div class="relative inline-block">
        <button data-menu="${u.id}" class="more-btn text-xs px-2 py-1.5 rounded-lg border border-border text-gray-400 hover:text-navy hover:border-navy-mid transition-colors">⋯</button>
        <div id="menu-${u.id}" class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-border py-1 z-10 ${moreMenuWidthClass}">
          ${u.is_admin
            ? `<button data-id="${u.id}" data-action="remove_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.removeAdmin')}</button>`
            : `<button data-id="${u.id}" data-action="make_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.makeAdmin')}</button>`
          }
          ${u.is_announcer
            ? `<button data-id="${u.id}" data-action="remove_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.removeAnnouncer')}</button>`
            : `<button data-id="${u.id}" data-action="make_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.makeAnnouncer')}</button>`
          }
          ${u.is_writer
            ? `<button data-id="${u.id}" data-action="remove_writer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.removeWriter')}</button>`
            : `<button data-id="${u.id}" data-action="make_writer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.makeWriter')}</button>`
          }
          ${u.is_sender
            ? `<button data-id="${u.id}" data-action="remove_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.removeSender')}</button>`
            : `<button data-id="${u.id}" data-action="make_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.makeSender')}</button>`
          }
          <button data-id="${u.id}" data-action="make_private" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">${t('admin.action.makePrivate')}</button>
          <button data-id="${u.id}" data-action="clear_bio" class="action-btn block w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50">${t('admin.action.clearBio')}</button>
        </div>
      </div>`;

    return `
      <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
        <td class="px-5 py-4">
          <div class="font-medium text-navy">${name}</div>
          <div class="text-xs text-gray-400 mt-0.5">${username}</div>
          ${institution}
        </td>
        <td class="px-5 py-4 text-gray-500">${u.email}</td>
        <td class="px-5 py-4">${memberBadge}${adminBadge}${announcerBadge}${writerBadge}${senderBadge}${privateBadge}</td>
        ${showRankAndBadges ? `<td class="px-5 py-4">${rankSelect}</td>` : ''}
        ${showRankAndBadges ? `<td class="px-5 py-4"><div class="flex flex-wrap gap-1 max-w-[220px]">${badgeChips}</div></td>` : ''}
        <td class="px-5 py-4 text-gray-400">${formatDate(u.created_at)}</td>
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

  if (showRankAndBadges) {
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

async function loadUsers() {
  const search = (document.getElementById('searchInput') as HTMLInputElement).value.trim();
  const params = new URLSearchParams({ filter: currentFilter });
  if (search) params.set('search', search);

  const res = await fetch(`/api/admin/users?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { users: any[]; badge_catalog?: typeof badgeCatalog };
  if (showRankAndBadges) badgeCatalog = data.badge_catalog ?? [];
  renderUsers(data.users);

  // Update stats
  const total = data.users.length;
  const members = data.users.filter(u => u.is_member).length;
  document.getElementById('statsRow')!.innerHTML = `
    <div class="text-center px-4 py-2 rounded-xl bg-white border border-border">
      <div class="text-lg font-bold text-navy">${total}</div>
      <div class="text-xs text-gray-400">${t('admin.stats.shown')}</div>
    </div>
    <div class="text-center px-4 py-2 rounded-xl bg-white border border-border">
      <div class="text-lg font-bold text-green-600">${members}</div>
      <div class="text-xs text-gray-400">${t('admin.stats.members')}</div>
    </div>
    <div class="text-center px-4 py-2 rounded-xl bg-white border border-border">
      <div class="text-lg font-bold text-gray-400">${total - members}</div>
      <div class="text-xs text-gray-400">${t('admin.stats.pending')}</div>
    </div>`;
}

async function loadSenders() {
  const res = await fetch('/api/admin/senders');
  if (!res.ok) return;
  const data = await res.json() as { senders: any[] };
  const list = document.getElementById('sendersList')!;
  const empty = document.getElementById('sendersEmpty')!;
  if (!data.senders.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = data.senders.map((s: any) => `
    <div class="flex items-center justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
      <div>
        <div class="text-navy">${escapeHtml(s.display_name ?? s.email)}</div>
        <div class="text-xs text-gray-400">
          ${escapeHtml(s.email)}${s.team ? ` · ${escapeHtml(s.team)}` : ''}
          ${s.granted_at ? tf('admin.mail.senders.grantedAtFragment', { date: formatDate(s.granted_at) }) : ''}
          ${s.granted_by_email ? tf('admin.mail.senders.grantedByFragment', { email: escapeHtml(s.granted_by_email) }) : ''}
        </div>
      </div>
      <button data-id="${escapeHtml(s.user_id)}" class="revoke-sender-btn text-xs px-3 py-1.5 rounded-lg border border-border text-red-500 hover:bg-red-50">${t('admin.mail.senders.revoke')}</button>
    </div>`).join('');

  list.querySelectorAll<HTMLButtonElement>('.revoke-sender-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await fetch('/api/admin/senders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: btn.dataset.id, action: 'revoke' }),
      });
      if (res.ok) {
        showToast(t('admin.toast.senderRevoked'));
        await Promise.all([loadSenders(), loadUsers()]);
      } else {
        btn.disabled = false;
        showToast(t('admin.toast.senderRevokeFailed'), true);
      }
    });
  });
}

function setupBulkGrant() {
  const form = document.getElementById('bulkGrantForm') as HTMLFormElement;
  const result = document.getElementById('bulkResult')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails: (document.getElementById('bulkEmails') as HTMLTextAreaElement).value,
        team: (document.getElementById('bulkTeam') as HTMLInputElement).value,
      }),
    });
    const data = await res.json().catch(() => null) as { granted: string[]; unknown: string[] } | null;
    if (!res.ok || !data) {
      showToast(t('admin.toast.bulkGrantFailed'), true);
      return;
    }
    // Unmatched addresses are shown, never swallowed: a typo'd address is
    // a person who silently will not be able to send.
    result.classList.remove('hidden');
    result.className = data.unknown.length ? 'text-xs text-red-600' : 'text-xs text-green-700';
    result.textContent = data.unknown.length
      ? tf('admin.mail.bulkGrant.resultUnknown', { count: data.granted.length, list: data.unknown.join(', ') })
      : tf('admin.mail.bulkGrant.resultOk', { count: data.granted.length });
    form.reset();
    await Promise.all([loadSenders(), loadUsers()]);
  });
}

async function loadAdminAttachments() {
  const res = await fetch('/api/admin/mail-attachments');
  if (!res.ok) return;
  const data = await res.json() as { attachments: any[] };
  const list = document.getElementById('attachmentAdminList')!;
  const empty = document.getElementById('attachmentsEmpty')!;
  empty.classList.toggle('hidden', data.attachments.length > 0);
  list.innerHTML = data.attachments.map((a: any) => `
    <div class="flex items-center justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
      <div>
        <div class="text-navy ${a.is_active ? '' : 'line-through text-gray-400'}">${escapeHtml(a.filename)}</div>
        <div class="text-xs text-gray-400">${Math.round(a.size_bytes / 1024)} KB · ${formatDate(a.uploaded_at)}</div>
      </div>
      <button data-id="${escapeHtml(a.id)}" data-active="${a.is_active}"
        class="toggle-attachment-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-600 hover:bg-gray-50">
        ${a.is_active ? t('admin.mail.attachments.deactivate') : t('admin.mail.attachments.reactivate')}
      </button>
    </div>`).join('');

  list.querySelectorAll<HTMLButtonElement>('.toggle-attachment-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await fetch('/api/admin/mail-attachments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.id, is_active: btn.dataset.active !== '1' }),
      });
      if (res.ok) {
        await loadAdminAttachments();
      } else {
        const data = await res.json().catch(() => null) as { code?: string } | null;
        showToast(ATTACHMENT_ERRORS[data?.code ?? ''] ?? t('admin.mail.attachments.updateFailed'), true);
        btn.disabled = false;
      }
    });
  });
}

/**
 * Uploading is a two-step action on purpose: pick, then confirm.
 *
 * It used to fire on the input's change event, so choosing a file started an
 * upload with no button to press and no lasting sign of the result -- a
 * rejection appeared in a toast that cleared itself after six seconds. An
 * admin who looked away saw a file selected and nothing else, and a
 * too-large PDF was indistinguishable from a broken page. Errors now stay on
 * screen until the next attempt and name the size or type that was refused,
 * because that is the part the person actually has to act on.
 */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
};

function formatBytes(n: number): string {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

function setupAttachmentUpload() {
  const input = document.getElementById('attachmentFile') as HTMLInputElement;
  const chosen = document.getElementById('attachmentChosen')!;
  const error = document.getElementById('attachmentError')!;
  const button = document.getElementById('attachmentUploadBtn') as HTMLButtonElement;

  function showError(message: string) {
    error.textContent = message;
    error.classList.remove('hidden');
  }

  function clearError() {
    error.textContent = '';
    error.classList.add('hidden');
  }

  input.addEventListener('change', () => {
    clearError();
    const file = input.files?.[0];

    if (!file) {
      chosen.classList.add('hidden');
      button.disabled = true;
      return;
    }

    const kind = ALLOWED_UPLOAD_TYPES[file.type];
    chosen.textContent = file.name + ' — ' + formatBytes(file.size) + (kind ? ' · ' + kind : '');
    chosen.classList.remove('hidden');

    // Both checks are repeated on the server, which is what actually
    // enforces them. Doing them here as well means the person is told why
    // before a large file travels the wire only to be refused.
    if (!kind) {
      showError(tf('admin.mail.attachments.unsupportedTypeError', { type: file.type || t('admin.mail.attachments.unrecognisedType') }));
      button.disabled = true;
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError(tf('admin.mail.attachments.tooLargeError', { size: formatBytes(file.size) }));
      button.disabled = true;
      return;
    }

    button.disabled = false;
  });

  button.addEventListener('click', async () => {
    const file = input.files?.[0];
    if (!file) return;

    clearError();
    button.disabled = true;
    button.textContent = t('admin.mail.attachments.uploadingLabel');

    try {
      const res = await fetch('/api/admin/mail-attachments', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; code?: string } | null;

      if (res.ok && data?.ok) {
        // Clear the picker only once the file is definitely stored.
        input.value = '';
        chosen.classList.add('hidden');
        showToast(t('admin.toast.attachmentUploaded'));
        await loadAdminAttachments();
      } else {
        showError(ATTACHMENT_ERRORS[data?.code ?? ''] ?? t('admin.mail.attachments.uploadFailed'));
        button.disabled = false;
      }
    } catch {
      showError(t('admin.mail.attachments.uploadFailed'));
      button.disabled = false;
    } finally {
      button.textContent = t('admin.mail.attachments.uploadBtn');
    }
  });
}

async function loadAllSends() {
  const res = await fetch('/api/mail/history?scope=all');
  if (!res.ok) return;
  const data = await res.json() as { sends: any[] };
  const list = document.getElementById('allSendsList')!;
  const empty = document.getElementById('allSendsEmpty')!;
  if (!data.sends.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = data.sends.map((s: any) => `
    <div class="flex items-start justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
      <div class="min-w-0">
        <div class="text-navy truncate">${escapeHtml(s.subject)}</div>
        <div class="text-xs text-gray-400">
          ${escapeHtml(s.sender_name ?? s.sender_email)} → ${escapeHtml(s.recipient_email)} · ${formatDate(s.sent_at)}
        </div>
        ${s.status === 'failed' ? `<div class="text-xs text-red-600 mt-0.5">${escapeHtml(s.error_message)}</div>` : ''}
      </div>
      <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${
        s.status === 'sent' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }">${s.status === 'sent' ? t('admin.mail.allSends.sent') : t('admin.mail.allSends.failed')}</span>
    </div>`).join('');
}

// Init

/**
 * Which panes this admin may open, and which one opens first.
 *
 * This replaces three `classList.toggle('hidden', !isFullAdmin)` calls on
 * whole sections. The sections are panes now, so a role decides which nav
 * entries exist rather than which blocks are stacked on the page -- but the
 * rule itself is unchanged: an announcer gets announcements and nothing else.
 *
 * The nav is hidden entirely when only one pane is available, since a
 * switcher with one option is furniture.
 */
function applyRoleVisibility(isFullAdmin: boolean): void {
  const allowed = isFullAdmin
    ? ['members', 'announcements', 'blog', 'mail-grant', 'mail-senders', 'mail-files', 'mail-sent']
    : ['announcements'];

  document.querySelectorAll<HTMLElement>('[data-pane]').forEach((pane) => {
    if (!allowed.includes(pane.dataset.pane!)) pane.remove();
  });

  document.querySelectorAll<HTMLElement>('.admin-nav-item').forEach((item) => {
    if (!allowed.includes(item.dataset.target!)) item.remove();
  });

  // A group heading with nothing left under it is noise.
  document.querySelectorAll<HTMLElement>('[data-nav-group]').forEach((group) => {
    if (!group.querySelector('.admin-nav-item')) group.remove();
  });

  const nav = document.getElementById('adminNav');
  if (nav && allowed.length < 2) nav.classList.add('hidden');

  setupPaneSwitching(allowed[0]);
}

/** Shows one pane at a time and marks its nav entry as current. */
function setupPaneSwitching(initial: string): void {
  const items = document.querySelectorAll<HTMLButtonElement>('.admin-nav-item');
  const panes = document.querySelectorAll<HTMLElement>('[data-pane]');

  function show(target: string): void {
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== target));
    items.forEach((i) => {
      const current = i.dataset.target === target;
      i.classList.toggle('bg-navy-light', current);
      i.classList.toggle('text-navy', current);
      i.classList.toggle('font-medium', current);
      i.setAttribute('aria-current', current ? 'page' : 'false');
    });
  }

  items.forEach((i) => i.addEventListener('click', () => show(i.dataset.target!)));
  show(initial);
}

(async () => {
  const res = await fetch('/api/me');
  const data = await res.json() as { user: any };

  document.getElementById('loadingState')!.classList.add('hidden');

  if (!data.user || (!data.user.is_admin && !data.user.is_announcer)) {
    document.getElementById('notAuth')!.classList.remove('hidden');
    return;
  }

  document.getElementById('adminContent')!.classList.remove('hidden');
  const isFullAdmin = data.user.is_admin === true;
  canManageAnnouncements = data.user.is_admin === true || data.user.is_announcer === true;
  applyRoleVisibility(isFullAdmin);
  await loadAnnouncements();
  setupAnnouncementForm();
  if (isFullAdmin) await loadUsers();
  if (isFullAdmin) await loadBlogSubmissions();
  if (isFullAdmin) {
    setupBulkGrant();
    setupAttachmentUpload();
    await Promise.all([loadSenders(), loadAdminAttachments(), loadAllSends()]);
  }

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = (btn as HTMLButtonElement).dataset.filter!;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active-filter'));
      btn.classList.add('active-filter');
      loadUsers();
    });
  });

  // Search
  document.getElementById('searchInput')!.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, 350);
  });
})();

function escapeHtmlForBlogReview(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string));
}

type BlogSubmission = {
  id: string;
  lang: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  image_url: string;
  body: string;
  slug: string;
  status: string;
  rejection_reason: string | null;
  pr_url: string | null;
  paired_submission_id: string | null;
  submitter_email: string;
};

function blogSubmissionCardHtml(primary: BlogSubmission, paired: BlogSubmission | null): string {
  const langLabel = (s: BlogSubmission) => s.lang === 'en' ? t('admin.blog.langEnglish') : t('admin.blog.langTurkish');
  const bodyPreview = (s: BlogSubmission) => `
    <div class="mt-2 p-3 rounded-lg bg-[#F7F7F6] text-xs">
      <div class="font-medium text-navy">${langLabel(s)}: ${escapeHtmlForBlogReview(s.title)}</div>
      <div class="text-gray-500 mt-1">${escapeHtmlForBlogReview(s.description)}</div>
      ${s.image_url ? `<img src="${escapeHtmlForBlogReview(s.image_url)}" class="mt-2 max-h-32 rounded" alt="" />` : ''}
      ${s.tags.length > 0 ? `<div class="mt-2 flex flex-wrap gap-1">${s.tags.map(t => `<span class="px-2 py-0.5 rounded-full bg-white border border-border text-gray-500">${escapeHtmlForBlogReview(t)}</span>`).join('')}</div>` : ''}
      <pre class="whitespace-pre-wrap mt-2 text-gray-600">${escapeHtmlForBlogReview(s.body)}</pre>
    </div>`;

  return `
    <div class="bg-white rounded-2xl border border-border shadow-sm p-5" data-id="${primary.id}">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-navy">${escapeHtmlForBlogReview(primary.title)}</div>
        <span class="text-xs text-gray-400">${escapeHtmlForBlogReview(primary.submitter_email)}</span>
      </div>
      <div class="text-xs text-gray-400 mt-1">${t('admin.blog.categoryLabel')} ${escapeHtmlForBlogReview(primary.category)} · ${t('admin.blog.slugLabel')} <input class="blog-slug-input text-xs border border-border rounded px-1" value="${escapeHtmlForBlogReview(primary.slug)}" /></div>
      ${bodyPreview(primary)}
      ${paired ? bodyPreview(paired) : ''}
      <div class="mt-3 flex items-center gap-2">
        <button class="blog-approve-btn text-xs px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-mid transition-colors">${t('admin.blog.approve')}</button>
        <button class="blog-reject-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">${t('admin.blog.reject')}</button>
      </div>
    </div>`;
}

async function loadBlogSubmissions() {
  const res = await fetch('/api/admin/blog-submissions');
  if (!res.ok) return;
  const data = await res.json() as { submissions: BlogSubmission[] };
  const pending = data.submissions.filter(s => s.status === 'pending');

  const list = document.getElementById('blogSubmissionsList')!;
  const empty = document.getElementById('blogSubmissionsEmpty')!;

  const shown = new Set<string>();
  const cards = pending.filter(s => {
    if (shown.has(s.id)) return false;
    if (s.paired_submission_id) shown.add(s.paired_submission_id);
    shown.add(s.id);
    return true;
  });

  if (cards.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = cards.map(s => {
    const paired = s.paired_submission_id
      ? pending.find(p => p.id === s.paired_submission_id) ?? null
      : null;
    return blogSubmissionCardHtml(s, paired);
  }).join('');

  list.querySelectorAll('.blog-approve-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const card = (e.currentTarget as HTMLButtonElement).closest('[data-id]') as HTMLElement;
      const id = card.dataset.id!;
      const slugInput = card.querySelector('.blog-slug-input') as HTMLInputElement;
      (e.currentTarget as HTMLButtonElement).setAttribute('disabled', 'true');
      const res = await fetch(`/api/admin/blog-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', slug: slugInput.value }),
      });
      if (res.ok) {
        await loadBlogSubmissions();
      } else {
        const err = await res.json() as { error: string };
        alert(err.error || t('admin.blog.approveFailedAlert'));
        (e.currentTarget as HTMLButtonElement).removeAttribute('disabled');
      }
    });
  });

  list.querySelectorAll('.blog-reject-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const card = (e.currentTarget as HTMLButtonElement).closest('[data-id]') as HTMLElement;
      const id = card.dataset.id!;
      const reason = prompt(t('admin.blog.rejectReasonPrompt'));
      if (!reason) return;
      const res = await fetch(`/api/admin/blog-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason }),
      });
      if (res.ok) {
        await loadBlogSubmissions();
      } else {
        const err = await res.json() as { error: string };
        alert(err.error || t('admin.blog.rejectFailedAlert'));
      }
    });
  });
}
