# RSG Turkey Website

Official website of [RSG Turkey](https://rsgturkey.com) — the ISCB Regional Student Group for computational biology and bioinformatics in Turkey.

Built with [Astro](https://astro.build) and [Tailwind CSS v4](https://tailwindcss.com). Deployed automatically via Cloudflare Pages on every push.

| | |
|---|---|
| **Production** | [rsgturkey.com](https://rsgturkey.com) |
| **Stable (Cloudflare)** | [website-dkh.pages.dev](https://website-dkh.pages.dev) |
| **Dev branch** | [website-dev-vi6.pages.dev](https://website-dev-vi6.pages.dev) |
| **Symposium** | [symposium-website.pages.dev](https://symposium-website.pages.dev) |

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Astro 5](https://astro.build) | Static site generator |
| [Tailwind CSS v4](https://tailwindcss.com) | Styling |
| [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) | Blog posts and webinars as Markdown files |
| [Cloudflare Pages](https://pages.cloudflare.com) | Hosting and CI/CD |

---

## Project Structure

```
/
├── public/                  Static assets (images, flags, logo)
├── src/
│   ├── components/
│   │   ├── learning-paths/  ResourceCard, ProgressBar, LevelSwitcher, DomainCard
│   │   └── …                Other reusable components
│   ├── content/
│   │   ├── blog/
│   │   │   ├── en/          English blog posts
│   │   │   └── tr/          Turkish blog posts
│   │   ├── webinars/
│   │   │   ├── en/          English webinar pages
│   │   │   └── tr/          Turkish webinar pages
│   │   ├── lp-domains/      Learning path domain metadata (one file per domain)
│   │   ├── lp-levels/       Learning path content (one file per domain × level)
│   │   └── lp-roadmap/      Beginner roadmap stages (one file per stage)
│   ├── data/                Static data (committees, announcements)
│   ├── i18n/                Translation strings (ui.ts)
│   ├── layouts/             Page layouts (BaseLayout.astro)
│   ├── pages/
│   │   ├── blog/[slug].astro
│   │   ├── webinars/[slug].astro
│   │   ├── learning-paths/
│   │   │   ├── index.astro         Learning paths hub
│   │   │   ├── roadmap.astro       Sequential beginner path
│   │   │   └── [domain].astro      Dynamic domain pages
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

Pushing to `main` triggers an automatic Cloudflare Pages build and deploy. No manual steps needed.

> **Before going live with a new domain:** Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) and add the new domain's callback URL to the OAuth client's **Authorized redirect URIs**:
> ```
> https://rsg-turkiye.iscbsc.org/auth/callback
> ```
> Without this, Google login will fail with a `redirect_uri_mismatch` error. Remove any stale dev preview URLs (e.g. `website-dev-vi6.pages.dev`) from the same list.

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

### Learning Paths (`src/content/lp-domains/`, `lp-levels/`, `lp-roadmap/`)

Curated resource paths organised by domain and experience level. All content is Markdown — no code changes needed to add or update resources.

**Domains:** genomics, ml, structural, metagenomics (more can be added by creating a new `lp-domains/` file)

**Levels:** explorer → practitioner → researcher → specialist

**Routes:**
- `/learning-paths/` — index with two entry axes (sequential roadmap + domain grid)
- `/learning-paths/roadmap` — beginner path (8 stages, data from `lp-roadmap/`)
- `/learning-paths/[domain]` — domain pages with per-level tab switcher

See [CONTRIBUTING.md § Managing Learning Paths](CONTRIBUTING.md#6-managing-learning-paths) for the full member workflow.

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
