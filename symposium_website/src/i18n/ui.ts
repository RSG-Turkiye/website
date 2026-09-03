export const languages = { en: "English", tr: "Türkçe" };
export const defaultLang = "en";

export const ui = {
  en: {
    "site.title": "RSG-Türkiye Student Symposium",
    "site.description":
      "Annual student symposium on computational biology and bioinformatics, organized by ISCB SC RSG-Türkiye.",

    "nav.home": "Home",
    "nav.speakers": "Speakers",
    "nav.schedule": "Schedule",
    "nav.venue": "Venue",
    "nav.about": "About",
    "nav.sponsors": "Sponsors",
    "nav.editions": "Past Editions",
    "editions.upcoming.heading": "Next symposium",
    "editions.past.heading": "Past symposiums",
    "editions.badge.upcoming": "Upcoming",
    "nav.committee": "Committee",

    "hero.tagline": "ISCB SC RSG-Türkiye Student Symposium",
    "hero.subtitle":
      "Bringing together students and researchers in computational biology and bioinformatics.",
    "hero.cta.about": "Learn More",

    "cta.register": "Register",
    "cta.abstract": "Submit an Abstract",
    "cta.soon": "Registration and the call for abstracts open soon.",
    "cta.deadline": "Deadline: {date}",
    "hero.countdown.days": "days to go",

    "home.about.title": "About the Symposium",
    "home.about.body":
      "RSG-Türkiye is a student-led, non-profit organization affiliated with the International Society for Computational Biology Student Council (ISCB SC). Since 2012, we have been organizing annual student symposiums that attract undergraduate and graduate students and foster interdisciplinary collaboration in computational biology and bioinformatics across Türkiye.",

    "home.latest.title": "Latest Edition",
    "home.sponsors.title": "Our Sponsors",

    "speakers.title": "Speakers",
    "speakers.subtitle": "Meet the researchers and scientists at our symposium.",
    "speakers.filter.all": "All Editions",
    "speakers.none": "Speakers will be announced soon.",

    "schedule.title": "Program",
    "schedule.subtitle": "Programme",
    "schedule.none": "Schedule will be announced soon.",
    // The finished state: after an edition ends, its programme stays up as a
    // record rather than reverting to "will be announced soon" about an event
    // that already happened.
    "schedule.past.note": "This is the programme as it was held.",
    "schedule.past.none": "No programme was recorded for this edition.",
    "speakers.past.none": "No speakers were recorded for this edition.",
    "committee.past.none": "No committee was recorded for this edition.",
    "edition.finished.badge": "Completed",
    "edition.finished.thanks": "Thank you to everyone who joined us.",
    "edition.justheld.badge": "Just held",
    "edition.recordings": "Watch the talks",
    // No countdown to a date nobody has set: a counter to an invented day
    // would be telling visitors something untrue, and would make the real
    // countdown mean less when there is one. The ordinal, year and season are
    // all derived from the edition that just ended.
    "edition.next.known": "The {ordinal} symposium is expected in {season} {year}.",
    "edition.next.unknown": "The next symposium is expected in {season} {year}.",
    // When the predicted year has itself gone by, the number is still known
    // and the date is not, so the sentence stops claiming one.
    "edition.next.tba": "The {ordinal} symposium will be announced here.",
    "edition.next.tba.unknown": "The next symposium will be announced here.",
    "season.winter": "winter",
    "season.spring": "spring",
    "season.summer": "summer",
    "season.autumn": "autumn",

    "venue.title": "Venue",
    "venue.subtitle": "Where to find us",
    "venue.location": "Location",
    "venue.date": "Date",
    "venue.tba": "Venue to be announced",
    "venue.none": "Venue details will be announced soon.",

    "about.title": "About RSG-Türkiye",
    "about.mission.title": "Our Mission",
    "about.mission.body":
      "ISCB SC RSG-Türkiye has become a paramount student initiative, organizing events that contribute to the developing computational biology and bioinformatics society in Türkiye. We organize student symposiums attracting undergraduate and graduate students since 2012. Being less formal and more student-focused than HiBiT, our symposiums provide a platform where students can actively participate, present their work, and connect with researchers.",
    "about.history.title": "Previous Editions",

    "sponsors.title": "Our Sponsors",
    "sponsors.subtitle": "We thank our sponsors for their generous support.",
    "sponsors.become": "Become a Sponsor",

    "footer.tagline": "ISCB SC RSG-Türkiye Student Symposium",
    "footer.links": "Quick Links",
    "footer.connect": "Connect",
    "footer.copyright": "© {year} ISCB SC RSG-Türkiye. All rights reserved.",

    "404.title": "Page Not Found",
    "404.body": "The page you are looking for does not exist.",
    "404.home": "Back to Home",

    "committee.title": "Organising Committee",
    "committee.subtitle": "The team behind the symposium.",
    "committee.tba": "The organising committee will be announced soon.",
  },

  tr: {
    "site.title": "RSG-Türkiye Öğrenci Sempozyumu",
    "site.description":
      "ISCB SC RSG-Türkiye tarafından düzenlenen hesaplamalı biyoloji ve biyoinformatik alanındaki yıllık öğrenci sempozyumu.",

    "nav.home": "Ana Sayfa",
    "nav.speakers": "Konuşmacılar",
    "nav.schedule": "Program",
    "nav.venue": "Mekan",
    "nav.about": "Hakkında",
    "nav.sponsors": "Sponsorlar",
    "nav.editions": "Geçmiş Edisyonlar",
    "editions.upcoming.heading": "Sıradaki sempozyum",
    "editions.past.heading": "Geçmiş sempozyumlar",
    "editions.badge.upcoming": "Yaklaşan",
    "nav.committee": "Komite",

    "hero.tagline": "ISCB SC RSG-Türkiye Öğrenci Sempozyumu",
    "hero.subtitle":
      "Hesaplamalı biyoloji ve biyoinformatik alanındaki öğrencileri ve araştırmacıları bir araya getiriyoruz.",
    "hero.cta.about": "Daha Fazla",

    "cta.register": "Kayıt Ol",
    "cta.abstract": "Bildiri Gönder",
    "cta.soon": "Kayıt ve bildiri çağrısı yakında açılacak.",
    "cta.deadline": "Son tarih: {date}",
    "hero.countdown.days": "gün kaldı",

    "home.about.title": "Sempozyum Hakkında",
    "home.about.body":
      "RSG-Türkiye, Uluslararası Hesaplamalı Biyoloji Derneği Öğrenci Konseyi'ne (ISCB SC) bağlı, öğrenci liderliğinde, kar amacı gütmeyen bir organizasyondur. 2012'den bu yana Türkiye'deki hesaplamalı biyoloji ve biyoinformatik topluluğuna katkıda bulunmak amacıyla lisans ve lisansüstü öğrencileri çeken yıllık öğrenci sempozyumları düzenliyoruz.",

    "home.latest.title": "Son Edisyon",
    "home.sponsors.title": "Sponsorlarımız",

    "speakers.title": "Konuşmacılar",
    "speakers.subtitle": "Sempozyumumuzdaki araştırmacı ve bilim insanlarıyla tanışın.",
    "speakers.filter.all": "Tüm Edisyonlar",
    "speakers.none": "Konuşmacılar yakında duyurulacak.",

    "schedule.title": "Program",
    "schedule.subtitle": "Program",
    "schedule.none": "Program yakında duyurulacak.",
    "schedule.past.note": "Sempozyumun gerçekleşen programı.",
    "schedule.past.none": "Bu edisyon için program kaydı yok.",
    "speakers.past.none": "Bu edisyon için konuşmacı kaydı yok.",
    "committee.past.none": "Bu edisyon için kurul kaydı yok.",
    "edition.finished.badge": "Tamamlandı",
    "edition.finished.thanks": "Katılan herkese teşekkür ederiz.",
    "edition.justheld.badge": "Yeni yapıldı",
    "edition.recordings": "Sunumları izle",
    "edition.next.known": "{ordinal} sempozyumun {year} {season} yapılması bekleniyor.",
    "edition.next.unknown": "Bir sonraki sempozyumun {year} {season} yapılması bekleniyor.",
    "edition.next.tba": "{ordinal} sempozyum burada duyurulacak.",
    "edition.next.tba.unknown": "Bir sonraki sempozyum burada duyurulacak.",
    "season.winter": "kışında",
    "season.spring": "ilkbaharında",
    "season.summer": "yazında",
    "season.autumn": "sonbaharında",

    "venue.title": "Mekan",
    "venue.subtitle": "Nerede bulabilirsiniz",
    "venue.location": "Konum",
    "venue.date": "Tarih",
    "venue.tba": "Yer yakında açıklanacak",
    "venue.none": "Mekan bilgileri yakında duyurulacak.",

    "about.title": "RSG-Türkiye Hakkında",
    "about.mission.title": "Misyonumuz",
    "about.mission.body":
      "ISCB SC RSG-Türkiye, Türkiye'deki hesaplamalı biyoloji ve biyoinformatik topluluğunun gelişimine katkıda bulunmak amacıyla etkinlikler düzenleyen önemli bir öğrenci inisiyatifi haline gelmiştir. 2012'den bu yana lisans ve lisansüstü öğrencileri çeken öğrenci sempozyumları düzenliyoruz. HiBiT'ten daha az resmi ve daha öğrenci odaklı olan sempozyumlarımız, öğrencilerin aktif olarak katılabileceği, çalışmalarını sunabileceği ve araştırmacılarla bağlantı kurabileceği bir platform sunmaktadır.",
    "about.history.title": "Önceki Edisyonlar",

    "sponsors.title": "Sponsorlarımız",
    "sponsors.subtitle": "Cömert destekleri için sponsorlarımıza teşekkür ederiz.",
    "sponsors.become": "Sponsor Olun",

    "footer.tagline": "ISCB SC RSG-Türkiye Öğrenci Sempozyumu",
    "footer.links": "Hızlı Bağlantılar",
    "footer.connect": "Bağlantı",
    "footer.copyright": "© {year} ISCB SC RSG-Türkiye. Tüm hakları saklıdır.",

    "404.title": "Sayfa Bulunamadı",
    "404.body": "Aradığınız sayfa mevcut değil.",
    "404.home": "Ana Sayfaya Dön",

    "committee.title": "Düzenleme Kurulu",
    "committee.subtitle": "Sempozyumun arkasındaki ekip.",
    "committee.tba": "Düzenleme kurulu yakında duyurulacak.",
  },
} as const;

export type Lang = keyof typeof ui;
export type UIKey = keyof (typeof ui)["en"];

export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split("/");
  return maybeLang === "tr" ? "tr" : "en";
}

export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key] ?? ui["en"][key] ?? key;
  };
}

/**
 * A translation with values substituted into its {placeholders}.
 *
 * Sentences that mix a number and a translated word cannot be assembled by
 * concatenation: English wants "autumn 2027" and Turkish wants "2027
 * sonbaharında", so the order belongs to the sentence, not to the code.
 */
export function useFormat(lang: Lang) {
  const t = useTranslations(lang);
  return function tf(key: UIKey, values: Record<string, string | number>): string {
    return t(key).replace(/\{(\w+)\}/g, (whole, name) =>
      name in values ? String(values[name]) : whole
    );
  };
}
