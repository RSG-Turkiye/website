/**
 * The admin panel's sections: one table that the sidebar, the phone drawer,
 * routing and Overview all read. Visibility mirrors the server's role checks;
 * it never grants anything the server would refuse.
 */
export type RoleFlags = { admin: boolean; announcer: boolean; symposium: boolean; social: boolean; socialPublisher: boolean };
export type GroupId = 'iletisim' | 'icerik' | 'topluluk' | 'sistem';
export type SectionId = 'genel' | 'eposta' | 'sosyal' | 'duyurular' | 'blog' | 'sempozyum' | 'uyelik' | 'kullanicilar' | 'baglantilar' | 'kayit';
export type CountKey = 'email' | 'social' | 'blog' | 'membership';

export interface SubPage { id: string; label: string; publisherOnly?: boolean }
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
  {
    id: 'eposta', group: 'iletisim', label: 'admin.nav.email', count: 'email', visible: adminOnly,
    subs: [
      { id: 'yetki', label: 'admin.mail.bulkGrant.heading' },
      { id: 'gondericiler', label: 'admin.mail.senders.heading' },
      { id: 'ekler', label: 'admin.mail.attachments.heading' },
      { id: 'gonderilenler', label: 'admin.mail.allSends.heading' },
    ],
  },
  {
    id: 'sosyal', group: 'iletisim', label: 'admin.social.heading', count: 'social', visible: (r) => r.admin || r.social,
    subs: [
      { id: 'takvim', label: 'admin.social.tab.calendar' },
      { id: 'onay', label: 'admin.social.tab.pending', publisherOnly: true },
      { id: 'taslaklar', label: 'admin.social.tab.drafts' },
      { id: 'yayinlananlar', label: 'admin.social.tab.published' },
      { id: 'etkinlik', label: 'admin.social.tab.events' },
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
    id: 'kullanicilar', group: 'topluluk', label: 'admin.nav.users', visible: adminOnly,
    subs: [
      { id: 'liste', label: 'admin.nav.usersList' },
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
  return s.subs.filter((x) => !x.publisherOnly || r.admin || r.socialPublisher);
}

export function landing(r: RoleFlags): SectionId | null {
  return visibleSections(r)[0]?.id ?? null;
}

const yes = (v: unknown) => v === true || v === 1;
export function rolesFromMe(u: Record<string, unknown>): RoleFlags {
  const socialPublisher = yes(u.is_social_publisher);
  return {
    admin: yes(u.is_admin), announcer: yes(u.is_announcer), symposium: yes(u.is_symposium),
    social: yes(u.is_social) || socialPublisher, socialPublisher,
  };
}
