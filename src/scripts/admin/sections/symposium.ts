import { uploadImage } from '../../image-upload';
import { drivePhotoUrl } from '../../../../functions/_lib/photo-url';
import { escapeHtml } from '../../escape-html';
import { setupCertificates, loadCertificates } from '../../admin-certificates';
import { lang, t, tf, showToast, formatDate } from '../context';

// The edition being edited (the highest year not yet archived, per
// edition.ts) and the current speaker list, cached so the sessions form's
// speaker picker can be rebuilt without a round trip every time.
let symposiumYear: number | null = null;
let symposiumSpeakers: Array<{ id: string; slug: string; name: string }> = [];

// Symposium pane
//
// One D1-editable "overlay" that the symposium site merges over its own git
// content at build time. Four sections, all sharing the shape rule that
// backs every route in functions/api/admin/symposium/*.ts: GET returns
// exactly what PUT/POST accept, so a form that loads a row, changes
// nothing, and saves is a no-op. Nothing here reshapes a date or a flag on
// its way to the wire -- that shaping already happened once, server-side,
// in functions/_lib/symposium.ts.

/** Beside a save button: what happened to the write, and to the rebuild it triggered. */
/**
 * Three states, not two. `queued` used to be reported as a failure -- and the
 * failure text promised a nightly rebuild that does not exist, so an editor
 * whose edit had in fact published was told it had not and that something
 * would fix it overnight. Nothing runs overnight.
 */
/**
 * Runs a form's save with its submit button visibly busy.
 *
 * Saving a symposium row is not fast: the route writes to D1 and then asks
 * Cloudflare to rebuild the symposium site, and that second call alone
 * measures about 1.5 seconds. For that second and a half the panel used to
 * show nothing at all -- the button looked exactly as it had -- so an editor
 * pressed it again. The second press wrote a second row, and a committee
 * member was added twice.
 *
 * Disabling alone is not enough to see: these buttons set their own
 * background, so a browser's default greying does not show through. The
 * label changes too, which is the part that actually reads as "working".
 */
export async function whileSaving(button: HTMLButtonElement | null, save: () => Promise<void>): Promise<void> {
  if (!button) return save();
  const label = button.textContent;
  button.disabled = true;
  button.classList.add('opacity-60', 'cursor-not-allowed');
  button.textContent = t('admin.symposium.saving');
  try {
    await save();
  } finally {
    button.disabled = false;
    button.classList.remove('opacity-60', 'cursor-not-allowed');
    button.textContent = label;
  }
}

export function showRebuildStatus(
  elId: string,
  rebuild: { state?: 'started' | 'queued' | 'failed'; triggered?: boolean; detail: string },
): void {
  const el = document.getElementById(elId)!;
  // `triggered` is what an older deploy of the API still sends; the panel and
  // the Functions are not deployed at the same instant.
  const state = rebuild.state ?? (rebuild.triggered ? 'started' : 'failed');
  el.textContent =
    state === 'started' ? t('admin.symposium.rebuild.started')
    : state === 'queued' ? t('admin.symposium.rebuild.queued')
    : tf('admin.symposium.rebuild.failed', { detail: rebuild.detail });
  el.classList.remove('hidden');
}

// --- Edition settings -------------------------------------------------

interface EditionData {
  year: number;
  registrationUrl: string;
  registrationDeadline: string | null;
  abstractUrl: string;
  abstractDeadline: string | null;
  venuePublic: boolean | null;
  cityPublic: boolean | null;
  archivePrUrl: string | null;
}

/** A tri-state <select>'s value ('' / 'true' / 'false') back to boolean | null. */
function tristateSelectValue(id: string): boolean | null {
  const value = (document.getElementById(id) as unknown as HTMLSelectElement).value;
  return value === '' ? null : value === 'true';
}

