/**
 * The E-posta pane's "New email" sub-page: the compose form and the queue of
 * scheduled mail, moved here from /account/mail. Same requests, payloads and
 * error codes as that page; its sent-mail list is not repeated, because the
 * Sent sub-page shows it.
 */
import { escapeHtml } from '../../escape-html';
import { epochToIstanbulInput, istanbulInputToEpoch, formatIstanbul } from '../../../lib/istanbul-time';
import { t, tf, dateLocale } from '../context';
import { BTN, row, emptyState, armConfirm, guardUnsaved, toast } from '../ui-kit';
import { markSentStale } from './mail-sent';

let isAdmin = false;
let editingId: string | null = null;
let myEmail: string | null = null;
let guard: { reset(): void } | null = null;
let token = 0;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

function errorText(code: unknown): string {
  // An unknown key reads as undefined, so an unmapped code falls back.
  return t(`admin.mail.error.${String(code)}` as never) || t('admin.mail.compose.sendFailed');
}

function setEditing(id: string | null) {
  editingId = id;
  el('mailComposeEditing').classList.toggle('hidden', id === null);
  el('mailComposeSend').textContent = t(id ? 'admin.mail.compose.update' : 'admin.mail.compose.send');
  // PATCH /api/mail/scheduled requires scheduled_at, so "leave empty to send
  // now" would be untrue while editing a queued message.
  el('mailComposeScheduleLabel').textContent = t(id ? 'admin.mail.compose.scheduleLabelEditing' : 'admin.mail.compose.scheduleLabel');
}

function resetForm() {
  el<HTMLFormElement>('mailComposeForm').reset();
  setEditing(null);
}

async function loadAttachments() {
  const res = await fetch('/api/admin/mail-attachments');
  if (!res.ok) return;
  const data = await res.json() as { attachments: any[] };
  const active = (data.attachments ?? []).filter((a) => a.is_active === 1);
  if (!active.length) return;
  el('mailComposeAttachmentsWrap').classList.remove('hidden');
  el('mailComposeAttachments').innerHTML = active.map((a) => `
    <label class="flex items-center gap-2 min-h-11 text-sm text-gray-600 min-w-0">
      <input type="checkbox" class="mail-compose-attachment rounded border-border shrink-0" value="${escapeHtml(a.id)}" />
      <span class="min-w-0 break-all">${escapeHtml(a.filename)}</span>
      <span class="text-xs text-gray-500 shrink-0">${Math.round(a.size_bytes / 1024)} KB</span>
    </label>`).join('');
}

function checkedAttachmentIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.mail-compose-attachment:checked')).map((b) => b.value);
}

async function submit(btn: HTMLButtonElement) {
  const status = el('mailComposeStatus');
  btn.disabled = true;
  status.textContent = t('admin.mail.compose.sending');

  const scheduledAt = istanbulInputToEpoch(el<HTMLInputElement>('mailComposeSchedule').value);
  const payload = {
    to: el<HTMLInputElement>('mailComposeTo').value,
    subject: el<HTMLInputElement>('mailComposeSubject').value,
    body: el<HTMLTextAreaElement>('mailComposeBody').value,
    attachment_ids: checkedAttachmentIds(),
    ...(scheduledAt !== undefined ? { scheduled_at: scheduledAt } : {}),
  };

  let res: Response | null = null;
  let data: any = null;
  try {
    res = editingId
      ? await fetch('/api/mail/scheduled', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: editingId }),
        })
      : await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
    data = await res.json().catch(() => null);
  } catch { /* network failure: reported below */ }
  btn.disabled = false;
  status.textContent = '';

  if (!res || !data) {
    toast(t('admin.mail.compose.genericError'), true);
    return;
  }
  if (!res.ok && data.code) {
    toast(errorText(data.code), true);
    if (data.code === 'not_found') {
      setEditing(null);
      await loadQueued();
    }
    return;
  }

  // A refusal with no code is still a refusal: say so and keep the draft.
  // The one coded-less refusal that is expected, every recipient failing
  // (502), carries `results` and is reported below as a partial send.
  if (!res.ok && !Array.isArray(data.results)) {
    toast(t('admin.mail.compose.genericError'), true);
    return;
  }

  const done = async (message: string) => {
    guard?.reset();
    resetForm();
    toast(message);
    await loadQueued();
  };
  // Whatever went out is now in the history: Sent reloads when next shown.
  markSentStale();
  if (res.ok && editingId) return done(t('admin.mail.compose.updated'));
  // `queued` is the server's answer when a send is too large to go out
  // inline: it is due now and the next queue run sends it.
  if (res.ok && (data.scheduled || data.queued)) return done(t('admin.mail.compose.queued'));

  const results: any[] = data.results ?? [];
  const failed = results.filter((r) => r.status === 'failed');
  const sent = results.length - failed.length;
  if (res.ok && failed.length === 0) return done(tf('admin.mail.compose.sentTo', { count: sent }));
  if (failed.length === 0) {
    toast(t('admin.mail.compose.genericError'), true);
    return;
  }
  toast(tf('admin.mail.compose.sentPartial', { count: sent, list: failed.map((r) => r.recipient).join(', ') }), true);
}

