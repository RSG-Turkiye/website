import { escapeHtml } from '../../escape-html';
import { t, showToast, formatDate } from '../context';

let canManageAnnouncements = false;

export function setCanManageAnnouncements(v: boolean): void {
  canManageAnnouncements = v;
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
      <td class="px-5 py-4 text-gray-500 tabular-nums">${formatDate(a.expires_at)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(a.site ?? 'main')}</td>
      <td class="px-5 py-4 text-gray-500">${a.show_as_popup ? t('admin.announcements.popupYes') : t('admin.announcements.popupNo')}</td>
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
      (document.getElementById('annSite') as unknown as HTMLSelectElement).value = item.site ?? 'main';
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

export async function loadAnnouncements() {
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
export function setupAnnouncementForm() {
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
      site: (document.getElementById('annSite') as unknown as HTMLSelectElement).value,
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
