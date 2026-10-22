// The privacy notice, in both languages. Each fact here is what the code does
// today: when a table, a retention job or a third-party call changes, change
// the matching line too. tests/privacy-page.test.ts pins the retention numbers
// to the constants that enforce them.

export const PRIVACY_UPDATED = '2026-10-23';
export const PRIVACY_CONTACT = 'turkey.rsg@gmail.com';

export interface PrivacySection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface PrivacyNotice {
  title: string;
  description: string;
  updated: string;
  intro: string[];
  sections: PrivacySection[];
}

export const PRIVACY: Record<'en' | 'tr', PrivacyNotice> = {
  en: {
    title: 'Privacy Policy',
    description:
      'What personal data the RSG-Turkiye website collects, why, how long it is kept, who else receives it, and how to ask for it to be deleted.',
    updated: 'Last updated',
    intro: [
      'RSG-Turkiye is the Türkiye Regional Student Group of the ISCB Student Council, a volunteer community in computational biology and bioinformatics. This page explains what this website does with personal data.',
      `Questions and requests go to ${PRIVACY_CONTACT}.`,
    ],
    sections: [
      {
        heading: 'What we collect',
        items: [
          'Signing in: the site uses Google sign-in only. We keep your email address and your Google account ID, plus the date you joined and last signed in. We never see or store your Google password.',
          'Your profile: the name, username, photo, institution, bio and interests you choose to enter, and your learning progress and badges. Profiles are listed on the public members page; ask us and we hide yours.',
          'Session cookie: one cookie, rsg_session, keeps you signed in for 30 days. It is not used for tracking or advertising, and the site sets no other cookies.',
          'Email with members: messages we send to members through our Gmail account, and the replies we receive, are kept so the team can follow a conversation.',
          'Blog submissions: the title, text, author name and images you send.',
          'Certificates: for symposium certificates we hold the participant\'s name and email address. When you look up a certificate we store a one-way hash of your IP address, not the address itself, to limit repeated lookups. We count how many times each certificate is viewed and downloaded; the team sees only totals, never who.',
          'Visit counts: this site and the symposium site use Cloudflare Web Analytics, which counts page views without cookies and without identifying you. We see totals only: which pages are read, from which country, on what kind of device, and which site linked here. It is not loaded on your account pages or the admin panel.',
          'Admin activity: actions taken in the admin panel are logged with the team member who took them.',
          'Your browser also stores a few small settings locally (for example, a dismissed notice). These never leave your device.',
        ],
      },
      {
        heading: 'What we do not collect',
        items: [
          'No advertising trackers, and no cookies for measuring visits.',
          'The membership form on the Join page is a Google Form. What you enter there goes to Google and to our team through Google, not to this website.',
        ],
      },
      {
        heading: 'How long we keep it',
        items: [
          'Certificates and the names and emails on them: 30 days after upload.',
          'Certificate lookup records: 1 day.',
          'Sessions: 30 days, or until you sign out.',
          'Admin activity log: 1 year.',
          'Your account, profile, member emails and blog submissions: until you ask us to delete them.',
        ],
      },
      {
        heading: 'Who else receives data',
        items: [
          'Cloudflare hosts the site, its database and its file storage, and counts visits (see above).',
          'Google: sign-in, the Gmail account we use to write to members, the Join page form, the events calendar on the home page, and the Inter font. The font and calendar are loaded by your browser, so Google sees your IP address when you open those pages.',
          'YouTube: webinar recordings are embedded from YouTube.',
          'GitHub: approved blog posts are published through our public GitHub repository.',
          'Instagram and LinkedIn: the team publishes posts to RSG-Turkiye\'s own accounts from the admin panel. Access to those accounts is granted with OAuth and stored encrypted; we never store their passwords. Direct messages sent to our Instagram account are read and answered by the social media team in the admin panel: they are fetched from Instagram when opened. The site stores the sender\'s Instagram username and account ID, the times of the latest messages and which team member last opened the conversation, not the messages themselves.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          `Under Türkiye's KVKK and the EU GDPR you can ask what we hold about you, ask us to correct it, or ask us to delete your account and everything linked to it. Write to ${PRIVACY_CONTACT} from the address you signed in with. We answer within 30 days.`,
          'You can edit your profile yourself at any time. To take it off the public members page, write to us.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: ['When this page changes, the date at the top changes with it.'],
      },
    ],
  },
  tr: {
    title: 'Gizlilik Politikası',
    description:
      'RSG-Türkiye web sitesi hangi kişisel verileri, neden topluyor, ne kadar saklıyor, kimlerle paylaşıyor ve silinmesini nasıl isteyebilirsiniz.',
    updated: 'Son güncelleme',
    intro: [
      'RSG-Türkiye, ISCB Student Council\'ın Türkiye Bölgesel Öğrenci Grubu; hesaplamalı biyoloji ve biyoinformatik alanında gönüllü bir topluluktur. Bu sayfa, bu web sitesinin kişisel verilerle ne yaptığını açıklar.',
      `Soru ve talepleriniz için: ${PRIVACY_CONTACT}.`,
    ],
    sections: [
      {
        heading: 'Topladıklarımız',
        items: [
          'Giriş: Site yalnızca Google ile girişi kullanır. E-posta adresinizi ve Google hesap kimliğinizi, katılma ve son giriş tarihinizle birlikte saklarız. Google şifrenizi hiçbir zaman görmez ve saklamayız.',
          'Profiliniz: Girmeyi seçtiğiniz ad, kullanıcı adı, fotoğraf, kurum, kısa tanıtım ve ilgi alanları ile öğrenme ilerlemeniz ve rozetleriniz. Profiller herkese açık üyeler sayfasında listelenir; isterseniz sizinkini gizleriz.',
          'Oturum çerezi: Tek bir çerez, rsg_session, sizi 30 gün boyunca oturumda tutar. İzleme ya da reklam için kullanılmaz; site başka çerez koymaz.',
          'Üyelerle yazışmalar: Gmail hesabımızdan üyelere gönderdiğimiz mesajlar ve gelen yanıtlar, ekip bir yazışmayı takip edebilsin diye saklanır.',
          'Blog gönderileri: Gönderdiğiniz başlık, metin, yazar adı ve görseller.',
          'Sertifikalar: Sempozyum sertifikaları için katılımcının adını ve e-posta adresini tutarız. Sertifika sorguladığınızda, tekrarlanan sorguları sınırlamak için IP adresinizin kendisini değil, tek yönlü bir özetini (hash) saklarız. Her sertifikanın kaç kez görüntülendiğini ve indirildiğini sayarız; ekip sadece toplamları görür, kimin olduğunu görmez.',
          'Ziyaret sayıları: Bu site ve sempozyum sitesi Cloudflare Web Analytics kullanır; sayfa görüntülemelerini çerez kullanmadan ve sizi tanımlamadan sayar. Biz sadece toplamları görürüz: hangi sayfaların okunduğu, hangi ülkeden, ne tür cihazdan girildiği ve hangi sitenin buraya bağlantı verdiği. Hesap sayfalarınızda ve yönetim panelinde yüklenmez.',
          'Yönetici işlemleri: Yönetim panelinde yapılan işlemler, yapan ekip üyesiyle birlikte kaydedilir.',
          'Tarayıcınız ayrıca birkaç küçük ayarı (örneğin kapattığınız bir duyuruyu) yerel olarak saklar. Bunlar cihazınızdan çıkmaz.',
        ],
      },
      {
        heading: 'Toplamadıklarımız',
        items: [
          'Reklam izleyicisi yoktur; ziyaretleri saymak için çerez kullanılmaz.',
          'Bize Katıl sayfasındaki üyelik formu bir Google Formu\'dur. Oraya girdikleriniz bu siteye değil, Google\'a ve Google üzerinden ekibimize gider.',
        ],
      },
      {
        heading: 'Ne kadar saklıyoruz',
        items: [
          'Sertifikalar ve üzerlerindeki ad ve e-postalar: yüklendikten 30 gün sonra silinir.',
          'Sertifika sorgu kayıtları: 1 gün.',
          'Oturumlar: 30 gün ya da çıkış yapana kadar.',
          'Yönetici işlem kaydı: 1 yıl.',
          'Hesabınız, profiliniz, üye yazışmaları ve blog gönderileri: silinmesini isteyene kadar.',
        ],
      },
      {
        heading: 'Veriler kimlere gider',
        items: [
          'Cloudflare siteyi, veritabanını ve dosya depolamayı barındırır ve ziyaretleri sayar (yukarıya bakın).',
          'Google: giriş, üyelere yazdığımız Gmail hesabı, Bize Katıl sayfasındaki form, ana sayfadaki etkinlik takvimi ve Inter yazı tipi. Yazı tipi ve takvim tarayıcınız tarafından yüklenir; bu sayfaları açtığınızda Google IP adresinizi görür.',
          'YouTube: Webinar kayıtları YouTube\'dan gömülür.',
          'GitHub: Onaylanan blog yazıları herkese açık GitHub depomuz üzerinden yayınlanır.',
          'Instagram ve LinkedIn: Ekip, yönetim panelinden RSG-Türkiye\'nin kendi hesaplarına paylaşım yapar. Bu hesaplara erişim OAuth ile verilir ve şifreli saklanır; şifrelerini hiçbir zaman saklamayız. Instagram hesabımıza gönderilen doğrudan mesajları sosyal medya ekibi yönetim panelinden okur ve cevaplar: mesajlar açıldığında Instagram\'dan çekilir. Site, gönderenin Instagram kullanıcı adını ve hesap kimliğini, son mesajların zamanını ve konuşmayı en son hangi ekip üyesinin açtığını saklar; mesajların kendisini saklamaz.',
        ],
      },
      {
        heading: 'Haklarınız',
        paragraphs: [
          `KVKK ve AB GDPR kapsamında hakkınızda ne tuttuğumuzu öğrenebilir, düzeltilmesini ya da hesabınızın ve ona bağlı her şeyin silinmesini isteyebilirsiniz. Giriş yaptığınız adresten ${PRIVACY_CONTACT} adresine yazın. 30 gün içinde yanıt veririz.`,
          'Profilinizi istediğiniz zaman kendiniz düzenleyebilirsiniz. Herkese açık üyeler sayfasından kaldırılması için bize yazın.',
        ],
      },
      {
        heading: 'Değişiklikler',
        paragraphs: ['Bu sayfa değiştiğinde en üstteki tarih de değişir.'],
      },
    ],
  },
};
