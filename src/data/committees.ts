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
        name: "Nilay Yönet",
        role: "President",
        image: "/public/images/committee-members/nilayyonet.jpeg",
        education: [
          {
            degree: 'PhD Candidate',
            field: 'Bioengineering',
            institution: 'Yildiz Technical University',
          },
        ],
        email: "nilayyonet@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "http://linkedin.com/in/nilay-yonet%20" },
        ],
      },
      {
        name: "Ayşe Akkan",
        role: "Vice-President",
        image: "/public/images/committee-members/ayseakkan.jpg",
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
      {
        name: "Emre Taha Çevik",
        role: "Secretary",
        image: "/public/images/committee-members/emrecevik.png",
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
    ],
  },
  {
    name: "Webinar Committee",
    description: "Organizing our webinar series and educational events.",
    members: [
      {
        name: "Rümeysa Büşra Özgüney",
        role: "Webinar Leader",
        image: "/public/images/committee-members/rumeysabusra.jpg",
        education: [
          {
            degree: 'PhD Candidate',
            field: 'Bioinformatics',
            institution: 'A&M Texas University',
          },
        ],
        email: "rbusraozguney@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/busraozguney/" },
        ],
      },
      {
        name: "Deniz Yılmaz",
        role: "Webinar Co-Leader",
        image: "/public/images/committee-members/denizyilmaz.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Bioinformatics',
            institution: 'Middle East Technical University',
          },
        ],
        email: "dnzylmz35@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/deniz-yilmaz-0000000000/" },
        ],
      },
    ],
  },
  {
    name: "Symposium Committee",
    description: "Planning symposiums, workshops, and networking events.",
    members: [
      {
        name: "Maşallah Akiba",
        role: "Symposium Leader",
        image: "/public/images/committee-members/masallahakiba.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Molecular Biology and Genetics',
            institution: 'Acıbadem University',
          },
        ],
        email: "akibamasallah@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/ma%C5%9Fallah-akiba-4588262b9/" },
        ],
      },
    ],
  },
  {
    name: "Journal Club Committee",
    description: "Managing journal club activities and discussions.",
    members: [
      {
        name: "Fatma Tosun",
        role: "Journal Club Leader",
        image: "/public/images/committee-members/fatmatosun.jpeg",
        education: [
          {
            degree: 'MSc',
            field: 'Bioengineering',
            institution: 'Yildiz Technical University',
          },
        ],
        email: "fatmatosun987@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/fatma-tosun-022766143/" },
        ],
      },
    ],
  },
  {
    name: "Memberships Committee",
    description: "Managing memberships and community engagement.",
    members: [
      {
        name: "Gülce Çelen",
        role: "Membership Leader",
        image: "/public/images/committee-members/gulcecelen.png",
        education: [
          {
            degree: 'MSc',
            field: 'Bioengineering',
            institution: 'Yildiz Technical University',
          },
        ],
        email: "celen.rsgturkey.eb906@simplelogin.fr",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/gulce-celen/" },
        ],
      },
    ],
  },
  {
    name: "Outreach Committee",
    description: "Managing community engagement and international connections.",
    members: [
      {
        name: "Kurayi Chawatama",
        role: "Outreach Leader",
        image: "/public/images/committee-members/kurayichawatama.png",
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
        name: "Sude Karaoğlan",
        role: "Website Leader",
        image: "/public/images/committee-members/sudekaraoglan.jpg",
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
    name: "Sponsorship Committee",
    description: "Managing sponsorships and partnerships.",
    members: [
      {
        name: "Gizem Beyza Anık",
        role: "Sponsorship Leader",
        image: "/public/images/committee-members/gizembeyza.jpg",
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
    ],
  },
  {
    name: "Social Media Committee",
    description: "Managing social media accounts and community engagement.",
    members: [
      {
        name: "Vuslat Berfin Sakızcı",
        role: "Social Media Leader",
        image: "/public/images/committee-members/vuslatberfin.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Molecular Biology and Genetics',
            institution: 'Bursa Uludağ University',
          },
        ],
        email: "vuslatberfinn@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/vuslatberfin/" },
        ],
      },
    ],
  },
  {
    name: "Translation Committee",
    description: "Managing multilingual content and translations.",
    members: [
      {
        name: "Kübra Kubat",
        role: "Translation Leader",
        image: "/public/images/committee-members/kubrakubat.jpeg",
        education: [
          {
            degree: 'BSc',
            field: 'Molecular Biology and Genetics',
            institution: 'Balıkesir University',
          },
        ],
        email: "kubatkbra1@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "http://linkedin.com/in/kubra-kubat-5751a4210" },
        ],
      },
    ],
  },
  {
    name: "Graphic Design Committee",
    description: "Managing visual design and graphics.",
    members: [
      {
        name: "Ege ALTUN",
        role: "Graphic Design Leader",
        image: "/public/images/committee-members/egealtun.jpg",
        education: [
          {
            degree: 'Undergraduate',
            field: 'Bioengineering',
            institution: 'Ege University',
          },
        ],
        email: "eegealtunx@gmail.com",
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/egealtun/" },
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
        name: "Nilay Yönet",
        role: "Başkan",
        image: "/public/images/committee-members/nilayyonet.jpeg",
        education: [
          {
            degree: 'Doktora Adayı',
            field: 'Biyomühendislik',
            institution: 'Yıldız Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "http://linkedin.com/in/nilay-yonet%20" },
        ],
      },
      {
        name: "Ayşe Akkan",
        role: "Başkan Yardımcısı",
        image: "/public/images/committee-members/ayseakkan.jpg",
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
      {
        name: "Emre Taha Çevik",
        role: "Sekreter",
        image: "/public/images/committee-members/emrecevik.png",
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
    ],
  },
  {
    name: "Webinar Komitesi",
    description: "Webinar serimizi ve eğitim etkinliklerimizi organize etmek.",
    members: [
      {
        name: "Rümeysa Büşra Özgüney",
        role: "Webinar Ekibi Lideri",
        image: "/public/images/committee-members/rumeysabusra.jpg",
        education: [
          {
            degree: 'Doktora Adayı',
            field: 'Biyoinformatik',
            institution: 'A&M Texas Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/busraozguney/" },
        ],
      },
      {
        name: "Deniz Yılmaz",
        role: "Webinar Ekibi Co-Lideri",
        image: "/public/images/committee-members/denizyilmaz.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Biyoinformatik',
            institution: 'Orta Doğu Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/deniz-yilmaz-0000000000/" },
        ],
      },
    ],
  },
  {
    name: "Sempozyum Komitesi",
    description: "Sempozyumlar, atölye çalışmaları ve ağ oluşturma etkinlikleri planlamak.",
    members: [
      {
        name: "Maşallah Akiba",
        role: "Sempozyum Ekibi Lideri",
        image: "/public/images/committee-members/masallahakiba.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'Acıbadem Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/ma%C5%9Fallah-akiba-4588262b9/" },
        ],
      },
    ],
  },
  {
    name: "Dergi Kulübü Komitesi",
    description: "Dergi kulübü aktivitelerini ve tartışmalarını yönetmek.",
    members: [
      {
        name: "Fatma Tosun",
        role: "Dergi Kulübü Ekibi Lideri",
        image: "/public/images/committee-members/fatmatosun.jpeg",
        education: [
          {
            degree: 'Yüksek Lisans',
            field: 'Biyomühendislik',
            institution: 'Yıldız Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/fatma-tosun-022766143/" },
        ],
      },
    ],
  },
  {
    name: "Üyelik Komitesi",
    description: "Üyelikleri ve topluluk katılımını yönetmek.",
    members: [
      {
        name: "Gülce Çelen",
        role: "Üyelik Ekibi Lideri",
        image: "/public/images/committee-members/gulcecelen.png",
        education: [
          {
            degree: 'Yüksek Lisans',
            field: 'Biyomühendislik',
            institution: 'Yıldız Teknik Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/gulce-celen/" },
        ],
      },
    ],
  },
  {
    name: "Topluluk İlişkileri Komitesi",
    description: "Topluluk katılımını ve uluslararası bağlantıları yönetmek.",
    members: [
      {
        name: "Kurayi Chawatama",
        role: "Topluluk İlişkileri Ekibi Lideri",
        image: "/public/images/committee-members/kurayichawatama.png",
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
        name: "Sude Karaoğlan",
        role: "Web Sitesi Ekibi Lideri",
        image: "/public/images/committee-members/sudekaraoglan.jpg",
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
    name: "Sponsorluk Komitesi",
    description: "Sponsorlukları ve ortaklıkları yönetmek.",
    members: [
      {
        name: "Gizem Beyza Anık",
        role: "Sponsorluk Ekibi Lideri",
        image: "/public/images/committee-members/gizembeyza.jpg",
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
    ],
  },
  {
    name: "Sosyal Medya Komitesi",
    description: "Sosyal medya hesaplarını ve topluluk katılımını yönetmek.",
    members: [
      {
        name: "Vuslat Berfin Sakızcı",
        role: "Sosyal Medya Ekibi Lideri",
        image: "/public/images/committee-members/vuslatberfin.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'Bursa Uludağ Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/vuslatberfin/" },
        ],
      },
    ],
  },
  {
    name: "Çeviri Komitesi",
    description: "Çok dilli içerik ve çevirileri yönetmek.",
    members: [
      {
        name: "Kübra Kubat",
        role: "Çeviri Ekibi Lideri",
        image: "/public/images/committee-members/kubrakubat.jpeg",
        education: [
          {
            degree: 'Lisans',
            field: 'Moleküler Biyoloji ve Genetik',
            institution: 'Balıkesir Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "http://linkedin.com/in/kubra-kubat-5751a4210" },
        ],
      },
    ],
  },
  {
    name: "Grafik Tasarım Komitesi",
    description: "Görsel tasarım ve grafikleri yönetmek.",
    members: [
      {
        name: "Ege ALTUN",
        role: "Grafik Tasarım Ekibi Lideri",
        image: "/public/images/committee-members/egealtun.jpg",
        education: [
          {
            degree: 'Lisans',
            field: 'Biyomühendislik',
            institution: 'Ege Üniversitesi',
          },
        ],
        socialMedia: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/egealtun/" },
        ],
      },
    ],
  },
];

// Helper function to get committees by language
export function getCommittees(lang: 'en' | 'tr'): Committee[] {
  return lang === 'tr' ? committeesTr : committeesEn;
}
