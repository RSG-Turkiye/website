export interface CommitteeMember {
  name: string;
  role: string;
  image: string;
  education?: {
    degree: string;
    field: string;
    institution: string;
    year?: string;
  }[];
  email?: string;
  socialMedia?: {
    platform: 'twitter' | 'linkedin' | 'facebook' | 'github' | 'instagram';
    url: string;
  }[];
}

export interface Committee {
  name: string;
  description: string;
  members: CommitteeMember[];
}

// English Committees Data
export const committeesEn: Committee[] = [
  {
    name: "Chair",
    description: "Leading the organization with vision and strategy.",
    members: [
      {
        name: "Emre Taha Çevik",
        role: "President",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199905/rsgturkey/committee/emre-taha-cevik.png",
        education: [
          {
            degree: 'MSc',
            field: 'Bioinformatics and Systems Biology',
            institution: 'Gebze Technical University',
          },
        ],
        email: "e.cev2000@proton.me",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/emrecev/" },
        ],
      },
      {
        name: "Gizem Beyza Anık",
        role: "Vice President",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199906/rsgturkey/committee/gizem-beyza-anik.jpg",
        education: [
          {
            degree: 'Graduated',
            field: 'Biology',
            institution: 'Marmara University',
          },
        ],
        email: "gizemmbeyza@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/gizem-beyza-a-2859b2226/" },
        ],
      },
      {
        name: "Sude Karaoğlan",
        role: "Secretary",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199910/rsgturkey/committee/sude-karaoglan.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Bioengineering',
            institution: 'Gebze Technical University',
          },
        ],
        email: "sudekaraoglan13@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/sudekaraoglan/" },
        ],
      },
    ],
  },
  {
    name: "Webinar Committee",
    description: "Organizing our webinar series and educational events.",
    members: [
      {
        name: "Ezgi Gokce",
        role: "Webinar Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199910/rsgturkey/committee/ezgi-gokce.jpg",
      },
    ],
  },
  {
    name: "Outreach Committee",
    description: "Managing community engagement and international connections.",
    members: [
      {
        name: "Mariam Aseyakhe",
        role: "Outreach Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199912/rsgturkey/committee/mariam-aseyakhe.jpg",
      },
    ],
  },
  {
    name: "Social Media Committee",
    description: "Managing social media accounts and community engagement.",
    members: [
      {
        name: "Zeynep Ateşgil",
        role: "Social Media Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199947/rsgturkey/committee/zeynep-atesegil.jpg",
      },
    ],
  },
  {
    name: "Sponsorship Committee",
    description: "Managing sponsorships and partnerships.",
    members: [
      {
        name: "Gökçe Koçak",
        role: "Sponsorship Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199950/rsgturkey/committee/gokce-kocak.jpg",
      
      },
    ],
  },
  {
    name: "Translation Committee",
    description: "Managing multilingual content and translations.",
    members: [
      {
        name: "Kurayi Chawatama",
        role: "Translation Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199953/rsgturkey/committee/kurayi-chawatama.png",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Molecular Biology and Genetics',
            institution: 'Bursa Uludağ University',
          },
        ],
        email: "kurichawaz@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/kurayi-chawatama/" },
        ],
      },
    ],
  },
  {
    name: "Website Committee",
    description: "Managing website development and maintenance.",
    members: [
      {
        name: "Hilal Kınalı",
        role: "Website Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199962/rsgturkey/committee/hilal-kinali.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Molecular Biology and Genetics',
            institution: 'Acıbadem University',
          },
        ],
        email: "hilalkinali08@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/hilal-k%C4%B1nal%C4%B1-558260330/" },
        ],
      },
    ],
  },
  {
    name: "Graphic Design Committee",
    description: "Managing visual design and graphics.",
    members: [
      {
        name: "Ayşe Akkan",
        role: "Graphic Design Leader",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199964/rsgturkey/committee/ayse-akkan.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Molecular Biology and Genetics',
            institution: 'Izmir Institute of Technology',
          },
        ],
        email: "ayseakkan3424@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/ayseakkann/" },
        ],
      },
    ],
  },
];

