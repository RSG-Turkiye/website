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

export type EventType = "symposium" | "workshop" | "hackathon" | "meetup";
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
  /** A photo or poster, served from R2 through /api/images (r2.dev is blocked
   * in Türkiye). `thumb` is about 720px for the card, `full` up to 1600px for
   * a click. Posters use fit "contain" so the card does not crop their text. */
  image?: { thumb: string; full: string; alt: { en: string; tr: string }; fit?: "cover" | "contain" };
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
    meetups: past.filter((e) => e.type === "meetup").sort(byDateDesc),
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
    image: {
      thumb: "/api/images/5b6da566-0ae3-4bc7-aa4c-0c233266d4d4.jpg",
      full: "/api/images/8d0e7b7f-f441-4876-9f22-e586a295c443.jpg",
      alt: { en: "Participants working at the nf-core hackathon local site at Istanbul Kent University, March 2026", tr: "Mart 2026, İstanbul Kent Üniversitesi nf-core hackathon yerel ekibinde çalışan katılımcılar" },
      fit: "cover",
    },
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
    image: {
      thumb: "/api/images/1bfc58ff-1346-44f3-9038-b232f502aa95.jpg",
      full: "/api/images/61399fd8-6916-4186-827b-d7ba4d625dd9.jpg",
      alt: { en: "Organisers and winners at the Dock'n Roll docking hackathon, December 2025", tr: "Aralık 2025, Dock'n Roll docking hackathon'unda düzenleyiciler ve kazananlar" },
      fit: "cover",
    },
  },
  {
    id: "meetup-izmir-2025",
    type: "meetup",
    start: new Date("2025-11-30"),
    title: { en: "İzmir Get-Together", tr: "İzmir Buluşması" },
    when: { en: "30 November 2025", tr: "30 Kasım 2025" },
    location: { en: "Alsancak, İzmir", tr: "Alsancak, İzmir" },
    description: {
      en: "An informal afternoon for people in bioinformatics around İzmir: updates from RSG-Türkiye, research projects, and how to get involved with RSG-Türkiye and the ISCB Student Council.",
      tr: "İzmir'deki biyoinformatikçiler için samimi bir buluşma: RSG-Türkiye'den haberler, araştırma projeleri ve RSG-Türkiye ile ISCB Öğrenci Konseyi'ne nasıl katılınacağı.",
    },
    image: {
      thumb: "/api/images/2fab51a2-9e24-4f5e-aab4-35b3f25d583b.jpg",
      full: "/api/images/eb81e2be-93c3-4a02-9469-f7402dba53ad.jpg",
      alt: { en: "Participants of the İzmir get-together, November 2025", tr: "Kasım 2025, İzmir buluşmasının katılımcıları" },
      fit: "cover",
    },
  },
  {
    id: "meetup-istanbul-2025",
    type: "meetup",
    start: new Date("2025-11-21"),
    title: { en: "Istanbul Get-Together", tr: "İstanbul Buluşması" },
    when: { en: "21 November 2025", tr: "21 Kasım 2025" },
    location: { en: "Üsküdar, Istanbul", tr: "Üsküdar, İstanbul" },
    description: {
      en: "About fifteen people in bioinformatics met to talk about their work, the field's future in academia and industry, and starting out.",
      tr: "Biyoinformatikle uğraşan yaklaşık on beş kişi işlerini, alanın akademideki ve sektördeki geleceğini ve yola nasıl çıkılacağını konuştu.",
    },
    image: {
      thumb: "/api/images/e5098302-099c-4648-9065-3a03268dca0a.jpg",
      full: "/api/images/8250037d-1a9d-4f5a-890d-558454ec671d.jpg",
      alt: { en: "Participants of the Istanbul get-together, November 2025", tr: "Kasım 2025, İstanbul buluşmasının katılımcıları" },
      fit: "cover",
    },
  },
  {
    id: "workshop-hibit-2025",
    type: "workshop",
    start: new Date("2025-10-30"),
    title: { en: "Workshops of the 12th Symposium (HIBIT 2025)", tr: "12. Sempozyum atölyeleri (HIBIT 2025)" },
    when: { en: "30 October 2025", tr: "30 Ekim 2025" },
    location: { en: "Istanbul Medipol University, Istanbul", tr: "İstanbul Medipol Üniversitesi, İstanbul" },
    description: {
      en: "The workshop day of the 12th Student Symposium, held with HIBIT 2025: transcriptome analysis with Selcen Arı Yuka, and variant filtering with GenNext with Özkan Özdemir.",
      tr: "HIBIT 2025 ile birlikte düzenlenen 12. Öğrenci Sempozyumu'nun atölye günü: Selcen Arı Yuka ile transkriptom analizi ve Özkan Özdemir ile GenNext varyant filtreleme.",
    },
    links: [{ label: { en: "Symposium programme", tr: "Sempozyum programı" }, url: "https://symposium.rsg-turkiye.iscbsc.org/editions/2025/" }],
    image: {
      thumb: "/api/images/785142e3-043c-4cad-a816-9b4b8c5bbcf7.jpg",
      full: "/api/images/a52c9977-a8b8-4643-9552-d576da61c932.jpg",
      alt: { en: "Participants at a workshop of the 12th Student Symposium (HIBIT 2025), Istanbul Medipol University", tr: "12. Öğrenci Sempozyumu (HIBIT 2025) atölyesinde katılımcılar, İstanbul Medipol Üniversitesi" },
      fit: "cover",
    },
  },
  {
    id: "meetup-bursa-2025",
    type: "meetup",
    start: new Date("2025-10-18"),
    title: { en: "Bursa Get-Together", tr: "Bursa Buluşması" },
    when: { en: "18 October 2025", tr: "18 Ekim 2025" },
    location: { en: "Nilüfer, Bursa", tr: "Nilüfer, Bursa" },
    description: {
      en: "Eighteen people from universities across Bursa, in conversation circles on structural bioinformatics, AI in healthcare, genomics and systems biology.",
      tr: "Bursa'daki üniversitelerden on sekiz kişi; yapısal biyoinformatik, sağlıkta yapay zekâ, genomik ve sistem biyolojisi üzerine sohbet halkaları.",
    },
    image: {
      thumb: "/api/images/7e6d662e-bd8b-4521-a488-96af599baf67.jpg",
      full: "/api/images/1e1cdb85-ec65-47ba-b9ce-0f28d6e2110d.jpg",
      alt: { en: "Participants of the Bursa get-together, October 2025", tr: "Ekim 2025, Bursa buluşmasının katılımcıları" },
      fit: "cover",
    },
  },
  {
    id: "meetup-boardgame-2025",
    type: "meetup",
    start: new Date("2025-09-20"),
    title: { en: "Board Game Meetup", tr: "Board Game Buluşması" },
    when: { en: "20 September 2025", tr: "20 Eylül 2025" },
    location: { en: "Istanbul", tr: "İstanbul" },
    description: {
      en: "An afternoon of board games, for getting to know the community outside talks and workshops.",
      tr: "Konuşmaların ve atölyelerin dışında topluluğu tanımak için kutu oyunlarıyla bir öğleden sonra.",
    },
    image: {
      thumb: "/api/images/44ff5299-9061-4808-8bb6-237764aec6cf.jpg",
      full: "/api/images/7259b0fd-b27e-4faf-9cae-21c4ae5bb1bb.jpg",
      alt: { en: "Announcement of the board game meetup in Istanbul, 20 September 2025", tr: "20 Eylül 2025 İstanbul board game buluşması duyurusu" },
      fit: "contain",
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
    image: {
      thumb: "/api/images/989469af-59cd-4c07-b8e1-3c019effad4e.jpg",
      full: "/api/images/b9570e40-a9fa-4807-9928-092242b1ad3f.jpg",
      alt: { en: "The team at the nf-core hackathon local site in Istanbul, March 2025", tr: "Mart 2025, İstanbul nf-core hackathon yerel ekibinden ekip" },
      fit: "cover",
    },
  },
  {
    id: "workshop-nextflow-symposium-2024",
    type: "workshop",
    nfcore: true,
    start: new Date("2024-11-15"),
    title: { en: "Nextflow & nf-core Workshop (11th Symposium)", tr: "Nextflow ve nf-core Atölyesi (11. Sempozyum)" },
    when: { en: "15 November 2024", tr: "15 Kasım 2024" },
    location: { en: "Mehmet Akif Ersoy Culture and Art Center, Pendik, Istanbul", tr: "Mehmet Akif Ersoy Kültür Sanat Merkezi, Pendik, İstanbul" },
    description: {
      en: "A hands-on session at the 11th Student Symposium with Dr. Kübra Narcı on building reproducible pipelines with Nextflow and nf-core.",
      tr: "11. Öğrenci Sempozyumu'nda Dr. Kübra Narcı ile Nextflow ve nf-core kullanarak tekrarlanabilir iş akışları kurma üzerine uygulamalı oturum.",
    },
    links: [
      { label: { en: "Recording", tr: "Kayıt" }, url: "https://www.youtube.com/watch?v=rj6gTkhWDj0" },
      { label: { en: "Symposium programme", tr: "Sempozyum programı" }, url: "https://symposium.rsg-turkiye.iscbsc.org/editions/2024/" },
    ],
    image: {
      thumb: "/api/images/afb17645-a73e-4a1c-af5c-ca8f04eb3f54.jpg",
      full: "/api/images/ae500d31-27f0-4169-ad28-200cfbb0535d.jpg",
      alt: { en: "Group photo from the 11th Student Symposium, November 2024", tr: "11. Öğrenci Sempozyumu grup fotoğrafı, Kasım 2024" },
      fit: "cover",
    },
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
    links: [
      { label: { en: "Seurat workshop recording", tr: "Seurat atölyesi kaydı" }, url: "https://www.youtube.com/watch?v=Q3HJGraN7D8" },
      materials("RSG-Single-Cell-Workshop2024"),
    ],
    image: {
      thumb: "/api/images/786c3e87-96d3-43a1-b67b-f48a4aa74fb5.jpg",
      full: "/api/images/a8580b20-a1dd-4162-8a4b-8f282d6317a8.jpg",
      alt: { en: "RSG-Türkiye and COMBINE (RSG Australia) RNA-seq hackathon title graphic", tr: "RSG-Türkiye ve COMBINE (RSG Avustralya) RNA-seq hackathon başlık görseli" },
      fit: "contain",
    },
  },
  {
    id: "workshop-nextflow-2024",
    type: "workshop",
    nfcore: true,
    // 16 March, from the workshop's own title slide and its recording files;
    // an internal report said 3 March.
    start: new Date("2024-03-16"),
    title: {
      en: "Reproducibility in Bioinformatics Analyses: Nextflow and nf-core",
      tr: "Biyoinformatik Analizlerde Tekrarlanabilirlik: Nextflow ve nf-core",
    },
    when: { en: "16 March 2024", tr: "16 Mart 2024" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "A hands-on workshop with Dr. Kübra Narcı on standardising bioinformatics workflows: community best practices, containerised environments with Docker and Singularity, and running pipelines in the cloud.",
      tr: "Dr. Kübra Narcı ile biyoinformatik iş akışlarının standartlaştırılması üzerine uygulamalı atölye: topluluk iyi uygulamaları, Docker ve Singularity ile konteynerli ortamlar ve bulutta iş akışı çalıştırma.",
    },
    links: [
      { label: { en: "Recording", tr: "Kayıt" }, url: "https://www.youtube.com/watch?v=AqNmIkoQrNo" },
      { label: { en: "Seqera blog: Nextflow in Türkiye", tr: "Seqera blogu: Türkiye'de Nextflow" }, url: "https://seqera.io/blog/bioinformatics-growth-in-turkiye/" },
    ],
    image: {
      thumb: "/api/images/e48a9ff4-aacd-4d5d-801a-07ad6e68f5bf.jpg",
      full: "/api/images/0705e4f2-b3da-4e89-be67-d4ec1209101c.jpg",
      alt: { en: "Title slide of the Nextflow and nf-core workshop, 16 March 2024", tr: "Nextflow ve nf-core atölyesinin açılış slaytı, 16 Mart 2024" },
      fit: "contain",
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
      en: "An introduction to computational structural biology: protein structure determination, molecular docking with HADDOCK, SwissDock and PRISM, and molecular dynamics with NAMD.",
      tr: "Hesaplamalı yapısal biyolojiye giriş: protein yapı belirleme, HADDOCK, SwissDock ve PRISM ile moleküler yerleştirme, NAMD ile moleküler dinamik.",
    },
    links: [
      { label: { en: "Recordings (4 parts)", tr: "Kayıtlar (4 bölüm)" }, url: "https://www.youtube.com/watch?v=sy7dOi1tFhQ" },
      materials("Computational_Structural_Biology_Workshop"),
    ],
    image: {
      thumb: "/api/images/8c40868f-2120-426b-9313-ec02b88239d3.jpg",
      full: "/api/images/25b31a68-4983-41f4-b0a5-89e5be53d468.jpg",
      alt: { en: "Introduction to Computational Structural Biology Workshop title card", tr: "Hesaplamalı Yapısal Biyolojiye Giriş Atölyesi başlık görseli" },
      fit: "cover",
    },
  },
  {
    id: "workshop-command-line-2021",
    type: "workshop",
    start: new Date("2021-09-12"),
    end: new Date("2021-09-13"),
    title: { en: "Command Line Tools Workshop (8th Symposium)", tr: "Komut Satırı Araçları Atölyesi (8. Sempozyum)" },
    when: { en: "12 – 13 September 2021", tr: "12 – 13 Eylül 2021" },
    location: { en: "Online", tr: "Çevrimiçi" },
    description: {
      en: "Linux for computational biology: the command line, sed, awk and grep, and git, then practicals on de novo genome assembly and the first steps of RNA-seq analysis.",
      tr: "Hesaplamalı biyoloji için Linux: komut satırı, sed, awk ve grep, git; ardından de novo genom birleştirme ve RNA-seq analizinin ilk adımları üzerine uygulamalar.",
    },
    links: [materials("Workshop2021")],
    image: {
      thumb: "/api/images/66240719-2598-4c41-bd9c-ee344b99d001.jpg",
      full: "/api/images/22fed392-1bb6-4c32-baf6-3808d8acdd81.jpg",
      alt: { en: "Poster of the 8th Student Symposium with the command line tools workshop", tr: "Komut satırı araçları atölyesini içeren 8. Öğrenci Sempozyumu posteri" },
      fit: "contain",
    },
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
    image: {
      thumb: "/api/images/ad5efa55-a5ee-446f-9272-3c6d03497cb7.jpg",
      full: "/api/images/ba16d1e2-c7a3-485e-ae92-2ae0d1245901.jpg",
      alt: { en: "Announcement poster of the Introduction to Single-Cell Analysis workshop, December 2020", tr: "Tek Hücre Analizine Giriş atölyesinin duyuru posteri, Aralık 2020" },
      fit: "contain",
    },
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
    image: {
      thumb: "/api/images/4ba615b6-6222-407a-8843-cea8dcec5875.jpg",
      full: "/api/images/03a6a7b0-29d9-4dd4-93e7-e4b589e918bb.jpg",
      alt: { en: "Poster of the 7th Student Symposium with its workshop sessions", tr: "Atölye oturumlarını içeren 7. Öğrenci Sempozyumu posteri" },
      fit: "contain",
    },
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
    image: {
      thumb: "/api/images/df865145-4598-4282-9068-9bed7c457058.jpg",
      full: "/api/images/cda81d91-f812-4beb-86bd-621536d46507.jpg",
      alt: { en: "The AnkaPy Python workshop classroom at Hacettepe University, November 2019", tr: "Kasım 2019, Hacettepe Üniversitesi AnkaPy Python atölyesi sınıfı" },
      fit: "cover",
    },
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