async function loadEdition(): Promise<void> {
  const res = await fetch('/api/admin/symposium/edition');
  if (!res.ok) { showToast(t('admin.symposium.loadFailed'), true); return; }
  const data = await res.json() as EditionData;
  symposiumYear = data.year;

  document.getElementById('symYearLabel')!.textContent = tf('admin.symposium.yearFragment', { year: data.year });
  (document.getElementById('symEditionRegUrl') as HTMLInputElement).value = data.registrationUrl;
  (document.getElementById('symEditionRegDeadline') as HTMLInputElement).value = data.registrationDeadline ?? '';
  (document.getElementById('symEditionAbsUrl') as HTMLInputElement).value = data.abstractUrl;
  (document.getElementById('symEditionAbsDeadline') as HTMLInputElement).value = data.abstractDeadline ?? '';
  // No opinion (null) maps to the empty option, never to "hide" -- see
  // tristateSelectValue's inverse and EditionInput's doc comment.
  (document.getElementById('symEditionVenuePublic') as unknown as HTMLSelectElement).value =
    data.venuePublic === null ? '' : String(data.venuePublic);
  (document.getElementById('symEditionCityPublic') as unknown as HTMLSelectElement).value =
    data.cityPublic === null ? '' : String(data.cityPublic);

  const archiveNote = document.getElementById('symEditionArchivePr')!;
  const archiveLink = document.getElementById('symEditionArchivePrLink') as HTMLAnchorElement;
  if (data.archivePrUrl) {
    archiveLink.href = data.archivePrUrl;
    archiveNote.classList.remove('hidden');
  } else {
    archiveNote.classList.add('hidden');
  }
}

function setupEditionForm(): void {
  const form = document.getElementById('symEditionForm') as HTMLFormElement;
  const submitBtn = form.querySelector('button[type=submit]') as HTMLButtonElement | null;
  const snapshotBtn = document.getElementById('symEditionSnapshotBtn') as HTMLButtonElement | null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void whileSaving(submitBtn, saveEdition);
  });
  snapshotBtn?.addEventListener('click', () => {
    void whileSaving(snapshotBtn, sendSnapshot);
  });

  async function sendSnapshot(): Promise<void> {
    const statusEl = document.getElementById('symEditionSnapshotStatus')!;
    const res = await fetch('/api/admin/symposium/snapshot', { method: 'POST' });
    if (!res.ok) {
      statusEl.textContent = t('admin.symposium.edition.snapshotFailed');
      statusEl.classList.remove('hidden');
      return;
    }
    const data = await res.json() as { ok: boolean; prUrl?: string; reason?: string };
    statusEl.classList.remove('hidden');
    if (data.ok && data.prUrl) {
      statusEl.innerHTML =
        `${escapeHtml(t('admin.symposium.edition.snapshotDone'))} ` +
        `<a href="${escapeHtml(data.prUrl)}" target="_blank" rel="noopener noreferrer" class="underline text-navy">${escapeHtml(data.prUrl)}</a>`;
    } else if (data.reason === 'no-overlay-content') {
      statusEl.textContent = t('admin.symposium.edition.snapshotEmpty');
    } else if (data.reason === 'snapshot-no-changes') {
      statusEl.textContent = t('admin.symposium.edition.snapshotNoChanges');
    } else {
      statusEl.textContent = t('admin.symposium.edition.snapshotFailed');
    }
  }

  async function saveEdition(): Promise<void> {
    if (symposiumYear === null) return;

    const body = {
      year: symposiumYear,
      registrationUrl: (document.getElementById('symEditionRegUrl') as HTMLInputElement).value,
      registrationDeadline: (document.getElementById('symEditionRegDeadline') as HTMLInputElement).value || null,
      abstractUrl: (document.getElementById('symEditionAbsUrl') as HTMLInputElement).value,
      abstractDeadline: (document.getElementById('symEditionAbsDeadline') as HTMLInputElement).value || null,
      venuePublic: tristateSelectValue('symEditionVenuePublic'),
      cityPublic: tristateSelectValue('symEditionCityPublic'),
    };

    const res = await fetch('/api/admin/symposium/edition', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { ok: true; rebuild: { triggered: boolean; detail: string } };
      showRebuildStatus('symEditionStatus', data.rebuild);
    } else {
      const err = await res.json() as { error: string };
      showToast(err.error || t('admin.toast.error'), true);
    }
  }
}

