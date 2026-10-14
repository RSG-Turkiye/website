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
import { loadHealth } from '../admin-health';
import { setupConnections, loadConnections } from '../admin-connections';
import { setupAudit, loadAudit } from '../admin-audit';
import { setupSocial, loadSocial, showSocialTab, type Tab } from '../social';
import { lang, t, tf, showToast } from './context';
import { landing, rolesFromMe, type SectionId } from './sections';
import { startShell, refreshCounts } from './shell';
import { loadOverview } from './overview';
import { loadUsers, setupUsersFilters } from './sections/users';
import { loadAnnouncements, setupAnnouncementForm, setCanManageAnnouncements } from './sections/announcements';
import { loadBlogSubmissions } from './sections/blog';
import { loadSenders, setupBulkGrant, loadAdminAttachments, setupAttachmentUpload, loadAllSends } from './sections/mail';
import { setupSymposium, loadSymposium } from './sections/symposium';

// Init

const healthDeps = { t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, lang };

/** The shell's sub-page ids for the social pane's tabs. */
const SOCIAL_TABS: Record<string, Tab> = { takvim: 'calendar', onay: 'pending', taslaklar: 'drafts', yayinlananlar: 'published', etkinlik: 'events' };

/**
 * Data that loads the first time a section is shown, not on every page
 * load: each load is a read the audit log records, so loading unseen
 * sections would fill the log with reads nobody asked for. A failed load
 * says so, as the pane loaders did.
 */
function onFirstShow(load: () => Promise<void>, failed?: string): () => Promise<void> {
  return () => load().catch(() => { if (failed) showToast(t(failed as never), true); });
}

(async () => {
  const res = await fetch('/api/me');
  const data = await res.json() as { user: any };

  document.getElementById('loadingState')!.classList.add('hidden');

  if (!data.user || landing(rolesFromMe(data.user)) === null) {
    document.getElementById('notAuth')!.classList.remove('hidden');
    return;
  }

  document.getElementById('adminContent')!.classList.remove('hidden');
  const roles = rolesFromMe(data.user);
  const isFullAdmin = data.user.is_admin === true;
  const isAnnouncer = data.user.is_announcer === true;
  const isSymposium = data.user.is_symposium === true;
  const isSocial = data.user.is_social === true || data.user.is_social_publisher === true;
  const isSocialPublisher = isFullAdmin || data.user.is_social_publisher === true;
  const canManageAnnouncements = isFullAdmin || isAnnouncer;
  setCanManageAnnouncements(canManageAnnouncements);
  const canEditSymposium = isFullAdmin || isSymposium;
  const params = new URLSearchParams(location.search);
  const connected = params.get('connected');
  const connectionError = params.get('connection_error');

  // The shell runs a section's loader as soon as it shows it, so whatever
  // a loader needs is wired before the shell starts.
  if (isFullAdmin) {
    setupConnections({ t: t as (k: string) => string, showToast, lang });
    setupAudit({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, showToast, lang });
  }
  if (isFullAdmin || isSocial) {
    setupSocial({
      t: t as (k: string) => string,
      tf: tf as (k: string, v: Record<string, string | number>) => string,
      showToast, lang, me: { id: data.user.id, isPublisher: isSocialPublisher }, refreshCounts,
    });
  }
  const onShow: Partial<Record<SectionId, () => Promise<void>>> = {
    // Overview's System block is filled by the health check, whichever finishes first.
    genel: loadOverview,
    baglantilar: onFirstShow(loadConnections, 'admin.connections.loadFailed'),
    kayit: onFirstShow(() => loadAudit(), 'admin.audit.loadFailed'),
    sosyal: onFirstShow(loadSocial, 'admin.social.loadFailed'),
  };
  const onSub: Partial<Record<SectionId, (sub: string) => void>> = {
    sosyal: (sub) => { if (Object.hasOwn(SOCIAL_TABS, sub)) showSocialTab(SOCIAL_TABS[sub]); },
  };
  // Back from a Gmail reconnect: the shell opens Connections; say how it went.
  startShell(roles, { onShow, onSub });
  if (connected || connectionError) {
    const known = ['bad_state', 'not_admin', 'cancelled', 'token_exchange', 'no_refresh_token', 'missing_scope', 'wrong_account', 'store_failed', 'not_configured', 'not_professional', 'not_page_admin', 'lookup_failed'];
    if (connected) showToast(tf('admin.connections.connected', { platform: t(`admin.connections.platform.${connected}` as never) }));
    else showToast(t(`admin.connections.error.${known.includes(connectionError!) ? connectionError : 'unknown'}` as never), true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  void loadHealth(healthDeps);
  if (canManageAnnouncements) {
    await loadAnnouncements();
    setupAnnouncementForm();
  }
  if (isFullAdmin) await loadUsers();
  if (isFullAdmin) await loadBlogSubmissions();
  if (isFullAdmin) {
    setupBulkGrant();
    setupAttachmentUpload();
    await Promise.all([loadSenders(), loadAdminAttachments(), loadAllSends()]);
  }
  if (canEditSymposium) {
    setupSymposium();
    await loadSymposium();
  }

  // The filter buttons and the search box belong to the users pane, which
  // only a full admin's panel renders. The `!` below said otherwise, and for
  // a symposium organiser -- the account this panel's committee section is
  // for -- getElementById returned null and the bootstrap threw. It is the
  // last statement in this function, so nothing was lost, but every one of
  // those visits logged an error and the next line added here would have
  // been.
  if (isFullAdmin) {
    setupUsersFilters();
  }
})();
