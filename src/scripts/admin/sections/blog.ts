import { t, showToast } from '../context';
import { BTN, chip, armConfirm } from '../ui-kit';

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
      <div class="text-gray-500 mt-1 break-words">${escapeHtmlForBlogReview(s.description)}</div>
      ${s.image_url ? `<img src="${escapeHtmlForBlogReview(s.image_url)}" class="mt-2 max-h-32 rounded" alt="" />` : ''}
      ${s.tags.length > 0 ? `<div class="mt-2 flex flex-wrap gap-1">${s.tags.map(t => `<span class="px-2 py-0.5 rounded-full bg-white border border-border text-gray-500">${escapeHtmlForBlogReview(t)}</span>`).join('')}</div>` : ''}
      <pre class="whitespace-pre-wrap break-all mt-2 text-gray-600">${escapeHtmlForBlogReview(s.body)}</pre>
    </div>`;

  const INPUT = 'px-3 py-2 min-h-11 lg:min-h-9 rounded-xl border border-border text-sm text-navy focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid focus:border-navy-mid';
  return `
    <div class="bg-white rounded-2xl border border-border p-4 lg:p-5" data-id="${escapeHtmlForBlogReview(primary.id)}">
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div class="text-sm font-semibold text-navy min-w-0 break-words">${escapeHtmlForBlogReview(primary.title)}</div>
        <span class="text-xs text-gray-500 min-w-0 break-all">${escapeHtmlForBlogReview(primary.submitter_email)}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-500">
        ${chip(`${t('admin.blog.categoryLabel')} ${primary.category}`, 'navy')}
        <label class="flex items-center gap-2">${t('admin.blog.slugLabel')} <input class="blog-slug-input ${INPUT} min-w-0" value="${escapeHtmlForBlogReview(primary.slug)}" /></label>
      </div>
      ${bodyPreview(primary)}
      ${paired ? bodyPreview(paired) : ''}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" class="blog-approve-btn ${BTN.primary}">${t('admin.blog.approve')}</button>
        <input type="text" class="blog-reject-reason ${INPUT} flex-1 min-w-40" placeholder="${escapeHtmlForBlogReview(t('admin.blog.rejectReasonPrompt'))}" aria-label="${escapeHtmlForBlogReview(t('admin.blog.rejectReasonPrompt'))}" />
        <button type="button" class="blog-reject-btn ${BTN.danger}">${t('admin.blog.reject')}</button>
      </div>
    </div>`;
}

export async function loadBlogSubmissions() {
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

  list.querySelectorAll<HTMLButtonElement>('.blog-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]') as HTMLElement;
      const id = card.dataset.id!;
      const slugInput = card.querySelector('.blog-slug-input') as HTMLInputElement;
      btn.disabled = true;
      const res = await fetch(`/api/admin/blog-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', slug: slugInput.value }),
      });
      if (res.ok) {
        await loadBlogSubmissions();
      } else {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        showToast(err?.error || t('admin.blog.approveFailedAlert'), true);
        btn.disabled = false;
      }
    });
  });

  // Rejecting needs a reason, typed in the card, then two clicks. The reason
  // is checked on the first click so nobody confirms what the server refuses.
  list.querySelectorAll<HTMLButtonElement>('.blog-reject-btn').forEach(btn => {
    const reasonOf = () => (btn.closest('[data-id]')!.querySelector('.blog-reject-reason') as HTMLInputElement);
    btn.addEventListener('click', (e) => {
      if (reasonOf().value.trim()) return;
      e.stopImmediatePropagation();
      reasonOf().focus();
      showToast(t('admin.blog.rejectReasonPrompt'), true);
    }, true);
    armConfirm(btn, t('admin.users.detail.confirm'), async () => {
      const card = btn.closest('[data-id]') as HTMLElement;
      const id = card.dataset.id!;
      const reason = reasonOf().value.trim();
      if (!reason) return;
      const res = await fetch(`/api/admin/blog-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason }),
      });
      if (res.ok) {
        await loadBlogSubmissions();
      } else {
        const err = await res.json().catch(() => null) as { error?: string } | null;
        showToast(err?.error || t('admin.blog.rejectFailedAlert'), true);
      }
    });
  });
}