// --- Speakers -----------------------------------------------------------

interface SpeakerItem {
  id: string; sort: number; slug: string; name: string; position: string;
  company: string; bio: string; photo: string; linkedin: string;
}

/** Keeps the sessions form's speaker picker in sync with the speaker list, preserving its current selection. */
function populateSessionSpeakerOptions(): void {
  const select = document.getElementById('symSessionSpeakers') as unknown as HTMLSelectElement;
  const selected = new Set(Array.from(select.selectedOptions).map((o) => o.value));
  select.innerHTML = symposiumSpeakers.map((s) =>
    `<option value="${escapeHtml(s.slug)}">${escapeHtml(s.name)} (${escapeHtml(s.slug)})</option>`
  ).join('');
  Array.from(select.options).forEach((o) => { o.selected = selected.has(o.value); });
}

function renderSpeakers(items: SpeakerItem[]): void {
  const tbody = document.getElementById('symSpeakersTableBody')!;
  const empty = document.getElementById('symSpeakersEmptyState')!;

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = items.map((s) => `
    <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
      <td class="px-5 py-4 text-navy font-medium">${escapeHtml(s.name)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(s.position)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(s.slug)}</td>
      <td class="px-5 py-4 text-right">
        <button data-id="${s.id}" class="edit-speaker-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-navy-mid hover:text-navy transition-colors mr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.speakers.edit')}</button>
        <button data-id="${s.id}" class="delete-speaker-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.speakers.delete')}</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-speaker-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
      const item = items.find((s) => s.id === id);
      if (!item) return;
      (document.getElementById('symSpeakerEditId') as HTMLInputElement).value = item.id;
      (document.getElementById('symSpeakerName') as HTMLInputElement).value = item.name;
      (document.getElementById('symSpeakerSlug') as HTMLInputElement).value = item.slug;
      (document.getElementById('symSpeakerPosition') as HTMLInputElement).value = item.position;
      (document.getElementById('symSpeakerCompany') as HTMLInputElement).value = item.company;
      (document.getElementById('symSpeakerBio') as HTMLTextAreaElement).value = item.bio;
      (document.getElementById('symSpeakerPhoto') as HTMLInputElement).value = item.photo;
      (document.getElementById('symSpeakerLinkedin') as HTMLInputElement).value = item.linkedin;
      speakerPhoto?.show(item.photo);
      document.getElementById('symSpeakerCancelBtn')!.classList.remove('hidden');
    });
  });

  tbody.querySelectorAll('.delete-speaker-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      const res = await fetch(`/api/admin/symposium/speakers/${b.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { showToast(t('admin.toast.deleted')); await loadSpeakers(); }
      else { showToast(t('admin.toast.error'), true); b.disabled = false; }
    });
  });
}

async function loadSpeakers(): Promise<void> {
  const res = await fetch('/api/admin/symposium/speakers');
  if (!res.ok) { showToast(t('admin.symposium.loadFailed'), true); return; }
  const data = await res.json() as { year: number; items: SpeakerItem[] };
  symposiumSpeakers = data.items;
  renderSpeakers(data.items);
  populateSessionSpeakerOptions();
}

