export interface CommitteeMember {
  name: string;
  role: string;
  image: string;
  institution: string;
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
    name: "Executive Committee",
    description: "Leading the organization with vision and strategy.",
    members: [
      {
        name: "Nilay Yönet",
        role: "President",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "president@rsgturkey.com",
        socialMedia: [
          { platform: "twitter", url: "https://twitter.com/example" },
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [Name]",
        role: "Vice-President",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "vicepresident@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [Name]",
        role: "Secretary",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "secretary@rsgturkey.com",
      },
    ],
  },
  {
    name: "Webinar Committee",
    description: "Organizing our Bioinfonet webinar series and educational events.",
    members: [
      {
        name: "Dr. [Name]",
        role: "Chair",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "webinars@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [Name]",
        role: "Member",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "webinars@rsgturkey.com",
      },
    ],
  },
  {
    name: "Events Committee",
    description: "Planning symposiums, workshops, and networking events.",
    members: [
      {
        name: "Dr. [Name]",
        role: "Chair",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "events@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [Name]",
        role: "Member",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "events@rsgturkey.com",
      },
    ],
  },
  {
    name: "Community Relations Committee",
    description: "Managing community engagement and international connections.",
    members: [
      {
        name: "Dr. [Name]",
        role: "Chair",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "community@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [Name]",
        role: "Member",
        image: "/logo/rsgturkey_logo.png",
        institution: "University",
        email: "community@rsgturkey.com",
      },
    ],
  },
];

// Turkish Committees Data
export const committeesTr: Committee[] = [
  {
    name: "Yürütme Komitesi",
    description: "Organizasyonu vizyon ve strateji ile yönetmek.",
    members: [
      {
        name: "Dr. [İsim]",
        role: "Başkan",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "president@rsgturkey.com",
        socialMedia: [
          { platform: "twitter", url: "https://twitter.com/example" },
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [İsim]",
        role: "Başkan Yardımcısı",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "vicepresident@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [İsim]",
        role: "Sekreter",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "secretary@rsgturkey.com",
      },
    ],
  },
  {
    name: "Webinar Komitesi",
    description: "Bioinfonet webinar serimizi ve eğitim etkinliklerimizi organize etmek.",
    members: [
      {
        name: "Dr. [İsim]",
        role: "Başkan",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "webinars@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [İsim]",
        role: "Üye",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "webinars@rsgturkey.com",
      },
    ],
  },
  {
    name: "Etkinlik Komitesi",
    description: "Sempozyumlar, atölye çalışmaları ve ağ oluşturma etkinlikleri planlamak.",
    members: [
      {
        name: "Dr. [İsim]",
        role: "Başkan",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "events@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [İsim]",
        role: "Üye",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "events@rsgturkey.com",
      },
    ],
  },
  {
    name: "Topluluk İlişkileri Komitesi",
    description: "Topluluk katılımını ve uluslararası bağlantıları yönetmek.",
    members: [
      {
        name: "Dr. [İsim]",
        role: "Başkan",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "community@rsgturkey.com",
        socialMedia: [
          { platform: "linkedin", url: "https://linkedin.com/in/example" },
        ],
      },
      {
        name: "Dr. [İsim]",
        role: "Üye",
        image: "/logo/rsgturkey_logo.png",
        institution: "Üniversite",
        email: "community@rsgturkey.com",
      },
    ],
  },
];

// Helper function to get committees by language
export function getCommittees(lang: 'en' | 'tr'): Committee[] {
  return lang === 'tr' ? committeesTr : committeesEn;
}
