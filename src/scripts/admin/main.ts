// Shared client-side logic for the admin panel, used by both the English
// (/admin) and Turkish (/tr/admin) pages via AdminShell.astro. This used to
// be two 900-line near-clones of this file, one per language, with every
// user-facing string duplicated and hand-translated in place. All of that
// copy now lives in src/i18n/ui.ts under the `admin.*` keys; this module
// looks up the current page's language from the <html lang> attribute that
// BaseLayout already sets, and renders the same markup either way.
import { loadHealth } from '../admin-health';
import { setupConnections, loadConnections } from '../admin-connections';
import { setupAudit, loadAudit } from '../admin-audit';
import { setupSocial, loadSocial, showSocialTab, type Tab } from '../social';
import { lang, t, tf, showToast } from './context';
import { landing, rolesFromMe, grantedRoles, type SectionId } from './sections';
import { startShell, refreshCounts } from './shell';
import { loadOverview } from './overview';
import { loadUsers, setupUsersFilters, setCurrentUserId, setGranter, loadRolesView } from './sections/users';
import { loadAnnouncements, setupAnnouncementForm, setCanManageAnnouncements } from './sections/announcements';
import { loadBlogSubmissions } from './sections/blog';
import { loadSenders, setupBulkGrant, loadAdminAttachments, setupAttachmentUpload } from './sections/mail';
import { showSent, setSentAdmin } from './sections/mail-sent';
import { setupCompose, loadQueued } from './sections/mail-compose';
import { setupInbox, showInbox } from './sections/mail-inbox';
import { setupDm, showDm } from './sections/social-dm';
import { setupSymposium, loadSymposium } from './sections/symposium';
import { loadStats } from './sections/stats';
import { setupCms, showCms } from './sections/cms';

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

  // Signed out (a reply notification opened on a phone with no session,
  // say): ask to sign in. Signed in without a panel role: no access.
  if (!data.user) {
    document.getElementById('notSignedIn')!.classList.remove('hidden');
    // Back to this exact place after Google: the fragment never reaches the server, so it travels as ?next=.
    document.getElementById('notSignedInLink')?.setAttribute('href', `/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}`);
    return;
  }
  if (landing(rolesFromMe(data.user)) === null) {
    document.getElementById('notAuth')!.classList.remove('hidden');
    return;
  }

  document.getElementById('adminContent')!.classList.remove('hidden');
  const roles = rolesFromMe(data.user);
  const isFullAdmin = data.user.is_admin === true;
  const isSender = data.user.is_sender === true;
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
  // A non-admin approver opens the Roles tab with just the cards they may grant.
  setGranter({ isAdmin: isFullAdmin, activeRoles: grantedRoles(data.user) });
  if (isFullAdmin) {
    // Before the shell starts: opening /admin#kullanicilar/yetkiler renders
    // the role cards, which lock one's own Admin chip, straight away.
    setCurrentUserId(data.user.id ?? null);
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
  if (isSocialPublisher) setupDm({ isAdmin: isFullAdmin });
  const onShow: Partial<Record<SectionId, () => Promise<void>>> = {
    // Overview's System block is filled by the health check, whichever finishes first.
    genel: loadOverview,
    istatistik: onFirstShow(loadStats, 'admin.stats.loadFailed'),
    baglantilar: onFirstShow(loadConnections, 'admin.connections.loadFailed'),
    kayit: onFirstShow(() => loadAudit(), 'admin.audit.loadFailed'),
    sosyal: onFirstShow(loadSocial, 'admin.social.loadFailed'),
  };
  // Senders and admins both list sent mail: the first time that sub-page
  // shows, and again after a send or a failed load.
  setSentAdmin(isFullAdmin, isSender);
  // Compose is a sender's tool; its queue loads the first time it shows.
  let queuedLoaded = false;
  if (isSender) setupCompose({ isAdmin: isFullAdmin, email: data.user.email ?? null });
  // The inbox is for senders and admins alike; it opens whatever thread the address names.
  if (isFullAdmin || isSender) setupInbox({ isAdmin: isFullAdmin, isSender });
  const onSub: Partial<Record<SectionId, (sub: string, item: string | null) => void>> = {
    sosyal: (sub, item) => {
      if (sub === 'dm') { if (isSocialPublisher) void showDm(item); return; }
      if (Object.hasOwn(SOCIAL_TABS, sub)) showSocialTab(SOCIAL_TABS[sub]);
    },
    eposta: (sub, item) => {
      if (sub === 'gelen') {
        void showInbox(item);
        return;
      }
      if (sub === 'yaz' && isSender && !queuedLoaded) {
        queuedLoaded = true;
        loadQueued().catch(() => { queuedLoaded = false; });
        return;
      }
      if (sub === 'gonderilenler' && (isFullAdmin || isSender)) showSent();
    },
    kullanicilar: (sub) => { if (sub === 'yetkiler') void loadRolesView(); },
    'icerik-etkinlikler': (sub, item) => showCms(sub, item),
  };
  // Content editors, approvers and admins: the form exists before the shell
  // opens a deep link to a draft.
  if (roles.cms.etkinlikler?.edit) setupCms({ approver: roles.cms.etkinlikler.approve, userId: String(data.user.id ?? '') });
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
    await Promise.all([loadSenders(), loadAdminAttachments()]);
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