/** One-time wiring, mirroring setupAnnouncementForm's own reasoning about why this runs once. */
function setupSpeakerForm(): void {
  const form = document.getElementById('symSpeakerForm') as HTMLFormElement;
  const cancelBtn = document.getElementById('symSpeakerCancelBtn')!;

  function resetForm() {
    form.reset();
    (document.getElementById('symSpeakerEditId') as HTMLInputElement).value = '';
    speakerPhoto?.reset();
    cancelBtn.classList.add('hidden');
  }
  cancelBtn.addEventListener('click', resetForm);

  speakerPhoto = setupPhotoUpload(
    'symSpeaker',
    t('admin.symposium.speakers.form.photoUploading'),
    t('admin.symposium.speakers.form.photoUploaded'),
  );

  const submitBtn = form.querySelector('button[type=submit]') as HTMLButtonElement | null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void whileSaving(submitBtn, saveSpeaker);
  });

  async function saveSpeaker(): Promise<void> {
    // Before reading any field -- see PhotoField.
    await speakerPhoto?.settle();

    const editId = (document.getElementById('symSpeakerEditId') as HTMLInputElement).value;
    const body = {
      slug: (document.getElementById('symSpeakerSlug') as HTMLInputElement).value,
      name: (document.getElementById('symSpeakerName') as HTMLInputElement).value,
      position: (document.getElementById('symSpeakerPosition') as HTMLInputElement).value,
      company: (document.getElementById('symSpeakerCompany') as HTMLInputElement).value,
      bio: (document.getElementById('symSpeakerBio') as HTMLTextAreaElement).value,
      photo: (document.getElementById('symSpeakerPhoto') as HTMLInputElement).value,
      linkedin: (document.getElementById('symSpeakerLinkedin') as HTMLInputElement).value,
    };

    const url = editId ? `/api/admin/symposium/speakers/${editId}` : '/api/admin/symposium/speakers';
    const res = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { rebuild: { triggered: boolean; detail: string } };
      resetForm();
      await loadSpeakers();
      showRebuildStatus('symSpeakerStatus', data.rebuild);
    } else {
      // A duplicate slug arrives here as a 409 naming the conflicting slug --
      // shown as-is, since it names exactly what the editor needs to rename.
      const err = await res.json() as { error: string };
      showToast(err.error || t('admin.toast.error'), true);
    }
  }
}

// --- Sessions -------------------------------------------------------------

interface SessionItem {
  id: string; sort: number; slug: string; title: string; type: string;
  time: string; endTime: string; description: string; speakerSlugs: string[];
  day: number; titleTr: string; descriptionTr: string;
}

function sessionTypeLabel(type: string): string {
  return t(`admin.symposium.sessions.type.${type}` as Parameters<typeof t>[0]) || type;
}

function renderSessions(items: SessionItem[]): void {
  const tbody = document.getElementById('symSessionsTableBody')!;
  const empty = document.getElementById('symSessionsEmptyState')!;

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = items.map((s) => `
    <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
      <td class="px-5 py-4 text-navy font-medium">${escapeHtml(s.title)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(sessionTypeLabel(s.type))}</td>
      <td class="px-5 py-4 text-gray-500 tabular-nums">${s.day ?? 1}</td>
      <td class="px-5 py-4 text-gray-500 tabular-nums">${escapeHtml(s.time)}${s.endTime ? '–' + escapeHtml(s.endTime) : ''}</td>
      <td class="px-5 py-4 text-right">
        <button data-id="${s.id}" class="edit-session-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-navy-mid hover:text-navy transition-colors mr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.sessions.edit')}</button>
        <button data-id="${s.id}" class="delete-session-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.sessions.delete')}</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-session-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
      const item = items.find((s) => s.id === id);
      if (!item) return;
      (document.getElementById('symSessionEditId') as HTMLInputElement).value = item.id;
      (document.getElementById('symSessionTitle') as HTMLInputElement).value = item.title;
      (document.getElementById('symSessionTitleTr') as HTMLInputElement).value = item.titleTr ?? '';
      (document.getElementById('symSessionSlug') as HTMLInputElement).value = item.slug;
      (document.getElementById('symSessionType') as unknown as HTMLSelectElement).value = item.type;
      (document.getElementById('symSessionTime') as HTMLInputElement).value = item.time;
      (document.getElementById('symSessionEndTime') as HTMLInputElement).value = item.endTime;
      (document.getElementById('symSessionDescription') as HTMLTextAreaElement).value = item.description;
      (document.getElementById('symSessionDescriptionTr') as HTMLTextAreaElement).value = item.descriptionTr ?? '';
      (document.getElementById('symSessionDay') as HTMLInputElement).value = String(item.day ?? 1);
      const select = document.getElementById('symSessionSpeakers') as unknown as HTMLSelectElement;
      Array.from(select.options).forEach((o) => { o.selected = item.speakerSlugs.includes(o.value); });
      document.getElementById('symSessionCancelBtn')!.classList.remove('hidden');
    });
  });

  tbody.querySelectorAll('.delete-session-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      const res = await fetch(`/api/admin/symposium/sessions/${b.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { showToast(t('admin.toast.deleted')); await loadSessions(); }
      else { showToast(t('admin.toast.error'), true); b.disabled = false; }
    });
  });
}

