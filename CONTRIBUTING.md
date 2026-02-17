# Contributing to RSG Turkey Website

## Adding a New Blog Post

1. Create a new `.md` file in `src/content/blog/`:

```bash
# Use a descriptive filename with kebab-case
touch src/content/blog/my-new-post.md
```

2. Add the required frontmatter at the top of the file:

```yaml
---
title: "Your Post Title"
pubDate: 2025-03-15
description: "A brief description of the post (used in cards and SEO)."
author: "Your Name"
category: "research"
tags:
  - "bioinformatics"
  - "genomics"
image: ""
lang: "en"
draft: false
---

Your markdown content goes here...
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Post title |
| `pubDate` | date | Publication date (YYYY-MM-DD) |
| `description` | string | Short description for cards and SEO |
| `author` | string | Author name |
| `category` | string | Post category (e.g., research, community, events, tutorial) |
| `lang` | "en" or "tr" | Language of the post |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `tags` | string[] | Tags for categorization |
| `image` | string | Featured image URL |
| `draft` | boolean | Set to `true` to hide from listing |

## Adding a New Webinar

1. Create a new `.md` file in `src/content/webinars/YEAR/`:

```bash
mkdir -p src/content/webinars/2025
touch src/content/webinars/2025/webinar-topic.md
```

2. Add the required frontmatter:

```yaml
---
title: "Webinar Title"
date: 2025-04-20
speaker: "Dr. Speaker Name"
speakerAffiliation: "University Name"
description: "Brief description of the webinar topic."
youtubeUrl: "https://youtube.com/watch?v=..."
slidesUrl: ""
lang: "en"
year: 2025
type: "bioinfonet"
---

Optional longer description of the webinar...
```

### Webinar Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Webinar title |
| `date` | date | Webinar date |
| `speaker` | string | Speaker name |
| `description` | string | Topic description |
| `lang` | "en" or "tr" | Language |
| `year` | number | Year of the webinar |
| `type` | "bioinfonet" or "student" | Webinar series type |

## Adding Images

Place images in the `public/images/` directory:

```bash
cp my-image.jpg public/images/
```

Reference them in frontmatter as `/images/my-image.jpg`.

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Workflow

1. Create a new branch: `git checkout -b content/my-new-post`
2. Add your content as described above
3. Test locally with `npm run dev`
4. Commit and push: `git push -u origin content/my-new-post`
5. Open a Pull Request to `main`
6. After review and merge, the site will auto-deploy
