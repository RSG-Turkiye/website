import { escapeHtml } from '../../escape-html';
import { t, tf, showToast, formatDate } from '../context';
import { loadUsers } from './users';

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

export async function loadSenders() {
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
        <div class="text-xs text-gray-500">
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

export function setupBulkGrant() {
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

export async function loadAdminAttachments() {
  const res = await fetch('/api/admin/mail-attachments');
  if (!res.ok) return;
  const data = await res.json() as { attachments: any[] };
  const list = document.getElementById('attachmentAdminList')!;
  const empty = document.getElementById('attachmentsEmpty')!;
  empty.classList.toggle('hidden', data.attachments.length > 0);
  list.innerHTML = data.attachments.map((a: any) => `
    <div class="flex items-center justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
      <div>
        <div class="text-navy ${a.is_active ? '' : 'line-through text-gray-500'}">${escapeHtml(a.filename)}</div>
        <div class="text-xs text-gray-500">${Math.round(a.size_bytes / 1024)} KB · ${formatDate(a.uploaded_at)}</div>
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

export function setupAttachmentUpload() {
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
    chosen.textContent = file.name + ' · ' + formatBytes(file.size) + (kind ? ' · ' + kind : '');
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

export async function loadAllSends() {
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
        <div class="text-xs text-gray-500">
          ${escapeHtml(s.sender_name ?? s.sender_email)} → ${escapeHtml(s.recipient_email)} · ${formatDate(s.sent_at)}
        </div>
        ${s.status === 'failed' ? `<div class="text-xs text-red-600 mt-0.5">${escapeHtml(s.error_message)}</div>` : ''}
      </div>
      <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${
        s.status === 'sent' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }">${s.status === 'sent' ? t('admin.mail.allSends.sent') : t('admin.mail.allSends.failed')}</span>
    </div>`).join('');
}
