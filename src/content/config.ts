import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string().default(''),
    author: z.string().default(''),
    category: z.string().default('general'),
    tags: z.array(z.string()).default([]),
    image: z.string().default(''),
    lang: z.enum(['en', 'tr']),
    draft: z.boolean().default(false),
  }),
});

const webinars = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    speaker: z.string().default(''),
    speakerAffiliation: z.string().default(''),
    speakerTitle: z.string().default(''),
    description: z.string().default(''),
    youtubeUrl: z.string().default(''),
    slidesUrl: z.string().default(''),
    year: z.number(),
    type: z.string().default(''),
    image: z.string().default(''),
    topic: z.string().default(''),
    keyTakeaways: z.array(z.string()).default([]),
  }),
});

const lpDomains = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    emoji: z.string(),
    tagline: z.string(),
    order: z.number(),
    goDeeper: z.array(z.object({
      title: z.string(),
      description: z.string(),
      url: z.string(),
    })).default([]),
  }),
});

const lpLevels = defineCollection({
  type: 'content',
  schema: z.object({
    domain: z.string(),
    level: z.enum(['explorer', 'practitioner', 'researcher', 'specialist']),
    orientation: z.string(),
    prerequisites: z.array(z.string()).default([]),
    sections: z.array(z.object({
      type: z.string(),
      resources: z.array(z.object({
        title: z.string(),
        description: z.string(),
        tag: z.string(),
        url: z.string(),
      })),
    })).default([]),
  }),
});

const lpRoadmap = defineCollection({
  type: 'content',
  schema: z.object({
    number: z.number(),
    emoji: z.string(),
    title: z.string(),
    subtitle: z.string(),
    color: z.string(),
    resources: z.array(z.object({
      title: z.string(),
      description: z.string(),
      tag: z.string(),
      url: z.string(),
    })).default([]),
  }),
});

export const collections = {
  blog,
  webinars,
  'lp-domains': lpDomains,
  'lp-levels': lpLevels,
  'lp-roadmap': lpRoadmap,
};