async function loadSessions(): Promise<void> {
  const res = await fetch('/api/admin/symposium/sessions');
  if (!res.ok) { showToast(t('admin.symposium.loadFailed'), true); return; }
  const data = await res.json() as { year: number; items: SessionItem[] };
  renderSessions(data.items);
}

function setupSessionForm(): void {
  const form = document.getElementById('symSessionForm') as HTMLFormElement;
  const cancelBtn = document.getElementById('symSessionCancelBtn')!;
  const speakersSelect = document.getElementById('symSessionSpeakers') as unknown as HTMLSelectElement;

  function resetForm() {
    form.reset();
    (document.getElementById('symSessionEditId') as HTMLInputElement).value = '';
    Array.from(speakersSelect.options).forEach((o) => { o.selected = false; });
    cancelBtn.classList.add('hidden');
  }
  cancelBtn.addEventListener('click', resetForm);

  const submitBtn = form.querySelector('button[type=submit]') as HTMLButtonElement | null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void whileSaving(submitBtn, saveSession);
  });

  async function saveSession(): Promise<void> {
    const editId = (document.getElementById('symSessionEditId') as HTMLInputElement).value;
    const body = {
      slug: (document.getElementById('symSessionSlug') as HTMLInputElement).value,
      title: (document.getElementById('symSessionTitle') as HTMLInputElement).value,
      type: (document.getElementById('symSessionType') as unknown as HTMLSelectElement).value,
      time: (document.getElementById('symSessionTime') as HTMLInputElement).value,
      endTime: (document.getElementById('symSessionEndTime') as HTMLInputElement).value,
      description: (document.getElementById('symSessionDescription') as HTMLTextAreaElement).value,
      titleTr: (document.getElementById('symSessionTitleTr') as HTMLInputElement).value,
      descriptionTr: (document.getElementById('symSessionDescriptionTr') as HTMLTextAreaElement).value,
      day: Number((document.getElementById('symSessionDay') as HTMLInputElement).value),
      speakerSlugs: Array.from(speakersSelect.selectedOptions).map((o) => o.value),
    };

    const url = editId ? `/api/admin/symposium/sessions/${editId}` : '/api/admin/symposium/sessions';
    const res = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { rebuild: { triggered: boolean; detail: string } };
      resetForm();
      await loadSessions();
      showRebuildStatus('symSessionStatus', data.rebuild);
    } else {
      const err = await res.json() as { error: string };
      showToast(err.error || t('admin.toast.error'), true);
    }
  }
}

// --- Committee --------------------------------------------------------

interface CommitteeItem {
  id: string; sort: number; name: string; role: string; roleTr: string;
  affiliation: string; photo: string; linkedin: string;
  /** Two lists, matched one to one and in order. */
  teams: string[]; teamsTr: string[];
}

