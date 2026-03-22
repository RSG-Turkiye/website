# RSG Turkey Website

Official website of [RSG Turkey](https://rsgturkey.com) — the ISCB Regional Student Group for computational biology and bioinformatics in Turkey.

Built with [Astro](https://astro.build) and [Tailwind CSS v4](https://tailwindcss.com). Deployed automatically via Netlify on every push to `main`.

| | |
|---|---|
| **Production** | [rsgturkey.com](https://rsgturkey.com) |
| **Preview / Debug** | [rsg-turkiye-website.netlify.app](https://rsg-turkiye-website.netlify.app) |

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Astro 5](https://astro.build) | Static site generator |
| [Tailwind CSS v4](https://tailwindcss.com) | Styling |
| [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) | Blog posts and webinars as Markdown files |
| [Netlify](https://netlify.com) | Hosting and CI/CD |

---

## Project Structure

```
/
├── public/                  Static assets (images, flags, logo)
├── src/
│   ├── components/          Reusable Astro components
│   ├── content/
│   │   ├── blog/
│   │   │   ├── en/          English blog posts
│   │   │   └── tr/          Turkish blog posts
│   │   └── webinars/
│   │       ├── en/          English webinar pages
│   │       └── tr/          Turkish webinar pages
│   ├── data/                Static data (committees, announcements)
│   ├── i18n/                Translation strings (ui.ts)
│   ├── layouts/             Page layouts (BaseLayout.astro)
│   ├── pages/               English routes
│   │   ├── blog/[slug].astro
│   │   ├── webinars/[slug].astro
│   │   └── tr/              Turkish routes (mirrors pages/)
│   └── styles/              Global CSS
├── astro.config.mjs
├── content.config.ts        Content collection schemas
└── package.json
```

---

## Local Development

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Start dev server at http://localhost:4321
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## How the Site Works

### Bilingual Content (EN / TR)

The site supports English and Turkish. Language is determined by **directory**, not frontmatter:

- `src/content/blog/en/my-post.md` → `/blog/my-post`
- `src/content/blog/tr/my-post.md` → `/tr/blog/my-post`

UI strings (navigation, buttons, labels) are translated in `src/i18n/ui.ts`.

### Automatic Translation Links

If an English article and a Turkish article share the **same filename**, the site automatically shows a "Read in Turkish / Read in English" button on each article page, and the language switcher navigates between them directly.

Example:
```
blog/en/crispr-genome-editing.md   ←→   blog/tr/crispr-genome-editing.md
```

### Deployment

Pushing to `main` triggers an automatic Netlify build and deploy. No manual steps needed.

---

## Content Types

### Blog Posts (`src/content/blog/`)

General articles — tutorials, member spotlights, event recaps, research summaries.

**Schema** (frontmatter fields):

```yaml
title: "Your Post Title"
pubDate: 2025-01-15
description: "One or two sentence summary shown in listings."
author: "Your Name"
category: general          # or: tutorial, research, event, etc.
tags: [bioinformatics, python]
image: ""                  # Thumbnail shown in the blog listing. If empty, the first image in the post body is used automatically.
draft: false               # set true to hide from listings
```

### Webinars (`src/content/webinars/`)

Structured webinar pages with speaker info, YouTube embed, slides, and key takeaways.

**Schema** (frontmatter fields):

```yaml
title: "Webinar Title"
date: 2025-03-10
speaker: "Dr. Jane Smith"
speakerTitle: "Assistant Professor"
speakerAffiliation: "MIT"
description: "Brief summary of the talk."
youtubeUrl: "https://youtu.be/xxxx"
slidesUrl: ""              # optional
image: ""                  # speaker photo URL (optional)
topic: "Structural Biology" # shown as a badge
keyTakeaways:
  - "First key point"
  - "Second key point"
year: 2025
type: bioinfonet           # or: student
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full guide on writing blog posts, translating content, and adding webinars.

---

## CI / GitHub Actions

Two workflows run automatically on every pull request:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **Build Check** | All PRs to `main` | Runs `astro check` (type checking) then `npm run build`. The PR cannot be merged if either fails. |
| **Translation Check** | PRs that touch `src/content/` | Detects newly added content files that don't have a matching translation in the other language, and posts a reminder comment. Not a blocker — just a nudge for the Translation Committee. |
