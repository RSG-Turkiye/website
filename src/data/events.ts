/**
 * The events the /events page lists, in one place and with real dates.
 *
 * There used to be two copies of this list -- one inside `pages/events.astro`
 * and a translated one inside `pages/tr/events.astro` -- and each event
 * carried a literal `status: "upcoming" | "completed"`. A hand-written status
 * cannot expire, so in September 2026 the page was still advertising "Annual
 * Symposium 2025 - TBD 2025" as upcoming, with a Register button, alongside a
 * symposium list that stopped at 2024.
 *
 * So: one list, both languages side by side in each entry, and a status
 * derived from the date. An event whose last day has passed is completed, and
 * nothing has to be remembered on the day it happens.
 */

export type EventType = "symposium" | "workshop";
export type EventStatus = "upcoming" | "completed";

export interface CommunityEvent {
  id: string;
  type: EventType;
  /** First day. Used only for ordering and for the status. */
  start: Date;
  /** Last day, when the event runs longer than one. Defaults to `start`. */
  end?: Date;
  title: { en: string; tr: string };
  /** The date as a reader should see it. `start`/`end` drive the logic; this
   * drives the page, so "3 – 4 October 2023" does not have to be derived. */
  when: { en: string; tr: string };
  location: { en: string; tr: string };
  description: { en: string; tr: string };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an event is still ahead of us.
 *
 * Midnight after the last day, not the first moment of it: an event should not
 * flip to "completed" while people are still in the room. Same rule as the
 * symposium site's `endOfEvent`.
 *
 * `now` is required rather than defaulted so a caller has to decide, instead
 * of inheriting a wrong answer from a default argument.
 */
export function statusOf(event: CommunityEvent, now: Date): EventStatus {
  const last = event.end ?? event.start;
  return last.getTime() + ONE_DAY_MS > now.getTime() ? "upcoming" : "completed";
}

/** Newest first, which is the order a reader expects an archive in. */
function byDateDesc(a: CommunityEvent, b: CommunityEvent) {
  return b.start.getTime() - a.start.getTime();
}

/**
 * The three sections the page renders: what is still ahead, then the
 * symposiums that have happened, then the workshops.
 *
 * `upcoming` is returned even when empty so the caller decides whether to
 * render a heading over nothing -- it should not, and does not.
 */
export function groupEvents(all: CommunityEvent[], now: Date) {
  const upcoming = all.filter((e) => statusOf(e, now) === "upcoming");
  const past = all.filter((e) => statusOf(e, now) === "completed");
  return {
    upcoming: [...upcoming].sort((a, b) => a.start.getTime() - b.start.getTime()),
    symposiums: past.filter((e) => e.type === "symposium").sort(byDateDesc),
    workshops: past.filter((e) => e.type === "workshop").sort(byDateDesc),
  };
}

/**
 * Symposiums are listed for the last few years only; the full archive, back to
 * the first in Cappadocia in 2012, lives on the symposium site, which the page
 * links to. Workshops are the ones the organisation's own records document.
 */
export const events: CommunityEvent[] = [
  {
    id: "symposium-2026",
    type: "symposium",
    start: new Date("2026-10-10"),
    title: { en: "13th RSG-Türkiye Student Symposium", tr: "13. RSG-Türkiye Öğrenci Sempozyumu" },
    when: { en: "10 October 2026", tr: "10 Ekim 2026" },
    location: { en: "Ankara", tr: "Ankara" },
    description: {
      en: "Our annual symposium, bringing together students and researchers in computational biology and bioinformatics across Türkiye.",
      tr: "Türkiye'de hesaplamalı biyoloji ve biyoinformatik alanındaki öğrenci ve araştırmacıları bir araya getiren yıllık sempozyumumuz.",
    },
  },
  {
    id: "symposium-2025",
    type: "symposium",
    start: new Date("2025-10-30"),
    end: new Date("2025-11-02"),
    title: { en: "12th RSG-Türkiye Student Symposium", tr: "12. RSG-Türkiye Öğrenci Sempozyumu" },
    when: { en: "30 October – 2 November 2025", tr: "30 Ekim – 2 Kasım 2025" },
    location: { en: "Istanbul Medipol University", tr: "İstanbul Medipol Üniversitesi" },
    description: {
      en: "Held in collaboration with HIBIT 2025: workshops on 30 October and the symposium programme on 2 November.",
      tr: "HIBIT 2025 ile birlikte düzenlendi: 30 Ekim'de çalıştaylar, 2 Kasım'da sempozyum programı.",
    },
  },
  {
    id: "symposium-2024",
    type: "symposium",
    start: new Date("2024-11-15"),
    end: new Date("2024-11-16"),
    title: { en: "11th RSG-Türkiye Student Symposium", tr: "11. RSG-Türkiye Öğrenci Sempozyumu" },
    when: { en: "15 – 16 November 2024", tr: "15 – 16 Kasım 2024" },
    location: { en: "Mehmet Akif Ersoy Art Center, Pendik, Istanbul", tr: "Mehmet Akif Ersoy Sanat Merkezi, Pendik, İstanbul" },
    description: {
      en: "The first symposium the RSG-Türkiye team organised entirely on its own, rather than as a satellite meeting to HIBIT.",
      tr: "RSG-Türkiye ekibinin HIBIT'in uydu etkinliği olarak değil, tümüyle kendi başına düzenlediği ilk sempozyum.",
    },
  },
  {
    id: "symposium-2023",
    type: "symposium",
    start: new Date("2023-10-03"),
    end: new Date("2023-10-04"),
    title: { en: "10th RSG-Türkiye Student Symposium", tr: "10. RSG-Türkiye Öğrenci Sempozyumu" },
    when: { en: "3 – 4 October 2023", tr: "3 – 4 Ekim 2023" },
    location: { en: "METU Informatics Institute, Ankara", tr: "ODTÜ Enformatik Enstitüsü, Ankara" },
    description: {
      en: "A decade of annual symposiums, with keynotes on AI in medicine and computational imaging, and a panel on bioinformatics in Turkish clinical practice.",
      tr: "Yıllık sempozyumların onuncu yılı; tıpta yapay zekâ ve hesaplamalı görüntüleme üzerine açılış konuşmaları ve Türkiye'de klinik biyoinformatik üzerine bir panel.",
    },
  },
  {
    id: "workshop-nextflow-2024",
    type: "workshop",
    start: new Date("2024-03-03"),
    title: {
      en: "Reproducibility in Bioinformatics Analyses: Nextflow and nf-core",
      tr: "Biyoinformatik Analizlerde Tekrarlanabilirlik: Nextflow ve nf-core",
    },
    when: { en: "3 March 2024", tr: "3 Mart 2024" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "A hands-on workshop with Dr. Kübra Narcı on standardising bioinformatics workflows — community best practices, containerised environments with Docker and Singularity, and running pipelines in the cloud.",
      tr: "Dr. Kübra Narcı ile biyoinformatik iş akışlarının standartlaştırılması üzerine uygulamalı atölye — topluluk iyi uygulamaları, Docker ve Singularity ile konteynerli ortamlar ve bulutta iş akışı çalıştırma.",
    },
  },
  {
    id: "workshop-structural-biology-2021",
    type: "workshop",
    start: new Date("2021-12-01"),
    title: { en: "Structural Biology Workshop", tr: "Yapısal Biyoloji Atölyesi" },
    when: { en: "December 2021", tr: "Aralık 2021" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "An introduction to computational structural biology: protein structure determination, molecular docking with HADDOCK, SWISS-MODEL and PRISM, and molecular dynamics with NAMD.",
      tr: "Hesaplamalı yapısal biyolojiye giriş: protein yapı belirleme, HADDOCK, SWISS-MODEL ve PRISM ile moleküler yerleştirme, NAMD ile moleküler dinamik.",
    },
  },
  {
    id: "workshop-single-cell-2020",
    type: "workshop",
    start: new Date("2020-01-01"),
    title: { en: "Single-Cell Workshop", tr: "Tek Hücre Atölyesi" },
    when: { en: "2020", tr: "2020" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "A hands-on workshop on single-cell analysis techniques and methodologies.",
      tr: "Tek hücre analiz teknikleri ve yöntemleri üzerine uygulamalı atölye.",
    },
  },
];
