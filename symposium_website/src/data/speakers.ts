export interface Speaker {
  slug: string;
  name: string;
  position: string;
  company: string;
  bio: string;
  photo: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
  /** Which edition year(s) this speaker appeared in */
  editions: number[];
}

export const speakers: Speaker[] = [
  // ── 2024 Edition ──────────────────────────────────────────────
  {
    slug: "mehmet-baysan",
    name: "Dr. Mehmet Baysan",
    position: "Faculty Member, Computer Engineering",
    company: "Istanbul Technical University / BaysanLab",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606595/rsgturkey/symposium/2023/08/Mehmet_Baysan-4-scaled.jpg",
    linkedin: "https://www.linkedin.com/in/mehmet-baysan-1825165/",
    editions: [2024],
    bio: `After obtaining his B.S. from Bilkent University in Computer Science in 2003, Dr. Baysan completed his M.S. and Ph.D. degrees in Computer Science at The University of Texas at Dallas in 2005 and 2008, respectively. In 2010, Dr. Baysan shifted his research focus to computational biology as a post-doctoral fellow at the Neuro-Oncology Branch of the National Cancer Institute (NCI) of the NIH, USA.

Following his fellowship, he worked at the NYU Cancer Institute and later at Weill Cornell Medical College as an Associate Research Scientist. He is currently a faculty member in the Computer Engineering Department at Istanbul Technical University. Since 2010, his research has centered on advancing our understanding of disease genomics using computational tools, including COSAP (Comparative NGS Data Analysis Platform) and the Turkey Genome Project.`,
  },
  {
    slug: "prof-dr-gokhan-kacar",
    name: "Prof. Dr. Gökhan Kaçar",
    position: "Associate Professor, Genetic and Bioengineering",
    company: "Trakya University",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606586/rsgturkey/symposium/2024/10/Gokhan-Hoca-e1729216327966.png",
    linkedin: "https://www.linkedin.com/in/gokhan-kacar-a3154617/",
    editions: [2024],
    bio: `Prof. Dr. Gökhan Kaçar graduated from the Chemical Engineering Department of Boğaziçi University in 2006. He completed his master's degree at Sabancı University's Materials Science and Engineering program in 2009 and pursued his Ph.D. at the Eindhoven University of Technology in the Netherlands between 2009 and 2014.

After completing postdoctoral studies at the same institution, he has been a faculty member in the Department of Genetic and Bioengineering at Trakya University since 2015. His research interests include biocompatible polymers, hydrogels, nanoscale drug carrier systems, and molecular-level modeling and simulations of liposomal systems. Dr. Kaçar has 22 internationally indexed publications and 4 TUBITAK projects under his leadership.`,
  },
  {
    slug: "kubra-narci",
    name: "Dr. Kübra Narcı",
    position: "Bioinformatician & Workflows Engineer",
    company: "GHGA (German Human Genome-Phenome Archive)",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606585/rsgturkey/symposium/2024/10/Kubra-Narci.png",
    linkedin: "https://www.linkedin.com/in/kubranarci/",
    editions: [2024],
    bio: `Dr. Kübra Narcı holds an M.Sc. and Ph.D. in Bioinformatics from Middle East Technical University in Ankara. She worked as a Bioinformatic Analyst for Seven Bridges Genomics from 2017 to 2022 and has been working as a Bioinformatician and Bioinformatic Workflows Engineer for GHGA since May 2022. She has been a Nextflow Ambassador since December 2023.`,
  },
  {
    slug: "prof-dr-handan-ankarali",
    name: "Prof. Dr. Handan Ankaralı",
    position: "Professor, Biostatistics and Medical Informatics",
    company: "Istanbul Medeniyet University",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606628/rsgturkey/symposium/2024/10/H.Ankarali.jpg",
    linkedin: "https://www.linkedin.com/in/handan-ankaral%C4%B1-3961349a/",
    editions: [2024],
    bio: `After completing her master's degree in Biometry and Genetics at Ankara University in 1995, she earned a Ph.D. in the same field in 2000. She achieved the title of Assistant Professor in 2001, Associate Professor in 2006, and Professor in 2011.

Currently, she serves as a faculty member at Istanbul Medeniyet University, Faculty of Medicine, in the Department of Biostatistics and Medical Informatics. She has authored over 500 scientific articles and five books. Her main areas of expertise include Biostatistics, Informatics, Data Science, Data Mining, and Population Genetics.`,
  },
  {
    slug: "assoc-prof-dr-abdulkadir-kocak",
    name: "Assoc. Prof. Dr. Abdülkadir Koçak",
    position: "Associate Professor",
    company: "",
    photo: "",
    linkedin: "https://www.linkedin.com/in/abdulkadir-kocak-a6aa611aa/",
    editions: [2024],
    bio: "",
  },

  // ── 2023 Edition ──────────────────────────────────────────────
  {
    slug: "dr-ramazan-terzi",
    name: "Dr. Ramazan Terzi",
    position: "Associate Professor, Computer Engineering",
    company: "Erciyes University",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606572/rsgturkey/symposium/2023/06/ramazan_terzi.jpg",
    editions: [2023],
    bio: `Dr. Ramazan Terzi completed his undergraduate and master's degree studies in Computer Engineering at Erciyes University. He holds a PhD degree in Computer Engineering from Gazi University. He is currently working as an Associate Professor in the Computer Engineering Department at Erciyes University. His research interests focus on data mining, machine learning, and big data analytics in biomedical applications.`,
  },
  {
    slug: "prof-dr-tolga-cukur",
    name: "Prof. Dr. Tolga Çukur",
    position: "Professor, Electrical and Electronics Engineering",
    company: "Bilkent University",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606579/rsgturkey/symposium/2023/08/tolgacukur.jpg",
    editions: [2023],
    bio: `After receiving his bachelor's degree from Bilkent University in 2003 and his PhD from Stanford University in 2009, he continued his postdoctoral studies at the University of California, Berkeley. He is currently a Professor in the Electrical and Electronics Engineering Department at Bilkent University. His research focuses on computational imaging and machine learning in the context of MRI and neuroscience.`,
  },
  {
    slug: "prof-dr-kaan-orhan",
    name: "Prof. Dr. Kaan Orhan",
    position: "Professor, Dentomaxillofacial Radiology",
    company: "Ankara University",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606579/rsgturkey/symposium/2023/08/kaan_orhan.jpg",
    editions: [2023],
    bio: "",
  },
  {
    slug: "dr-burcak-otlu",
    name: "Dr. Burçak Otlu",
    position: "Postdoctoral Researcher",
    company: "UC San Diego",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606579/rsgturkey/symposium/2023/08/BurcakOtlu_UCSD_PostDoc_Photo_Small.jpg",
    editions: [2023],
    bio: "",
  },
  {
    slug: "dr-ahmet-gorkem-er",
    name: "Dr. Ahmet Gökçen Er",
    position: "Researcher",
    company: "",
    photo:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606578/rsgturkey/symposium/2023/08/ahmet-er_profilephoto.jpg",
    editions: [2023],
    bio: "",
  },
];

export function getSpeakersByEdition(year: number): Speaker[] {
  return speakers.filter((s) => s.editions.includes(year));
}

export function getSpeakerBySlug(slug: string): Speaker | undefined {
  return speakers.find((s) => s.slug === slug);
}
