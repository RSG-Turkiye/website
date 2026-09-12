export const languages = { en: "English", tr: "Türkçe" };
export const defaultLang = "en";

export const ui = {
  en: {
    "site.title": "RSG-Türkiye Student Symposium",
    "site.description":
      "Annual student symposium on computational biology and bioinformatics, organized by ISCB-SC RSG-Türkiye.",

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

    "hero.tagline": "ISCB-SC RSG-Türkiye Student Symposium",
    "hero.subtitle":
      "Bringing together students and researchers in computational biology and bioinformatics.",
    "hero.cta.about": "Learn More",

    "cta.register": "Register",
    "cta.abstract": "Submit an Abstract",
    "cta.soon": "Registration and the call for abstracts open soon.",
    "cta.closed": "Registration and abstract submission have closed.",
    "cta.deadline": "Deadline: {date}",
    "hero.countdown.days": "days to go",
    // Turkish has no plural agreement after a number, so both keys carry the
    // same string there. English does, and the hero said "1 days to go" on
    // the eve of the symposium.
    "hero.countdown.day": "day to go",

    "home.about.title": "About the Symposium",
    "home.about.body":
      "RSG-Türkiye is a student-led, non-profit organization affiliated with the International Society for Computational Biology Student Council (ISCB-SC). Since 2012, we have been organizing annual student symposiums that attract undergraduate and graduate students and foster interdisciplinary collaboration in computational biology and bioinformatics across Türkiye.",

    "home.latest.title": "Latest Edition",
    "home.sponsors.title": "Our Sponsors",

    "speakers.title": "Speakers",
    "speakers.subtitle": "Meet the researchers and scientists at our symposium.",
    "speakers.filter.all": "All Editions",
    "speakers.none": "Speakers will be announced soon.",

    // The wordmark under the logo, two lines by design.
    "brand.wordmark": "Student<br />Symposium",
    "schedule.title": "Program",
    "schedule.subtitle": "Every talk, workshop and break, in order.",
    // The ten session types, which used to be printed straight out of the
    // JSON. On /tr/schedule that meant "Keynote", "Break" and "Networking" in
    // the middle of a Turkish programme.
    "session.type.opening": "Opening",
    "session.type.keynote": "Keynote",
    "session.type.workshop": "Workshop",
    "session.type.panel": "Panel",
    "session.type.talk": "Talk",
    "session.type.company": "Industry",
    "session.type.poster": "Poster",
    "session.type.networking": "Networking",
    "session.type.break": "Break",
    "session.type.closing": "Closing",
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
    "venue.contact": "Contact",
    "venue.photoCaption": "The METU campus.",
    "venue.directions.title": "Getting There",
    "venue.directions.metro.title": "By metro: the simplest way",
    "venue.directions.metro.body": "Take the M2 line (Kızılay–Koru) and get off at ODTÜ. It is a short walk from the station to the A1 main gate on Eskişehir Yolu.",
    "venue.directions.bus.title": "By bus",
    "venue.directions.bus.body": "EGO buses along Eskişehir Yolu stop by the campus: 339-5, 419-5, 511-5, 512-5, 521-5, 530-5, 532-5, 541-5 and 602-6. There is also an Ayrancı dolmuş, which runs on weekdays and enters at the A4 gate.",
    "venue.directions.gates.title": "Campus gates",
    "venue.directions.gates.body": "A1 and A2 open onto Eskişehir Yolu and are the main entrances. A4 and A7 are on the 100. Yıl and Bilkent sides.",
    "venue.directions.campus.title": "On campus",
    "venue.directions.campus.body": "Ring shuttles run inside the campus. METU's own map records the hall as Fizik Bölümü Üçlü Amfi: the Physics Department's triple amphitheatre, which holds U1, U2 and U3. The link below opens it on that map.",
    "venue.directions.map": "METU campus map (PDF)",
    "venue.directions.hallOnMap": "The hall on METU's map",
    "venue.directions.interactiveMap": "Interactive campus map",
    "venue.directions.official": "METU's own transport page",
    "venue.directions.ask": "Anything unclear? Write to us and we will point you to the door.",

    "about.title": "About RSG-Türkiye",
    "about.mission.title": "Our Mission",
    "about.mission.body":
      "ISCB-SC RSG-Türkiye has become a paramount student initiative, organizing events that contribute to the developing computational biology and bioinformatics society in Türkiye. We organize student symposiums attracting undergraduate and graduate students since 2012. Being less formal and more student-focused than HiBiT, our symposiums provide a platform where students can actively participate, present their work, and connect with researchers.",
    "about.history.title": "Previous Editions",

    "sponsors.title": "Our Sponsors",
    "sponsors.subtitle": "We thank our sponsors for their generous support.",
    "sponsors.become": "Become a Sponsor",
    // Sponsors of the edition that is coming, as opposed to the ones who
    // have supported past ones. The site used to show the second under a
    // heading that read like the first.
    "sponsors.current.heading": "Sponsors of the {year} symposium",
    "sponsors.current.none": "Sponsors for the {year} symposium will be announced here.",
    "sponsors.past.heading": "Those who have supported us",
    "sponsors.past.note": "Companies and institutions that sponsored earlier symposiums. The year beside each is the edition it supported.",
    "sponsors.tier.gold": "Gold Sponsors",
    "sponsors.tier.silver": "Silver Sponsors",
    "sponsors.tier.supporter": "Supporters",
    "sponsors.become.body": "Interested in supporting our symposium and connecting with the computational biology community in Türkiye?",
    "sponsors.become.cta": "Get in Touch",
    "home.sponsors.viewAll": "View all sponsors →",

    "footer.tagline": "ISCB-SC RSG-Türkiye Student Symposium",
    "footer.links": "Quick Links",
    "footer.connect": "Connect",
    "footer.copyright": "© {year} ISCB-SC RSG-Türkiye. All rights reserved.",

    "404.title": "Page Not Found",
    "404.body": "The page you are looking for does not exist.",
    "404.home": "Back to Home",

    "committee.title": "Organising Committee",
    "committee.subtitle": "The team behind the symposium.",
    "committee.tba": "The organising committee will be announced soon.",
    // The heading over members who carry no team label. Only ever shown
    // alongside real team headings -- with no teams at all the page has no
    // headings to be the odd one out of.
    "committee.noTeam": "Organising Committee",
  },

  tr: {
    "site.title": "RSG-Türkiye Öğrenci Sempozyumu",
    "site.description":
      "ISCB-SC RSG-Türkiye tarafından düzenlenen hesaplamalı biyoloji ve biyoinformatik alanındaki yıllık öğrenci sempozyumu.",

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

    "hero.tagline": "ISCB-SC RSG-Türkiye Öğrenci Sempozyumu",
    "hero.subtitle":
      "Hesaplamalı biyoloji ve biyoinformatik alanındaki öğrencileri ve araştırmacıları bir araya getiriyoruz.",
    "hero.cta.about": "Daha Fazla",

    "cta.register": "Kayıt Ol",
    "cta.abstract": "Bildiri Gönder",
    "cta.soon": "Kayıt ve bildiri çağrısı yakında açılacak.",
    "cta.closed": "Kayıt ve bildiri gönderimi kapandı.",
    "cta.deadline": "Son tarih: {date}",
    "hero.countdown.days": "gün kaldı",
    "hero.countdown.day": "gün kaldı",

    "home.about.title": "Sempozyum Hakkında",
    "home.about.body":
      "RSG-Türkiye, Uluslararası Hesaplamalı Biyoloji Derneği Öğrenci Konseyi'ne (ISCB-SC) bağlı, öğrenci liderliğinde, kar amacı gütmeyen bir organizasyondur. 2012'den bu yana Türkiye'deki hesaplamalı biyoloji ve biyoinformatik topluluğuna katkıda bulunmak amacıyla lisans ve lisansüstü öğrencileri çeken yıllık öğrenci sempozyumları düzenliyoruz.",

    "home.latest.title": "Son Edisyon",
    "home.sponsors.title": "Sponsorlarımız",

    "speakers.title": "Konuşmacılar",
    "speakers.subtitle": "Sempozyumumuzdaki araştırmacı ve bilim insanlarıyla tanışın.",
    "speakers.filter.all": "Tüm Edisyonlar",
    "speakers.none": "Konuşmacılar yakında duyurulacak.",

    "brand.wordmark": "Öğrenci<br />Sempozyumu",
    "schedule.title": "Program",
    "schedule.subtitle": "Sırasıyla bütün sunumlar, atölyeler ve aralar.",
    "session.type.opening": "Açılış",
    "session.type.keynote": "Davetli Konuşma",
    "session.type.workshop": "Atölye",
    "session.type.panel": "Panel",
    "session.type.talk": "Sunum",
    "session.type.company": "Sanayi",
    "session.type.poster": "Poster",
    "session.type.networking": "Tanışma",
    "session.type.break": "Ara",
    "session.type.closing": "Kapanış",
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
    "venue.contact": "İletişim",
    "venue.photoCaption": "ODTÜ kampüsü.",
    "venue.directions.title": "Nasıl Ulaşılır",
    "venue.directions.metro.title": "Metro ile: en kolayı",
    "venue.directions.metro.body": "M2 hattına (Kızılay–Koru) binip ODTÜ durağında inin. İstasyondan Eskişehir Yolu üzerindeki A1 ana kapısına kısa bir yürüyüş var.",
    "venue.directions.bus.title": "Otobüs ile",
    "venue.directions.bus.body": "Eskişehir Yolu'ndan geçen EGO otobüsleri kampüsün önünde durur: 339-5, 419-5, 511-5, 512-5, 521-5, 530-5, 532-5, 541-5 ve 602-6. Hafta içi çalışan Ayrancı dolmuşu da kampüse A4 kapısından girer.",
    "venue.directions.gates.title": "Kampüs kapıları",
    "venue.directions.gates.body": "A1 ve A2 Eskişehir Yolu'na açılır, ana giriş kapılarıdır. A4 ve A7 ise 100. Yıl ve Bilkent tarafındadır.",
    "venue.directions.campus.title": "Kampüs içinde",
    "venue.directions.campus.body": "Kampüs içinde ring servisleri çalışır. ODTÜ'nün kendi haritası salonu Fizik Bölümü Üçlü Amfi olarak kaydediyor; U1, U2 ve U3 bu binadadır. Aşağıdaki bağlantı doğrudan haritadaki yerine gider.",
    "venue.directions.map": "ODTÜ kampüs haritası (PDF)",
    "venue.directions.hallOnMap": "Salonun ODTÜ haritasındaki yeri",
    "venue.directions.interactiveMap": "Etkileşimli kampüs haritası",
    "venue.directions.official": "ODTÜ'nün kendi ulaşım sayfası",
    "venue.directions.ask": "Aklınıza takılan bir şey mi var? Bize yazın, kapıya kadar tarif edelim.",

    "about.title": "RSG-Türkiye Hakkında",
    "about.mission.title": "Misyonumuz",
    "about.mission.body":
      "ISCB-SC RSG-Türkiye, Türkiye'deki hesaplamalı biyoloji ve biyoinformatik topluluğunun gelişimine katkıda bulunmak amacıyla etkinlikler düzenleyen önemli bir öğrenci inisiyatifi haline gelmiştir. 2012'den bu yana lisans ve lisansüstü öğrencileri çeken öğrenci sempozyumları düzenliyoruz. HiBiT'ten daha az resmi ve daha öğrenci odaklı olan sempozyumlarımız, öğrencilerin aktif olarak katılabileceği, çalışmalarını sunabileceği ve araştırmacılarla bağlantı kurabileceği bir platform sunmaktadır.",
    "about.history.title": "Önceki Edisyonlar",

    "sponsors.title": "Sponsorlarımız",
    "sponsors.subtitle": "Cömert destekleri için sponsorlarımıza teşekkür ederiz.",
    "sponsors.become": "Sponsor Olun",
    "sponsors.current.heading": "{year} sempozyumunun sponsorları",
    "sponsors.current.none": "{year} sempozyumunun sponsorları burada duyurulacak.",
    "sponsors.past.heading": "Bize destek olanlar",
    "sponsors.past.note": "Geçmiş sempozyumlara sponsor olan şirketler ve kurumlar. Yanlarındaki yıl, destek oldukları edisyondur.",
    "sponsors.tier.gold": "Altın Sponsor",
    "sponsors.tier.silver": "Gümüş Sponsor",
    "sponsors.tier.supporter": "Destekçiler",
    "sponsors.become.body": "Sempozyumumuzu desteklemek ve Türkiye'deki hesaplamalı biyoloji topluluğuyla buluşmak ister misiniz?",
    "sponsors.become.cta": "Bizimle İletişime Geçin",
    "home.sponsors.viewAll": "Tüm sponsorları gör →",

    "footer.tagline": "ISCB-SC RSG-Türkiye Öğrenci Sempozyumu",
    "footer.links": "Hızlı Bağlantılar",
    "footer.connect": "Bağlantı",
    "footer.copyright": "© {year} ISCB-SC RSG-Türkiye. Tüm hakları saklıdır.",

    "404.title": "Sayfa Bulunamadı",
    "404.body": "Aradığınız sayfa mevcut değil.",
    "404.home": "Ana Sayfaya Dön",

    "committee.title": "Düzenleme Kurulu",
    "committee.subtitle": "Sempozyumun arkasındaki ekip.",
    "committee.tba": "Düzenleme kurulu yakında duyurulacak.",
    "committee.noTeam": "Düzenleme Kurulu",
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
