/**
 * The admin panel's shared pieces. Lists are rows, never tables, so nothing
 * scrolls sideways on a phone; every control is at least 44 px tall there.
 */
import { escapeHtml } from '../escape-html';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const BASE = `inline-flex items-center justify-center gap-1 px-4 min-h-11 lg:min-h-9 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

export const BTN = {
  primary: `${BASE} bg-navy text-white hover:bg-navy-mid`,
  secondary: `${BASE} border border-navy text-navy hover:bg-navy-light`,
  danger: `${BASE} border border-red text-red hover:bg-red-tint`,
  ghost: `${BASE} text-gray-500 hover:text-navy`,
};

const TONES = {
  neutral: 'bg-gray-100 text-gray-600',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  navy: 'bg-navy-light text-navy',
  red: 'bg-red-tint text-red',
} as const;

export function chip(text: string, tone: keyof typeof TONES = 'neutral'): string {
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone]}">${escapeHtml(text)}</span>`;
}

export function row(o: { title: string; subtitle?: string; chips?: string; trailing?: string; attrs?: string; selected?: boolean }): string {
  return `<div ${o.attrs ?? ''} class="flex items-center gap-3 min-h-14 px-4 py-3 bg-white border ${o.selected ? 'border-navy-mid bg-navy-light/40' : 'border-border'} rounded-xl">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-navy truncate">${escapeHtml(o.title)}</p>
      ${o.subtitle ? `<p class="text-xs text-gray-500 truncate">${escapeHtml(o.subtitle)}</p>` : ''}
      ${o.chips ? `<div class="flex flex-wrap gap-1 mt-1">${o.chips}</div>` : ''}
    </div>
    ${o.trailing ? `<div class="shrink-0 flex items-center gap-2">${o.trailing}</div>` : ''}
  </div>`;
}

export function switchControl(o: { id: string; checked: boolean; label: string; hint?: string; attrs?: string }): string {
  return `<div class="flex items-center justify-between gap-3 min-h-11 py-2 border-b border-border last:border-0">
    <label for="${escapeHtml(o.id)}" class="flex-1 min-w-0 cursor-pointer">
      <span class="block text-sm text-navy">${escapeHtml(o.label)}</span>
      ${o.hint ? `<span class="block text-xs text-gray-500">${escapeHtml(o.hint)}</span>` : ''}
    </label>
    <input id="${escapeHtml(o.id)}" type="checkbox" role="switch" ${o.checked ? 'checked' : ''} ${o.attrs ?? ''}
      class="appearance-none w-11 h-6 rounded-full bg-gray-300 checked:bg-navy relative cursor-pointer transition-colors
        after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition-all
        checked:after:left-[1.375rem] ${FOCUS}" />
  </div>`;
}

export function emptyState(text: string): string {
  return `<p class="text-center py-10 text-sm text-gray-500">${escapeHtml(text)}</p>`;
}

export function sectionCard(inner: string): string {
  return `<div class="bg-white rounded-2xl border border-border p-4 lg:p-6">${inner}</div>`;
}

/** Two clicks instead of window.confirm: the first changes the label, the second acts. Disarms after 4 s. */
export function armConfirm(button: HTMLButtonElement, confirmLabel: string, onConfirm: () => void | Promise<void>): void {
  const original = button.textContent ?? '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener('click', async () => {
    if (button.dataset.armed !== '1') {
      button.dataset.armed = '1';
      button.textContent = confirmLabel;
      timer = setTimeout(() => { button.dataset.armed = ''; button.textContent = original; }, 4000);
      return;
    }
    if (timer) clearTimeout(timer);
    button.dataset.armed = '';
    button.disabled = true;
    try { await onConfirm(); } finally { button.disabled = false; button.textContent = original; }
  });
}

/** Toasts stack at the bottom, full width on a phone. */
export function toast(message: string, isError = false): void {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.className = `px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${isError ? 'bg-red' : 'bg-navy'}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
