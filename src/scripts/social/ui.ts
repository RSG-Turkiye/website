/** Small rendering helpers shared by the social views. */
import { escapeHtml } from '../escape-html';
import { chip } from '../admin/ui-kit';
import type { PostStatus } from './api';
import { deps } from './context';

export const esc = escapeHtml;

/** "Written by an agent", for a post an agent token wrote; nothing otherwise. */
export const agentChip = (p: { byAgent?: boolean }) => (p.byAgent ? chip(deps().t('admin.agent.written'), 'navy') : '');

const VARIANTS = {
  primary: 'bg-navy text-white hover:bg-navy-mid',
  danger: 'border border-red text-red hover:bg-red-tint',
  plain: 'border border-border text-navy hover:bg-navy-light',
  ok: 'border border-green-700 text-green-700 hover:bg-green-50',
} as const;

export function button(label: string, attrs: string, variant: keyof typeof VARIANTS = 'plain'): string {
  return `<button type="button" ${attrs} class="px-3 py-1.5 min-h-11 lg:min-h-0 rounded-lg text-sm font-medium ${VARIANTS[variant]} disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${esc(label)}</button>`;
}

/** Colour per status; plans use 'plan' and 'due'. Looked up, never interpolated from the server. */
const STATUS_CLASS: Record<string, string> = {
  plan: 'border border-dashed border-gray-400 text-gray-600 bg-[#f6f7fa]',
  due: 'border border-dashed border-red text-red bg-red-tint',
  draft: 'bg-gray-100 text-gray-700',
  rejected: 'bg-amber-50 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-900',
  scheduled: 'bg-blue-100 text-blue-900',
  published: 'bg-green-100 text-green-900',
  partially_published: 'bg-green-50 text-green-800',
  failed: 'bg-red-tint text-red',
  cancelled: 'bg-gray-100 text-gray-500 line-through',
};
export const statusClass = (s: PostStatus | 'plan' | 'due') => (Object.hasOwn(STATUS_CLASS, s) ? STATUS_CLASS[s] : STATUS_CLASS.draft);

export const overlay = () => document.getElementById('socialOverlay')!;
export function closeOverlay(): void {
  const o = overlay();
  o.classList.add('hidden');
  o.replaceChildren();
}

/** Two clicks instead of a browser dialog: the panel never uses confirm(). */
export function armConfirm(b: HTMLButtonElement, run: () => Promise<void>): void {
  b.addEventListener('click', () => {
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.dataset.label = b.textContent ?? '';
      b.textContent = deps().t('admin.social.action.confirm');
      return;
    }
    b.disabled = true;
    void run().finally(() => { b.disabled = false; b.dataset.armed = ''; b.textContent = b.dataset.label ?? ''; });
  });
}