// Turkish Committees Data
export const committeesTr: Committee[] = [
  {
    name: "Yönetim Kurulu",
    description: "Organizasyonu vizyon ve strateji ile yönetmek.",
    members: [
      {
        name: "Emre Taha Çevik",
        role: "Başkan",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199905/rsgturkey/committee/emre-taha-cevik.png",
        education: [
          {
            degree: 'Yüksek Lisans',
            field: 'Bioinformatik ve Sistem Biyolojisi',
            institution: 'Gebze Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/emrecev/" },
        ],
      },
      {
        name: "Gizem Beyza Anık",
        role: "Başkan Yardımcısı",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199906/rsgturkey/committee/gizem-beyza-anik.jpg",
        education: [
          {
            degree: 'Mezun',
            field: 'Biyoloji',
            institution: 'Marmara Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/gizem-beyza-a-2859b2226/" },
        ],
      },
      {
        name: "Sude Karaoğlan",
        role: "Sekreter",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199910/rsgturkey/committee/sude-karaoglan.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Biyomühendislik',
            institution: 'Gebze Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/sudekaraoglan/" },
        ],
      },
    ],
  },
  {
    name: "Webinar Komitesi",
    description: "Webinar serimizi ve eğitim etkinliklerimizi organize etmek.",
    members: [
      {
        name: "Ezgi Gokce",
        role: "Webinar Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199910/rsgturkey/committee/ezgi-gokce.jpg",
      },
    ],
  },
  {
    name: "Topluluk İlişkileri Komitesi",
    description: "Topluluk katılımını ve uluslararası bağlantıları yönetmek.",
    members: [
      {
        name: "Mariam Aseyakhe",
        role: "Topluluk İlişkileri Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199912/rsgturkey/committee/mariam-aseyakhe.jpg",
      },
    ],
  },
  {
    name: "Sosyal Medya Komitesi",
    description: "Sosyal medya hesaplarını ve topluluk katılımını yönetmek.",
    members: [
      {
        name: "Zeynep Ateşgil",
        role: "Sosyal Medya Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199947/rsgturkey/committee/zeynep-atesegil.jpg",
      },
    ],
  },
  {
    name: "Sponsorluk Komitesi",
    description: "Sponsorlukları ve ortaklıkları yönetmek.",
    members: [
      {
        name: "Gökçe Koçak",
        role: "Sponsorluk Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199950/rsgturkey/committee/gokce-kocak.jpg",
      },
    ],
  },
  {
    name: "Çeviri Komitesi",
    description: "Çok dilli içerik ve çevirileri yönetmek.",
    members: [
      {
        name: "Kurayi Chawatama",
        role: "Çeviri Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199953/rsgturkey/committee/kurayi-chawatama.png",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'Bursa Uludağ Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/kurayi-chawatama/" },
        ],
      },
    ],
  },
  {
    name: "Web Sitesi Komitesi",
    description: "Web sitesi geliştirme ve bakımını yönetmek.",
    members: [
      {
        name: "Hilal Kınalı",
        role: "Web Sitesi Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199962/rsgturkey/committee/hilal-kinali.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'Acıbadem Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/hilal-k%C4%B1nal%C4%B1-558260330/" },
        ],
      },
    ],
  },
  {
    name: "Grafik Tasarım Komitesi",
    description: "Görsel tasarım ve grafikleri yönetmek.",
    members: [
      {
        name: "Ayşe Akkan",
        role: "Grafik Tasarım Ekibi Lideri",
        image: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774199964/rsgturkey/committee/ayse-akkan.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'İzmir Yüksek Teknoloji Enstitüsü',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/ayseakkann/" },
        ],
      },
    ],
  },
];

// Helper function to get committees by language
export function getCommittees(lang: 'en' | 'tr'): Committee[] {
  return lang === 'tr' ? committeesTr : committeesEn;
}
