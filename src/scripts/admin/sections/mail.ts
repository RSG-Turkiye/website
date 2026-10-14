import { escapeHtml } from '../../escape-html';
import { t, tf, showToast, formatDate } from '../context';
import { loadUsers } from './users';
import { row, chip, BTN, armConfirm } from '../ui-kit';

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
  list.innerHTML = data.senders.map((s: any) => row({
    title: s.display_name ?? s.email,
    subtitle: [
      s.email,
      s.granted_at ? tf('admin.mail.senders.grantedAtFragment', { date: formatDate(s.granted_at) }).replace(/^ · /, '') : '',
      s.granted_by_email ? tf('admin.mail.senders.grantedByFragment', { email: s.granted_by_email }).trim() : '',
    ].filter(Boolean).join(' · '),
    chips: s.team ? chip(s.team, 'navy') : '',
    trailing: `<button type="button" data-id="${escapeHtml(s.user_id)}" class="revoke-sender-btn ${BTN.danger}">${escapeHtml(t('admin.mail.senders.revoke'))}</button>`,
  })).join('');

  list.querySelectorAll<HTMLButtonElement>('.revoke-sender-btn').forEach(btn => {
    armConfirm(btn, t('admin.users.detail.confirm'), async () => {
      const res = await fetch('/api/admin/senders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: btn.dataset.id, action: 'revoke' }),
      });
      if (res.ok) {
        showToast(t('admin.toast.senderRevoked'));
        await Promise.all([loadSenders(), loadUsers()]);
      } else {
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
  list.innerHTML = data.attachments.map((a: any) => row({
    title: a.filename,
    subtitle: `${Math.round(a.size_bytes / 1024)} KB · ${formatDate(a.uploaded_at)}`,
    chips: a.is_active ? '' : chip(t('admin.mail.attachments.reactivate'), 'neutral'),
    attrs: a.is_active ? '' : 'data-inactive="1"',
    trailing: `<button type="button" data-id="${escapeHtml(a.id)}" data-active="${a.is_active ? '1' : '0'}" class="toggle-attachment-btn ${a.is_active ? BTN.danger : BTN.secondary}">${escapeHtml(a.is_active ? t('admin.mail.attachments.deactivate') : t('admin.mail.attachments.reactivate'))}</button>`,
  })).join('');

  async function toggle(btn: HTMLButtonElement) {
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
    }
  }

  list.querySelectorAll<HTMLButtonElement>('.toggle-attachment-btn').forEach(btn => {
    // Deactivating takes two clicks; bringing a file back is harmless and takes one.
    if (btn.dataset.active === '1') armConfirm(btn, t('admin.users.detail.confirm'), () => toggle(btn));
    else btn.addEventListener('click', async () => { btn.disabled = true; await toggle(btn); btn.disabled = false; });
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
  list.innerHTML = data.sends.map((s: any) => row({
    title: s.subject,
    subtitle: `${s.sender_name ?? s.sender_email} → ${s.recipient_email} · ${formatDate(s.sent_at)}`,
    chips: s.status === 'failed' && s.error_message ? `<span class="text-xs text-red-600 min-w-0 break-all">${escapeHtml(s.error_message)}</span>` : '',
    trailing: chip(s.status === 'sent' ? t('admin.mail.allSends.sent') : t('admin.mail.allSends.failed'), s.status === 'sent' ? 'green' : 'red'),
  })).join('');
}
