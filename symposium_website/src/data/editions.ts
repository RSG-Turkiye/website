export interface Edition {
  year: number;
  title: string;
  subtitle: string;
  date: string;
  venue: string;
  venueCity: string;
  description: string;
  posterImage: string;
  galleryImages: string[];
  isLatest?: boolean;
}

export const editions: Edition[] = [
  {
    year: 2024,
    title: "11th RSG-Türkiye Student Symposium",
    subtitle: "Computational Biology & Bioinformatics",
    date: "October 2024",
    venue: "Mehmet Akif Ersoy Art Center, Pendik",
    venueCity: "Istanbul",
    description:
      "The 11th edition brought together undergraduate and graduate students with leading researchers in clinical bioinformatics, nanoscale drug delivery, and NGS workflows. Highlights included a panel on clinical bioinformatics startups and a hands-on Nextflow workshop.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606569/rsgturkey/symposium/2024/11/Mavi-ve-Sari-Modern-Yabanci-Dil-Egitim-Kursu-Instagram-Gonderisi.png",
    galleryImages: [
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606634/rsgturkey/symposium/2024/11/IMG-20241115-WA0037.jpg",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606626/rsgturkey/symposium/2024/10/WhatsApp-Image-2024-10-16-at-01.12.02.jpeg",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606627/rsgturkey/symposium/2024/10/WhatsApp-Image-2024-10-17-at-15.03.43.jpeg",
    ],
    isLatest: true,
  },
  {
    year: 2023,
    title: "10th RSG-Türkiye Student Symposium",
    subtitle: "Data Mining, Imaging & Bioinformatics",
    date: "2023",
    venue: "METU Informatics Institute",
    venueCity: "Ankara",
    description:
      "The 10th edition featured keynotes on big data in bioinformatics, computational imaging, and dental informatics, along with student talks and poster sessions.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606591/rsgturkey/symposium/2023/08/symposium2023.jpg",
    galleryImages: [],
  },
  {
    year: 2022,
    title: "9th RSG-Türkiye Student Symposium",
    subtitle: "",
    date: "2022",
    venue: "",
    venueCity: "Türkiye",
    description:
      "The 9th edition of the RSG-Türkiye Student Symposium continued the tradition of bringing together students and researchers in computational biology and bioinformatics.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606569/rsgturkey/symposium/2023/08/2022.png",
    galleryImages: [],
  },
  {
    year: 2021,
    title: "8th RSG-Türkiye Student Symposium",
    subtitle: "",
    date: "2021",
    venue: "Online (Virtual Conference)",
    venueCity: "Online",
    description:
      "The 8th edition was held online due to the pandemic, demonstrating RSG-Türkiye's commitment to maintaining the scientific community during challenging times.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606569/rsgturkey/symposium/2023/08/2021-Symposium-poster.png",
    galleryImages: [
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606569/rsgturkey/symposium/2023/08/2021-Symposium-outline.png",
    ],
  },
  {
    year: 2020,
    title: "7th RSG-Türkiye Student Symposium",
    subtitle: "",
    date: "2020",
    venue: "Online (Virtual Conference)",
    venueCity: "Online",
    description:
      "The first virtual edition of the symposium, adapted for the global pandemic, successfully connected students and researchers across Türkiye.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606566/rsgturkey/symposium/2023/08/2020.png",
    galleryImages: [],
  },
  {
    year: 2019,
    title: "6th RSG-Türkiye Student Symposium",
    subtitle: "",
    date: "August 2019",
    venue: "HiBiT Satellite Meeting",
    venueCity: "Türkiye",
    description:
      "The 6th edition as a satellite to HiBiT (International Symposium on Health Informatics and Bioinformatics) gathered students and researchers for talks, posters, and networking.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606566/rsgturkey/symposium/2019/08/SS2019_Sponsorlu_G%C3%BCncel.png",
    galleryImages: [
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606561/rsgturkey/symposium/2019/08/2019_galery1.png",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606562/rsgturkey/symposium/2019/08/2019_galery2.png",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606562/rsgturkey/symposium/2019/08/2019_galery3.png",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606562/rsgturkey/symposium/2019/08/2019_galery4.png",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606562/rsgturkey/symposium/2019/08/2019_galery5.png",
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606562/rsgturkey/symposium/2019/08/2019_galery6.png",
    ],
  },
  {
    year: 2018,
    title: "5th RSG-Türkiye Student Symposium",
    subtitle: "",
    date: "2018",
    venue: "",
    venueCity: "Türkiye",
    description:
      "Continuing the annual tradition of fostering computational biology education among Turkish students.",
    posterImage:
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606565/rsgturkey/symposium/2023/08/2018-scaled.jpg",
    galleryImages: [
      "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606565/rsgturkey/symposium/2019/08/2018.jpg",
    ],
  },
];

export const latestEdition = editions.find((e) => e.isLatest) ?? editions[0];
