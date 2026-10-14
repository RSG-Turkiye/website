import { t } from '../context';

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
    <div class="bg-white rounded-2xl border border-border p-5" data-id="${primary.id}">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-navy">${escapeHtmlForBlogReview(primary.title)}</div>
        <span class="text-xs text-gray-500">${escapeHtmlForBlogReview(primary.submitter_email)}</span>
      </div>
      <div class="text-xs text-gray-500 mt-1">${t('admin.blog.categoryLabel')} ${escapeHtmlForBlogReview(primary.category)} · ${t('admin.blog.slugLabel')} <input class="blog-slug-input text-xs border border-border rounded px-1" value="${escapeHtmlForBlogReview(primary.slug)}" /></div>
      ${bodyPreview(primary)}
      ${paired ? bodyPreview(paired) : ''}
      <div class="mt-3 flex items-center gap-2">
        <button class="blog-approve-btn text-xs px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-mid transition-colors">${t('admin.blog.approve')}</button>
        <button class="blog-reject-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">${t('admin.blog.reject')}</button>
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
