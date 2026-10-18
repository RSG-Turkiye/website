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

export type EventType = "symposium" | "workshop" | "hackathon";
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
  /** Public pages that show the event or what came out of it: the nf-core
   * local-site page, a merged pull request, the materials repository. */
  links?: { label: { en: string; tr: string }; url: string }[];
  /** Part of RSG-Türkiye's nf-core / Nextflow work, which /workshops groups. */
  nfcore?: boolean;
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
 * The sections the page renders: what is still ahead, then the symposiums
 * that have happened, then the hackathons and the workshops.
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
    hackathons: past.filter((e) => e.type === "hackathon").sort(byDateDesc),
  };
}

/** A link to a workshop's public materials in the RSG-Turkiye GitHub organisation. */
function materials(repo: string): { label: { en: string; tr: string }; url: string } {
  return { label: { en: "Workshop materials", tr: "Atölye materyalleri" }, url: `https://github.com/RSG-Turkiye/${repo}` };
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
    // Two days since the organisers added a workshop on the second; kept in
    // step with symposium_website/src/content/editions/2026.md by hand.
    end: new Date("2026-10-11"),
    title: { en: "13th RSG-Türkiye Student Symposium", tr: "13. RSG-Türkiye Öğrenci Sempozyumu" },
    when: { en: "10–11 October 2026", tr: "10–11 Ekim 2026" },
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
    id: "hackathon-nfcore-2026",
    type: "hackathon",
    nfcore: true,
    start: new Date("2026-03-11"),
    end: new Date("2026-03-13"),
    title: { en: "nf-core Hackathon: Istanbul local site", tr: "nf-core Hackathon: İstanbul yerel ekibi" },
    when: { en: "11 – 13 March 2026", tr: "11 – 13 Mart 2026" },
    location: { en: "Istanbul Kent University, Istanbul", tr: "İstanbul Kent Üniversitesi, İstanbul" },
    description: {
      en: "Our second official local site of the global nf-core hackathon. A beginner project reviewed the Turkish translation of the Hello Nextflow and Hello nf-core training; an advanced one worked on nf-core/scdownstream, adding scDblFinder doublet detection as a module.",
      tr: "Küresel nf-core hackathon'unun ikinci resmi yerel ekibimiz. Başlangıç projesi Hello Nextflow ve Hello nf-core eğitimlerinin Türkçe çevirisini gözden geçirdi; ileri proje nf-core/scdownstream üzerinde çalışıp scDblFinder çift hücre tespitini modül olarak ekledi.",
    },
    links: [
      { label: { en: "nf-co.re event page", tr: "nf-co.re etkinlik sayfası" }, url: "https://nf-co.re/events/2026/hackathon-march-2026/istanbul" },
      { label: { en: "scDblFinder module (merged)", tr: "scDblFinder modülü (birleştirildi)" }, url: "https://github.com/nf-core/scdownstream/pull/261" },
      { label: { en: "Nextflow training in Turkish", tr: "Türkçe Nextflow eğitimi" }, url: "https://training.nextflow.io/latest/tr/" },
    ],
  },
  {
    id: "hackathon-docking-2025",
    type: "hackathon",
    start: new Date("2025-12-18"),
    end: new Date("2025-12-19"),
    title: { en: "Dock'n Roll: Molecular Docking Hackathon", tr: "Dock'n Roll: Moleküler Yerleştirme Hackathon'u" },
    when: { en: "18 – 19 December 2025", tr: "18 – 19 Aralık 2025" },
    location: { en: "Yıldız Technical University, Istanbul", tr: "Yıldız Teknik Üniversitesi, İstanbul" },
    description: {
      en: "A two-day molecular docking hackathon run with the YTÜ BİYOGEN student club.",
      tr: "YTÜ BİYOGEN öğrenci kulübüyle düzenlenen iki günlük moleküler yerleştirme hackathon'u.",
    },
  },
  {
    id: "hackathon-nfcore-2025",
    type: "hackathon",
    nfcore: true,
    start: new Date("2025-03-24"),
    end: new Date("2025-03-26"),
    title: { en: "nf-core Hackathon: RSG-Türkiye local site", tr: "nf-core Hackathon: RSG-Türkiye yerel ekibi" },
    when: { en: "24 – 26 March 2025", tr: "24 – 26 Mart 2025" },
    location: { en: "Istanbul Kent University, Istanbul", tr: "İstanbul Kent Üniversitesi, İstanbul" },
    description: {
      en: "Our first official local site of the global nf-core hackathon, with two days of Nextflow training on site. The team led a project to improve nf-core/scdownstream: doublet detection with scDblFinder, cell-type annotation beyond human data, and documentation.",
      tr: "Küresel nf-core hackathon'unun ilk resmi yerel ekibimiz; yerinde iki günlük Nextflow eğitimiyle. Ekip nf-core/scdownstream'i geliştirme projesini yürüttü: scDblFinder ile çift hücre tespiti, insan dışı türler için hücre tipi atama ve dokümantasyon.",
    },
    links: [
      { label: { en: "nf-co.re event page", tr: "nf-co.re etkinlik sayfası" }, url: "https://nf-co.re/events/2025/hackathon-march-2025/rsg-turkiye" },
    ],
  },
  {
    id: "workshop-nextflow-symposium-2024",
    type: "workshop",
    nfcore: true,
    start: new Date("2024-11-15"),
    end: new Date("2024-11-16"),
    title: { en: "Nextflow & nf-core Workshop (11th Symposium)", tr: "Nextflow ve nf-core Atölyesi (11. Sempozyum)" },
    when: { en: "15 – 16 November 2024", tr: "15 – 16 Kasım 2024" },
    location: { en: "Istanbul", tr: "İstanbul" },
    description: {
      en: "A hands-on session at the 11th Student Symposium with Dr. Kübra Narcı on building reproducible pipelines with Nextflow and nf-core.",
      tr: "11. Öğrenci Sempozyumu'nda Dr. Kübra Narcı ile Nextflow ve nf-core kullanarak tekrarlanabilir iş akışları kurma üzerine uygulamalı oturum.",
    },
    links: [{ label: { en: "Symposium programme", tr: "Sempozyum programı" }, url: "https://symposium.rsg-turkiye.iscbsc.org/editions/2024/" }],
  },
  {
    id: "hackathon-combine-2024",
    type: "hackathon",
    start: new Date("2024-09-23"),
    end: new Date("2024-09-25"),
    title: { en: "Single-cell RNA-seq Hackathon with RSG-Australia (COMBINE)", tr: "RSG-Avustralya (COMBINE) ile Tek Hücre RNA-seq Hackathon'u" },
    when: { en: "23 – 25 September 2024", tr: "23 – 25 Eylül 2024" },
    location: { en: "Hybrid and online", tr: "Hibrit ve çevrimiçi" },
    description: {
      en: "A joint event with RSG-Australia (COMBINE): a Seurat workshop day, an online hackathon day, and a joint presentation and awards session.",
      tr: "RSG-Avustralya (COMBINE) ile ortak etkinlik: bir Seurat atölyesi günü, bir çevrimiçi hackathon günü ve ortak sunum ve ödül oturumu.",
    },
    links: [materials("RSG-Single-Cell-Workshop2024")],
  },
  {
    id: "workshop-nextflow-2024",
    type: "workshop",
    nfcore: true,
    start: new Date("2024-03-03"),
    title: {
      en: "Reproducibility in Bioinformatics Analyses: Nextflow and nf-core",
      tr: "Biyoinformatik Analizlerde Tekrarlanabilirlik: Nextflow ve nf-core",
    },
    when: { en: "3 March 2024", tr: "3 Mart 2024" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "A hands-on workshop with Dr. Kübra Narcı on standardising bioinformatics workflows: community best practices, containerised environments with Docker and Singularity, and running pipelines in the cloud.",
      tr: "Dr. Kübra Narcı ile biyoinformatik iş akışlarının standartlaştırılması üzerine uygulamalı atölye: topluluk iyi uygulamaları, Docker ve Singularity ile konteynerli ortamlar ve bulutta iş akışı çalıştırma.",
    },
  },
  {
    id: "workshop-structural-biology-2021",
    type: "workshop",
    start: new Date("2021-12-18"),
    end: new Date("2021-12-19"),
    title: { en: "Structural Biology Workshop", tr: "Yapısal Biyoloji Atölyesi" },
    when: { en: "18 – 19 December 2021", tr: "18 – 19 Aralık 2021" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "An introduction to computational structural biology: protein structure determination, molecular docking with HADDOCK, SWISS-MODEL and PRISM, and molecular dynamics with NAMD.",
      tr: "Hesaplamalı yapısal biyolojiye giriş: protein yapı belirleme, HADDOCK, SWISS-MODEL ve PRISM ile moleküler yerleştirme, NAMD ile moleküler dinamik.",
    },
    links: [materials("Computational_Structural_Biology_Workshop")],
  },
  {
    id: "workshop-command-line-2021",
    type: "workshop",
    start: new Date("2021-09-12"),
    title: { en: "Command Line Tools Workshop (8th Symposium)", tr: "Komut Satırı Araçları Atölyesi (8. Sempozyum)" },
    when: { en: "September 2021", tr: "Eylül 2021" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "Linux for computational biology: the command line, sed, awk and grep, and git, then practicals on long-read genome assembly and the first steps of RNA-seq analysis.",
      tr: "Hesaplamalı biyoloji için Linux: komut satırı, sed, awk ve grep, git; ardından uzun okumalarla genom birleştirme ve RNA-seq analizinin ilk adımları üzerine uygulamalar.",
    },
    links: [materials("Workshop2021")],
  },
  {
    id: "workshop-single-cell-2020",
    type: "workshop",
    start: new Date("2020-12-19"),
    end: new Date("2020-12-20"),
    title: { en: "Introduction to Single-Cell Analysis", tr: "Tek Hücre Analizine Giriş" },
    when: { en: "19 – 20 December 2020", tr: "19 – 20 Aralık 2020" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "Two days on single-cell sequencing: the theory of scRNA-seq, processing the data, and analysis with Seurat, then single-cell ATAC-seq.",
      tr: "Tek hücre dizileme üzerine iki gün: scRNA-seq'in kuramı, verinin işlenmesi ve Seurat ile analiz, ardından tek hücre ATAC-seq.",
    },
    links: [materials("Single-Cell-Workshop2020")],
  },
  {
    id: "workshop-symposium-2020",
    type: "workshop",
    start: new Date("2020-10-24"),
    end: new Date("2020-10-25"),
    title: { en: "R, Machine Learning and ggplot2 (7th Symposium workshops)", tr: "R, Makine Öğrenmesi ve ggplot2 (7. Sempozyum atölyeleri)" },
    when: { en: "24 – 25 October 2020", tr: "24 – 25 Ekim 2020" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "The workshop sessions of the 7th Student Symposium: an introduction to R programming, machine learning in R, and data visualisation with ggplot2.",
      tr: "7. Öğrenci Sempozyumu'nun atölye oturumları: R programlamaya giriş, R ile makine öğrenmesi ve ggplot2 ile veri görselleştirme.",
    },
    links: [materials("Workshop2020")],
  },
  {
    id: "workshop-ankapy-2019",
    type: "workshop",
    start: new Date("2019-11-25"),
    end: new Date("2019-11-29"),
    title: { en: "AnkaPy: Python for Bioinformatics", tr: "AnkaPy: Biyoinformatik için Python" },
    when: { en: "25 – 29 November 2019", tr: "25 – 29 Kasım 2019" },
    location: { en: "Hacettepe University, Ankara", tr: "Hacettepe Üniversitesi, Ankara" },
    description: {
      en: "A five-day Python workshop with Hacettepe University, the University of Ostrava and SOVA: programming basics, Biopython for FASTA, BLAST and Entrez, and numpy, pandas and matplotlib for data analysis.",
      tr: "Hacettepe Üniversitesi, Ostrava Üniversitesi ve SOVA ile beş günlük Python atölyesi: programlama temelleri, FASTA, BLAST ve Entrez için Biopython, veri analizi için numpy, pandas ve matplotlib.",
    },
    links: [materials("AnkaPy")],
  },
];

/**
 * The year RSG-Türkiye was founded, per the "Glorious History of RSG Turkey"
 * slide its founders showed at the 2017 and 2018 symposiums: "Founded by
 * Billur Engin, Nurcan Tunçbağ and Emre Güney, 2011". The first student
 * symposium followed in 2012, which is a different and also true number --
 * "since 2012" elsewhere on the site refers to the symposiums, not the group.
 */
export const FOUNDED_YEAR = 2011;

/** Whole years since founding, for the counter on the homepage. It read a
 * hard-coded "10+" for years; the group turned ten in 2021. */
export function yearsSinceFounding(now: Date): number {
  return now.getFullYear() - FOUNDED_YEAR;
}
