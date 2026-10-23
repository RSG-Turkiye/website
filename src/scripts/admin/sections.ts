/**
 * The admin panel's sections: one table that the sidebar, the phone drawer,
 * routing and Overview all read. Visibility mirrors the server's role checks;
 * it never grants anything the server would refuse.
 */
import { rightsFromRoles, grantableBy, type GroupRights, type RoleKey } from '../../../functions/_lib/roles';

/**
 * `cms`: edit and approve rights per content group (from live grants; those
 * roles have no is_* column). `canGrant`: the roles a non-admin approver may
 * hand out, which is what opens the Roles sub-page to them.
 */
export type RoleFlags = {
  admin: boolean; announcer: boolean; symposium: boolean; social: boolean; socialPublisher: boolean; sender: boolean;
  cms: GroupRights; canGrant: RoleKey[];
};
export type GroupId = 'iletisim' | 'icerik' | 'topluluk' | 'sistem';
export type SectionId = 'genel' | 'istatistik' | 'eposta' | 'sosyal' | 'duyurular' | 'blog' | 'sempozyum' | 'uyelik' | 'kullanicilar' | 'baglantilar' | 'kayit';
export type CountKey = 'email' | 'social' | 'blog' | 'membership' | 'dm' | 'socialTotal';

/** `count`: the sub-page's tab carries that menu count too (a sender-only panel has no menu to show it). */
export interface SubPage { id: string; label: string; publisherOnly?: boolean; adminOnly?: boolean; senderOnly?: boolean; count?: CountKey }
export interface Section {
  id: SectionId;
  group: GroupId | null;
  label: string;
  subs: SubPage[];
  count?: CountKey;
  visible(r: RoleFlags): boolean;
}

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'iletisim', label: 'admin.nav.group.communication' },
  { id: 'icerik', label: 'admin.nav.group.content' },
  { id: 'topluluk', label: 'admin.nav.group.community' },
  { id: 'sistem', label: 'admin.nav.group.system' },
];

const adminOnly = (r: RoleFlags) => r.admin;

export const SECTIONS: Section[] = [
  { id: 'genel', group: null, label: 'admin.nav.overview', subs: [], visible: () => true },
  { id: 'istatistik', group: null, label: 'admin.stats.heading', subs: [], visible: adminOnly },
  {
    id: 'eposta', group: 'iletisim', label: 'admin.nav.email', count: 'email', visible: (r) => r.admin || r.sender,
    subs: [
      { id: 'gelen', label: 'admin.mail.nav.inbox', count: 'email' },
      { id: 'yaz', label: 'admin.mail.nav.compose', senderOnly: true },
      { id: 'gonderilenler', label: 'admin.mail.nav.sent' },
      { id: 'yetki', label: 'admin.mail.bulkGrant.heading', adminOnly: true },
      { id: 'gondericiler', label: 'admin.mail.senders.heading', adminOnly: true },
      { id: 'ekler', label: 'admin.mail.attachments.heading', adminOnly: true },
    ],
  },
  {
    id: 'sosyal', group: 'iletisim', label: 'admin.social.heading', count: 'socialTotal', visible: (r) => r.admin || r.social,
    subs: [
      { id: 'takvim', label: 'admin.social.tab.calendar' },
      { id: 'onay', label: 'admin.social.tab.pending', publisherOnly: true },
      { id: 'taslaklar', label: 'admin.social.tab.drafts' },
      { id: 'yayinlananlar', label: 'admin.social.tab.published' },
      { id: 'etkinlik', label: 'admin.social.tab.events' },
      { id: 'dm', label: 'admin.social.tab.dm', publisherOnly: true, count: 'dm' },
    ],
  },
  { id: 'duyurular', group: 'iletisim', label: 'admin.announcements.heading', subs: [], visible: (r) => r.admin || r.announcer },
  { id: 'blog', group: 'icerik', label: 'admin.blog.heading', count: 'blog', subs: [], visible: adminOnly },
  {
    id: 'sempozyum', group: 'icerik', label: 'admin.symposium.heading', visible: (r) => r.admin || r.symposium,
    subs: [
      { id: 'baski', label: 'admin.symposium.edition.heading' },
      { id: 'konusmacilar', label: 'admin.symposium.speakers.heading' },
      { id: 'oturumlar', label: 'admin.symposium.sessions.heading' },
      { id: 'komite', label: 'admin.symposium.committee.heading' },
      { id: 'sertifikalar', label: 'admin.symposium.certificates.heading' },
    ],
  },
  // Part 3 (membership) makes this visible.
  { id: 'uyelik', group: 'topluluk', label: 'admin.nav.membership', count: 'membership', subs: [], visible: () => false },
  {
    // An approver comes in for the Roles sub-page, to grant their group's edit role.
    id: 'kullanicilar', group: 'topluluk', label: 'admin.nav.users', visible: (r) => r.admin || r.canGrant.length > 0,
    subs: [
      { id: 'liste', label: 'admin.nav.usersList', adminOnly: true },
      { id: 'yetkiler', label: 'admin.nav.roles' },
    ],
  },
  { id: 'baglantilar', group: 'sistem', label: 'admin.connections.heading', subs: [], visible: adminOnly },
  { id: 'kayit', group: 'sistem', label: 'admin.nav.audit', subs: [], visible: adminOnly },
];

export function visibleSections(r: RoleFlags): Section[] {
  const work = SECTIONS.filter((s) => s.id !== 'genel' && s.visible(r));
  if (work.length === 0) return [];
  return work.length >= 2 ? [SECTIONS[0], ...work] : work;
}

export function subsFor(s: Section, r: RoleFlags): SubPage[] {
  return s.subs.filter((x) => (!x.publisherOnly || r.admin || r.socialPublisher) && (!x.adminOnly || r.admin) && (!x.senderOnly || r.sender));
}

export function landing(r: RoleFlags): SectionId | null {
  return visibleSections(r)[0]?.id ?? null;
}

export type SentScope = 'mine' | 'all';
/**
 * Where the Sent list starts. Whoever can send starts on their own mail; an
 * admin who cannot send has none, so starts on everyone's.
 */
export function defaultSentScope(admin: boolean, sender: boolean): SentScope {
  return admin && !sender ? 'all' : 'mine';
}

const yes = (v: unknown) => v === true || v === 1;
/** The roles of /api/me's live `grants`. */
export function grantedRoles(u: Record<string, unknown>): string[] {
  return Array.isArray(u.grants) ? u.grants.map((g) => (g as { role?: unknown })?.role).filter((r): r is string => typeof r === 'string') : [];
}

export function rolesFromMe(u: Record<string, unknown>): RoleFlags {
  const socialPublisher = yes(u.is_social_publisher);
  const admin = yes(u.is_admin);
  const roles = grantedRoles(u);
  return {
    admin, announcer: yes(u.is_announcer), symposium: yes(u.is_symposium),
    social: yes(u.is_social) || socialPublisher, socialPublisher, sender: yes(u.is_sender),
    cms: rightsFromRoles(roles, admin), canGrant: admin ? [] : grantableBy(roles),
  };
}