/** Folds two spellings of one team to one key. Must agree with `teamKey` in
 * functions/_lib/symposium.ts and in the symposium site's committee.ts --
 * every form of the letter I to one, then lowercase -- or the panel offers a
 * suggestion the server then treats as a different team. */
function teamKey(value: string): string {
  return value.replace(/[\u0130I\u0131]/g, 'i').toLowerCase();
}

/** The team names currently in use, for a field's datalist: one suggestion
 * per team, spelled the way the first member on it spelled it. Blanks are
 * dropped -- a team with no Turkish name must not offer an empty option. */
function teamSuggestions(items: CommitteeItem[], lang: 'en' | 'tr'): string[] {
  const byKey = new Map<string, string>();
  for (const item of items) {
    const list = (lang === 'tr' ? item.teamsTr : item.teams) ?? [];
    for (const team of list) {
      if (!team) continue;
      const key = teamKey(team);
      if (!byKey.has(key)) byKey.set(key, team);
    }
  }
  return [...byKey.values()];
}

/** What a member's teams read as in the panel's own language, for the table.
 * Falls back across languages the way the public page's headings do. */
function teamLabels(item: CommitteeItem): string[] {
  const en = item.teams ?? [];
  const tr = item.teamsTr ?? [];
  return en
    .map((name, i) => (lang === 'tr' ? tr[i] || name : name || tr[i] || ''))
    .filter(Boolean);
}

