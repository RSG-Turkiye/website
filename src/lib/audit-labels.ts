/**
 * Readable names for the activity log's action codes, in both languages. Kept
 * here rather than in ui.ts so each code's two names sit side by side and
 * tests/audit-labels.test.ts can check that every code the server writes has
 * them. An unknown code is shown as it is, never hidden.
 */
type Lang = 'en' | 'tr';
type Label = { en: string; tr: string };

const FIXED: Record<string, Label> = {
  'view.pane': { en: 'Opened a panel section', tr: 'Panelde bir bölüm açtı' },
  'media.upload': { en: 'Uploaded an image', tr: 'Görsel yükledi' },
  'read.audit': { en: 'Read the log', tr: 'Kayıtları okudu' },
  'read.connections': { en: 'Read the connections', tr: 'Bağlantıları okudu' },
  'read.stats': { en: 'Read the statistics', tr: 'İstatistiklere baktı' },
  'read.mail_thread': { en: 'Opened an e-mail conversation', tr: 'Bir e-posta konuşmasını açtı' },
  'read.dm_thread': { en: 'Opened an Instagram conversation', tr: 'Bir Instagram konuşmasını açtı' },

  'audit.export': { en: 'Exported the log', tr: 'Kayıtları dışa aktardı' },
  'audit.verify': { en: 'Verified the log', tr: 'Kayıtların bütünlüğünü doğruladı' },
  'audit.prune': { en: 'Removed log entries older than a year', tr: 'Bir yıldan eski kayıtlar silindi' },

  'role.change': { en: 'Changed a role', tr: 'Bir yetkiyi değiştirdi' },
  'role.grant': { en: 'Granted a role', tr: 'Yetki verdi' },
  'role.revoke': { en: 'Took back a role', tr: 'Yetkiyi geri aldı' },
  'role.expire': { en: 'A role ended', tr: 'Yetkinin süresi doldu' },

  'agent_token.create': { en: 'Created an agent token', tr: 'Ajan anahtarı oluşturdu' },
  'agent_token.revoke': { en: 'Revoked an agent token', tr: 'Ajan anahtarını iptal etti' },
  'agent_token.auto_revoke': { en: 'An agent token was revoked automatically', tr: 'Bir ajan anahtarı otomatik olarak iptal edildi' },

  'announcement.create': { en: 'Created an announcement', tr: 'Duyuru oluşturdu' },
  'announcement.update': { en: 'Edited an announcement', tr: 'Duyuruyu düzenledi' },
  'announcement.delete': { en: 'Deleted an announcement', tr: 'Duyuruyu sildi' },

  // The member blog form is retired (posts are content drafts now); its rows
  // stay in the log for a year and keep their names.
  'blog.approve': { en: 'Approved a blog submission', tr: 'Blog başvurusunu onayladı' },
  'blog.reject': { en: 'Declined a blog submission', tr: 'Blog başvurusunu geri çevirdi' },

  'cms.draft.create': { en: 'Created a content draft', tr: 'Taslak oluşturdu' },
  'cms.draft.update': { en: 'Edited a content draft', tr: 'Taslağı düzenledi' },
  'cms.draft.submit': { en: 'Sent a content draft for approval', tr: 'Taslağı onaya gönderdi' },
  'cms.draft.approve': { en: 'Approved a content draft', tr: 'Taslağı onayladı' },
  'cms.draft.reject': { en: 'Sent a content draft back', tr: 'Taslağı geri gönderdi' },
  'cms.draft.discard': { en: 'Deleted a content draft', tr: 'Taslağı sildi' },
  'cms.pr.open': { en: 'Content pull request opened', tr: 'İçerik PR\'ı açıldı' },
  'cms.pr.merged': { en: 'Content pull request merged', tr: 'İçerik PR\'ı birleştirildi' },
  'cms.pr.published': { en: 'Content went live', tr: 'İçerik yayına çıktı' },
  'cms.pr.failed': { en: 'Content pull request failed', tr: 'İçerik PR\'ı başarısız' },
  'cms.pr.cancel': { en: 'Cancelled a content PR', tr: 'İçerik PR\'ını iptal etti' },
  'cms.podcast.pull': { en: 'Checked the podcast feed for new episodes', tr: 'Podcast akışında yeni bölüm aradı' },
  'cms.podcast.result': { en: 'Podcast feed check ended without a draft', tr: 'Podcast akışı kontrolü taslaksız bitti' },
  'cms.draft.prune': { en: 'Removed finished content drafts older than 90 days', tr: '90 günden eski bitmiş taslaklar silindi' },

  'mail.send': { en: 'Sent an e-mail', tr: 'E-posta gönderdi' },
  'mail.reply': { en: 'Replied in a conversation', tr: 'Konuşmaya cevap yazdı' },
  'mail.schedule': { en: 'Scheduled an e-mail', tr: 'E-posta zamanladı' },
  'mail.scheduled.update': { en: 'Edited a scheduled e-mail', tr: 'Zamanlanmış e-postayı düzenledi' },
  'mail.scheduled.cancel': { en: 'Cancelled a scheduled e-mail', tr: 'Zamanlanmış e-postayı iptal etti' },
  'mail.scheduled.sent': { en: 'Scheduled e-mail sent', tr: 'Zamanlanmış e-posta gönderildi' },
  'mail.scheduled.dropped': { en: 'Scheduled e-mail could not be sent', tr: 'Zamanlanmış e-posta gönderilemedi' },
  'mail.attachment.upload': { en: 'Uploaded an attachment', tr: 'Ek yükledi' },
  'mail.attachment.activate': { en: 'Turned an attachment on', tr: 'Eki kullanıma açtı' },
  'mail.attachment.deactivate': { en: 'Turned an attachment off', tr: 'Eki kullanımdan kaldırdı' },

  'symposium.edition.update': { en: 'Edited the symposium settings', tr: 'Sempozyum ayarlarını düzenledi' },
  'symposium.snapshot': { en: 'Copied the symposium content to GitHub', tr: 'Sempozyum içeriğini GitHub\'a kopyaladı' },
  'symposium.rebuild': { en: 'Rebuilt the symposium site', tr: 'Sempozyum sitesini yeniden derletti' },
  'symposium.archive_pr': { en: 'Opened the archive pull request for an edition', tr: 'Bir yılın arşiv PR\'ı açıldı' },
  'symposium.archived': { en: 'Archived a symposium edition', tr: 'Bir sempozyum yılı arşivlendi' },

  'certificate.upload': { en: 'Uploaded a certificate', tr: 'Sertifika yükledi' },
  'certificate.replace': { en: 'Replaced a certificate', tr: 'Sertifikayı değiştirdi' },
  'certificate.delete': { en: 'Deleted a certificate', tr: 'Sertifikayı sildi' },
  'certificate.delete_year': { en: 'Deleted a year\'s certificates', tr: 'Bir yılın sertifikalarını sildi' },
  'certificate.purge': { en: 'Certificates deleted after 30 days', tr: '30 günü dolan sertifikalar silindi' },

  'connection.start': { en: 'Started connecting an account', tr: 'Hesap bağlamaya başladı' },
  'connection.connect': { en: 'Connected an account', tr: 'Hesap bağladı' },
  'connection.disconnect': { en: 'Disconnected an account', tr: 'Hesabın bağlantısını kaldırdı' },
  'connection.cancelled': { en: 'Cancelled connecting an account', tr: 'Hesap bağlamaktan vazgeçti' },
  'connection.rejected': { en: 'Connecting an account was refused', tr: 'Hesap bağlama reddedildi' },
  'connection.refresh': { en: 'Connection renewed', tr: 'Bağlantı yenilendi' },
  'connection.refresh_failed': { en: 'Connection could not be renewed', tr: 'Bağlantı yenilenemedi' },
  'connection.expiry_reminder': { en: 'Reminder sent: a connection is expiring', tr: 'Hatırlatma gönderildi: bağlantının süresi doluyor' },
  'connection.buffer_check': { en: 'Buffer channels checked', tr: 'Buffer kanalları kontrol edildi' },
  'connection.buffer_failed': { en: 'Buffer check failed', tr: 'Buffer kontrolü başarısız' },

  'social.plan.create': { en: 'Created a social media plan', tr: 'Sosyal medya planı oluşturdu' },
  'social.plan.update': { en: 'Edited a social media plan', tr: 'Sosyal medya planını düzenledi' },
  'social.plan.delete': { en: 'Deleted a social media plan', tr: 'Sosyal medya planını sildi' },
  'social.plan.remind': { en: 'Reminder sent for an empty plan', tr: 'Boş plan için hatırlatma gönderildi' },
  'social.post.create': { en: 'Created a post', tr: 'Paylaşım oluşturdu' },
  'social.post.update': { en: 'Edited a post', tr: 'Paylaşımı düzenledi' },
  'social.post.submit': { en: 'Sent a post for approval', tr: 'Paylaşımı onaya gönderdi' },
  'social.post.approve': { en: 'Approved a post', tr: 'Paylaşımı onayladı' },
  'social.post.reject': { en: 'Sent a post back', tr: 'Paylaşımı geri gönderdi' },
  'social.post.cancel': { en: 'Cancelled a post', tr: 'Paylaşımı iptal etti' },
  'social.post.delete': { en: 'Deleted a post', tr: 'Paylaşımı sildi' },
  'social.post.requeue': { en: 'Put a post back in the queue', tr: 'Paylaşımı tekrar sıraya aldı' },
  'social.post.published': { en: 'Post published', tr: 'Paylaşım yayımlandı' },
  'social.post.partially_published': { en: 'Post published on some platforms', tr: 'Paylaşım bazı platformlarda yayımlandı' },
  'social.post.failed': { en: 'Post could not be published', tr: 'Paylaşım yayımlanamadı' },
  'social.target.published': { en: 'Published on a platform', tr: 'Bir platformda yayımlandı' },
  'social.target.failed': { en: 'Could not publish on a platform', tr: 'Bir platformda yayımlanamadı' },
  'social.target.waiting': { en: 'Waiting for a connection', tr: 'Bağlantı bekleniyor' },
  'social.target.requeued': { en: 'Back in the queue for a platform', tr: 'Bir platform için tekrar sırada' },
  'social.target.skipped': { en: 'Platform skipped', tr: 'Platform atlandı' },
  'social.target.late': { en: 'Held: too late to publish', tr: 'Bekletildi: yayın saati geçti' },
  'social.target.container': { en: 'Instagram post prepared', tr: 'Instagram gönderisi hazırlandı' },
  'social.target.note': { en: 'Publishing note', tr: 'Yayın notu' },
  'social.event.open': { en: 'Opened an event window', tr: 'Etkinlik penceresini açtı' },
  'social.event.close': { en: 'Closed an event window', tr: 'Etkinlik penceresini kapattı' },
  'social.dm.reply': { en: 'Replied to an Instagram message', tr: 'Instagram mesajına cevap yazdı' },

  'user.verify': { en: 'Made someone a member', tr: 'Birini üye yaptı' },
  'user.unverify': { en: 'Removed someone\'s membership', tr: 'Birinin üyeliğini kaldırdı' },
  'user.award_badge': { en: 'Awarded a badge', tr: 'Rozet verdi' },
  'user.revoke_badge': { en: 'Took back a badge', tr: 'Rozeti geri aldı' },
  'user.set_rank': { en: 'Set a rank', tr: 'Rütbe belirledi' },
};

const KIND: Record<string, Label> = {
  speakers: { en: 'a speaker', tr: 'konuşmacı' },
  sessions: { en: 'a session', tr: 'oturum' },
  committee: { en: 'a committee member', tr: 'komite üyesi' },
};
const VERB: Record<string, Label> = {
  create: { en: 'Added', tr: 'ekledi' },
  update: { en: 'Edited', tr: 'düzenledi' },
  delete: { en: 'Removed', tr: 'sildi' },
};

/** The readable name, or null when there is none and the code should show as it is. */
export function auditLabel(action: string, lang: Lang): string | null {
  const fixed = FIXED[action];
  if (fixed) return fixed[lang];
  // symposium.<kind>.<verb>: one family, three kinds by three verbs.
  const m = /^symposium\.(speakers|sessions|committee)\.(create|update|delete)$/.exec(action);
  if (m) {
    const kind = KIND[m[1]][lang];
    const verb = VERB[m[2]][lang];
    return lang === 'en' ? `${verb} ${kind}` : `Sempozyumda ${kind} ${verb}`;
  }
  return null;
}