/** Wires the form once. `isAdmin` adds the queue's Everyone's switch. */
export function setupCompose(opts: { isAdmin: boolean; email?: string | null }): void {
  isAdmin = opts.isAdmin;
  myEmail = opts.email ?? null;
  const form = el<HTMLFormElement>('mailComposeForm');
  const btn = el<HTMLButtonElement>('mailComposeSend');
  guard = guardUnsaved(form, '#eposta/yaz', resetForm);

  el('mailComposeCancelEdit').addEventListener('click', () => { guard?.reset(); resetForm(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit(btn);
  });

  if (isAdmin) {
    el('mailQueuedScopeLabel').classList.remove('hidden');
    el('mailQueuedScopeAll').addEventListener('change', () => { void loadQueued(); });
  }
}

function attachmentsNote(count: number): string {
  if (count <= 0) return '';
  return ' · ' + (count === 1 ? t('admin.mail.queued.attachmentOne') : tf('admin.mail.queued.attachmentMany', { count }));
}

let attachmentsLoaded = false;

/** The queue (own mail, or everyone's for an admin who asks), plus the attachment choices once. */
export async function loadQueued(): Promise<void> {
  if (!attachmentsLoaded) {
    attachmentsLoaded = true;
    void loadAttachments().catch(() => { attachmentsLoaded = false; });
  }
  const mine = ++token;
  // Only an admin gets the wider list, and only while the box is ticked; the
  // endpoint enforces that too.
  const wantsAll = isAdmin && el<HTMLInputElement>('mailQueuedScopeAll').checked;
  const res = await fetch(wantsAll ? '/api/mail/scheduled?scope=all' : '/api/mail/scheduled');
  if (!res.ok || mine !== token) return;
  const data = await res.json() as { scheduled: any[] };
  if (mine !== token) return;
  const card = el('mailQueuedCard');
  const list = el('mailQueuedList');
  // The card stays up while the box is on, so an admin who ticks it and
  // finds nothing sees that, rather than the card vanishing under them.
  if (!data.scheduled.length) {
    card.classList.toggle('hidden', !wantsAll);
    list.innerHTML = emptyState(t('admin.mail.queued.empty'));
    return;
  }
  card.classList.remove('hidden');
  list.innerHTML = data.scheduled.map((s) => {
    const recipients: string[] = JSON.parse(s.recipients ?? '[]');
    const count = (JSON.parse(s.attachment_ids ?? '[]') as string[]).length;
    // Edit and Cancel are ownership-scoped on the server, so on someone
    // else's row they would only fail. The row is shown, and shown to be theirs.
    const own = !s.sender_email || s.sender_email === myEmail;
    const subtitle = `${recipients.join(', ')} · ${formatIstanbul(s.scheduled_at, dateLocale)}${attachmentsNote(count)}${s.sender_email ? ` · ${s.sender_email}` : ''}`;
    const trailing = own
      ? `<button type="button" data-edit="${escapeHtml(s.id)}" class="${BTN.secondary}">${escapeHtml(t('admin.mail.queued.edit'))}</button>
         <button type="button" data-cancel="${escapeHtml(s.id)}" class="${BTN.danger}">${escapeHtml(t('admin.mail.queued.cancel'))}</button>`
      : `<span class="text-xs text-gray-500 px-1">${escapeHtml(t('admin.mail.queued.theirs'))}</span>`;
    return row({ title: s.subject, subtitle, trailing, attrs: `data-queued="${escapeHtml(s.id)}"` });
  }).join('');

  list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const s = data.scheduled.find((x) => x.id === b.dataset.edit);
      if (!s) return;
      el<HTMLInputElement>('mailComposeTo').value = JSON.parse(s.recipients).join(', ');
      el<HTMLInputElement>('mailComposeSubject').value = s.subject;
      el<HTMLTextAreaElement>('mailComposeBody').value = s.body;
      el<HTMLInputElement>('mailComposeSchedule').value = epochToIstanbulInput(s.scheduled_at);
      const ids: string[] = JSON.parse(s.attachment_ids ?? '[]');
      document.querySelectorAll<HTMLInputElement>('.mail-compose-attachment').forEach((box) => { box.checked = ids.includes(box.value); });
      setEditing(s.id);
      el('mailComposeForm').scrollIntoView({ behavior: 'smooth' });
    });
  });

  list.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) => {
    armConfirm(b, t('admin.mail.queued.cancelConfirm'), async () => {
      const id = b.dataset.cancel!;
      const r = await fetch('/api/mail/scheduled', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.ok) {
        toast(t('admin.mail.queued.cancelled'));
        if (editingId === id) { guard?.reset(); resetForm(); }
        await loadQueued();
      } else {
        toast(t('admin.mail.queued.cancelFailed'), true);
      }
    });
  });
}
