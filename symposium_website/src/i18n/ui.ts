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

    "hero.tagline": "ISCB SC RSG-Türkiye Student Symposium",
    "hero.subtitle":
      "Bringing together students and researchers in computational biology and bioinformatics.",
    "hero.cta.about": "Learn More",
    "hero.cta.register": "Register",

    "home.about.title": "About the Symposium",
    "home.about.body":
      "RSG-Türkiye is a student-led, non-profit organization affiliated with the International Society for Computational Biology Student Council (ISCB SC). Since 2012, we have been organizing annual student symposiums that attract undergraduate and graduate students and foster interdisciplinary collaboration in computational biology and bioinformatics across Türkiye.",

    "home.latest.title": "Latest Edition",
    "home.sponsors.title": "Our Sponsors",

    "speakers.title": "Speakers",
    "speakers.subtitle": "Meet the researchers and scientists at our symposium.",
    "speakers.filter.all": "All Editions",

    "schedule.title": "Program",
    "schedule.subtitle": "2024 Symposium Schedule",

    "venue.title": "Venue",
    "venue.subtitle": "Where to find us",
    "venue.location": "Location",
    "venue.date": "Date",

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

    "hero.tagline": "ISCB SC RSG-Türkiye Öğrenci Sempozyumu",
    "hero.subtitle":
      "Hesaplamalı biyoloji ve biyoinformatik alanındaki öğrencileri ve araştırmacıları bir araya getiriyoruz.",
    "hero.cta.about": "Daha Fazla",
    "hero.cta.register": "Kayıt Ol",

    "home.about.title": "Sempozyum Hakkında",
    "home.about.body":
      "RSG-Türkiye, Uluslararası Hesaplamalı Biyoloji Derneği Öğrenci Konseyi'ne (ISCB SC) bağlı, öğrenci liderliğinde, kar amacı gütmeyen bir organizasyondur. 2012'den bu yana Türkiye'deki hesaplamalı biyoloji ve biyoinformatik topluluğuna katkıda bulunmak amacıyla lisans ve lisansüstü öğrencileri çeken yıllık öğrenci sempozyumları düzenliyoruz.",

    "home.latest.title": "Son Edisyon",
    "home.sponsors.title": "Sponsorlarımız",

    "speakers.title": "Konuşmacılar",
    "speakers.subtitle": "Sempozyumumuzdaki araştırmacı ve bilim insanlarıyla tanışın.",
    "speakers.filter.all": "Tüm Edisyonlar",

    "schedule.title": "Program",
    "schedule.subtitle": "2024 Sempozyum Programı",

    "venue.title": "Mekan",
    "venue.subtitle": "Nerede bulabilirsiniz",
    "venue.location": "Konum",
    "venue.date": "Tarih",

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