function renderCommittee(items: CommitteeItem[]): void {
  const tbody = document.getElementById('symCommitteeTableBody')!;
  const empty = document.getElementById('symCommitteeEmptyState')!;

  // Before the early return: with no members there are no suggestions, and
  // a datalist left holding the previous edition's teams would be worse than
  // an empty one.
  for (const [id, suggestionLang] of [
    ['symCommitteeTeamOptions', 'en'],
    ['symCommitteeTeamTrOptions', 'tr'],
  ] as const) {
    const datalist = document.getElementById(id);
    if (!datalist) continue;
    datalist.innerHTML = teamSuggestions(items, suggestionLang)
      .map((team) => `<option value="${escapeHtml(team)}"></option>`)
      .join('');
  }

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = items.map((c) => `
    <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
      <td class="px-5 py-4 text-navy font-medium">${escapeHtml(c.name)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(lang === 'tr' ? (c.roleTr || c.role) : c.role)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(c.affiliation)}</td>
      <td class="px-5 py-4 text-gray-500">${escapeHtml(teamLabels(c).join(', '))}</td>
      <td class="px-5 py-4 text-right">
        <button data-id="${c.id}" class="edit-committee-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-navy-mid hover:text-navy transition-colors mr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.committee.edit')}</button>
        <button data-id="${c.id}" class="delete-committee-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.symposium.committee.delete')}</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-committee-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
      const item = items.find((c) => c.id === id);
      if (!item) return;
      (document.getElementById('symCommitteeEditId') as HTMLInputElement).value = item.id;
      (document.getElementById('symCommitteeName') as HTMLInputElement).value = item.name;
      (document.getElementById('symCommitteeRole') as HTMLInputElement).value = item.role;
      (document.getElementById('symCommitteeRoleTr') as HTMLInputElement).value = item.roleTr;
      (document.getElementById('symCommitteeAffiliation') as HTMLInputElement).value = item.affiliation;
      (document.getElementById('symCommitteePhoto') as HTMLInputElement).value = item.photo;
      (document.getElementById('symCommitteeLinkedin') as HTMLInputElement).value = item.linkedin;
      (document.getElementById('symCommitteeTeams') as HTMLInputElement).value = (item.teams ?? []).join(', ');
      // Joined even when every entry is empty, so the two fields stay the
      // same length and a member loaded and saved unchanged is a no-op.
      const trTeams = item.teamsTr ?? [];
      (document.getElementById('symCommitteeTeamsTr') as HTMLInputElement).value =
        trTeams.some(Boolean) ? trTeams.join(', ') : '';
      committeePhoto?.show(item.photo);
      document.getElementById('symCommitteeCancelBtn')!.classList.remove('hidden');
    });
  });

  tbody.querySelectorAll('.delete-committee-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      const res = await fetch(`/api/admin/symposium/committee/${b.dataset.id}`, { method: 'DELETE' });
      if (res.ok) { showToast(t('admin.toast.deleted')); await loadCommittee(); }
      else { showToast(t('admin.toast.error'), true); b.disabled = false; }
    });
  });
}

async function loadCommittee(): Promise<void> {
  const res = await fetch('/api/admin/symposium/committee');
  if (!res.ok) { showToast(t('admin.symposium.loadFailed'), true); return; }
  const data = await res.json() as { year: number; items: CommitteeItem[] };
  renderCommittee(data.items);
}

/**
 * A photo field: a file input that uploads, the URL field the form actually
 * submits, and a thumbnail. The committee form had this first; the speaker
 * form has the same one, which is why the element ids are a prefix.
 *
 * The upload happens on choosing the file rather than on save: it is the
 * slow step, and doing it here means the URL is visible and correctable
 * before anything is committed. uploadImage downscales in the browser first
 * and rethrows the server's own message, which says what is wrong and what
 * to do about it.
 *
 * `pending` is the upload currently in flight, if any. The save used to read
 * the URL field the instant it was pressed, and a committee member saved
 * during those seconds was stored with no photograph at all -- it happened to
 * a real member, who had to be entered again. So every save awaits this
 * first. Not a boolean flag but the promise itself, because "wait for it to
 * finish" is what the save actually needs.
 */
interface PhotoField {
  /** Resolves once any upload in flight has written its URL (or failed). */
  settle(): Promise<void>;
  /** Shows the thumbnail for a URL already on the record being edited. */
  show(url: string): void;
  /** Clears the thumbnail, the status line and any settled upload. */
  reset(): void;
}

function setupPhotoUpload(prefix: 'symCommittee' | 'symSpeaker', uploadingText: string, uploadedText: string): PhotoField {
  const input = document.getElementById(`${prefix}PhotoFile`) as HTMLInputElement | null;
  const url = document.getElementById(`${prefix}Photo`) as HTMLInputElement | null;
  const status = document.getElementById(`${prefix}PhotoStatus`) as HTMLElement | null;
  const preview = document.getElementById(`${prefix}PhotoPreview`) as HTMLImageElement | null;
  let pending: Promise<void> | null = null;

  // A Drive share link is a page, not a picture; the server stores the direct
  // form, and the thumbnail shows what the site will show.
  function show(value: string): void {
    if (!preview) return;
    preview.src = value ? drivePhotoUrl(value) : '';
    preview.classList.toggle('hidden', !value);
  }

  if (input && url && status) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;

      status.textContent = uploadingText;
      input.disabled = true;

      // It never rejects: a failed upload is reported here and leaves the
      // URL field alone, and a save that follows should still save
      // everything else rather than be dragged down with it.
      pending = (async () => {
        try {
          const uploaded = await uploadImage(file);
          url.value = uploaded;
          show(uploaded);
          status.textContent = uploadedText;
        } catch (err) {
          status.textContent = '';
          showToast(err instanceof Error ? err.message : t('admin.toast.error'), true);
        } finally {
          input.disabled = false;
          // Cleared so choosing the same file again still fires a change
          // event -- which is what a retry after a failed upload looks like.
          input.value = '';
        }
      })();
    });

    // A URL typed or pasted by hand deserves the same thumbnail as an
    // uploaded one; without this the preview would only ever reflect the upload.
    url.addEventListener('input', () => show(url.value));
  }

  return {
    async settle() {
      if (!pending) return;
      if (status) status.textContent = uploadingText;
      await pending;
      pending = null;
    },
    show,
    reset() {
      // form.reset() restores the *initial* value of each field, which for
      // the photo URL is empty -- but the preview and the status line are not
      // form fields and would otherwise still show the last record edited.
      show('');
      if (status) status.textContent = '';
      pending = null;
    },
  };
}

let committeePhoto: PhotoField | null = null;
let speakerPhoto: PhotoField | null = null;

/** An empty field means "no Turkish names at all", which the server accepts;
 * anything else keeps its blanks so the two lists stay aligned by position. */
function splitTurkishTeams(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(',').map((team) => team.trim());
}

function setupCommitteeForm(): void {
  const form = document.getElementById('symCommitteeForm') as HTMLFormElement;
  const cancelBtn = document.getElementById('symCommitteeCancelBtn')!;

  function resetForm() {
    form.reset();
    (document.getElementById('symCommitteeEditId') as HTMLInputElement).value = '';
    committeePhoto?.reset();
    cancelBtn.classList.add('hidden');
  }
  cancelBtn.addEventListener('click', resetForm);

  committeePhoto = setupPhotoUpload(
    'symCommittee',
    t('admin.symposium.committee.form.photoUploading'),
    t('admin.symposium.committee.form.photoUploaded'),
  );

  const submitBtn = form.querySelector('button[type=submit]') as HTMLButtonElement | null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void whileSaving(submitBtn, saveCommittee);
  });

  async function saveCommittee(): Promise<void> {
    // Before reading any field: a photograph chosen a second ago may still
    // be uploading, and its URL lands in the form only when it finishes.
    // Saving first is how a member ended up in the database with no photo.
    await committeePhoto?.settle();

    const editId = (document.getElementById('symCommitteeEditId') as HTMLInputElement).value;
    const body = {
      name: (document.getElementById('symCommitteeName') as HTMLInputElement).value,
      role: (document.getElementById('symCommitteeRole') as HTMLInputElement).value,
      roleTr: (document.getElementById('symCommitteeRoleTr') as HTMLInputElement).value,
      affiliation: (document.getElementById('symCommitteeAffiliation') as HTMLInputElement).value,
      photo: (document.getElementById('symCommitteePhoto') as HTMLInputElement).value,
      linkedin: (document.getElementById('symCommitteeLinkedin') as HTMLInputElement).value,
      // Split here, trimmed and deduplicated on the server -- which is where
      // it has to happen anyway, since these fields are not the only way in.
      // Empty entries are kept in the Turkish list rather than filtered, so
      // "A, , C" still lines up with three English names; the server drops a
      // pair only when both names are empty.
      teams: (document.getElementById('symCommitteeTeams') as HTMLInputElement).value
        .split(',').map((team) => team.trim()).filter(Boolean),
      teamsTr: splitTurkishTeams((document.getElementById('symCommitteeTeamsTr') as HTMLInputElement).value),
    };

    const url = editId ? `/api/admin/symposium/committee/${editId}` : '/api/admin/symposium/committee';
    const res = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { rebuild: { triggered: boolean; detail: string } };
      resetForm();
      await loadCommittee();
      showRebuildStatus('symCommitteeStatus', data.rebuild);
    } else {
      const err = await res.json() as { error: string };
      showToast(err.error || t('admin.toast.error'), true);
    }
  }
}

export function setupSymposium(): void {
  setupEditionForm();
  setupSpeakerForm();
  setupSessionForm();
  setupCommitteeForm();
  setupCertificates({
    t: t as (k: string) => string,
    tf: tf as (k: string, v: Record<string, string | number>) => string,
    showToast, showRebuildStatus, formatDate,
  });
}

export async function loadSymposium(): Promise<void> {
  await loadEdition();
  await loadSpeakers();
  await loadSessions();
  await loadCommittee();
  await loadCertificates();
}
