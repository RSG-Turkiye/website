# Contributing to the RSG Turkey Website

This guide is for members of the **website committee** and **translation committee**. It covers everything you need to add blog posts, translate articles, and publish webinar pages — no coding experience required beyond basic Markdown and Git.

---

## Table of Contents

1. [Setup](#1-setup)
2. [Writing a Blog Post](#2-writing-a-blog-post)
3. [Translating an Article](#3-translating-an-article)
4. [Adding a Webinar Page](#4-adding-a-webinar-page)
5. [Translating a Webinar Page](#5-translating-a-webinar-page)
6. [Submitting Your Work](#6-submitting-your-work)
7. [File Naming Rules](#7-file-naming-rules)
8. [Frontmatter Reference](#8-frontmatter-reference)
9. [Markdown Tips](#9-markdown-tips)

---

## 1. Setup

You need Git and Node.js installed. Clone the repo and install dependencies:

```bash
git clone https://github.com/RSG-Turkiye/website.git
cd website
npm install
npm run dev          # visit http://localhost:4321 to preview
```

Always create a new branch before making changes:

```bash
git checkout -b add-my-blog-post
```

---

## 2. Writing a Blog Post

Blog posts live in `src/content/blog/en/` (English) or `src/content/blog/tr/` (Turkish).

### Step 1 — Create the file

Pick a short, descriptive filename in lowercase with hyphens. This becomes the URL slug.

```
src/content/blog/en/crispr-in-cancer-research.md
```

The article will be available at `/blog/crispr-in-cancer-research`.

### Step 2 — Add frontmatter

Every file must start with a frontmatter block between `---` lines:

```yaml
---
title: "CRISPR in Cancer Research: A Beginner's Guide"
pubDate: 2025-06-01
description: "A plain-language introduction to how CRISPR is being applied in oncology research."
author: "Your Name"
category: tutorial
tags: [crispr, genomics, cancer]
image: ""      # optional: URL to use as the listing thumbnail
draft: false
---
```

### Step 3 — Write your article

Below the closing `---`, write your article in Markdown:

```markdown
## Introduction

CRISPR-Cas9 has transformed how researchers ...

## How It Works

...
```

### Step 4 — Set `draft: true` while working

If you want to commit a work-in-progress without it appearing on the live site, set `draft: true`. Change it to `false` when ready to publish.

### Tips

- Keep `description` to 1–2 sentences. It appears in search results and listing cards.
- `category` is free text — use something descriptive like `tutorial`, `research`, `event`, `community`.
- `tags` are used for tag pages. Use existing tags when possible to group related content.
- Images in the article body can be external URLs or files placed in `public/images/`.
- The `image` field sets the thumbnail shown on the blog listing page. If you leave it empty, the site automatically picks the first image found in your post body. Set it explicitly if you want a specific image as the thumbnail (e.g. a Cloudinary URL).

---

## 3. Translating an Article

The translation committee translates English articles into Turkish (and vice versa).

### How it works

If a Turkish file has the **exact same filename** as an English file, the site links them automatically — a "Türkçe oku / Read in English" button appears on each article, and the language switcher navigates directly between them.

### Step 1 — Find the article to translate

Browse `src/content/blog/en/` for untranslated articles. An article needs translation if there is no file with the same name in `src/content/blog/tr/`.

### Step 2 — Create the translation file

Copy the English file into the `tr/` directory **keeping the same filename**:

```bash
cp src/content/blog/en/crispr-in-cancer-research.md \
   src/content/blog/tr/crispr-in-cancer-research.md
```

### Step 3 — Translate the content

Open the new `tr/` file and translate:

- **Translate** the `title`, `description`, and body text
- **Keep** `pubDate`, `author`, `category`, `tags`, and `image` the same as the original
- **Do not change** the filename

Example:

```yaml
---
title: "Kanser Araştırmalarında CRISPR: Başlangıç Rehberi"
pubDate: 2025-06-01
description: "CRISPR'in onkoloji araştırmalarında nasıl kullanıldığına dair sade bir giriş."
author: "Your Name"
category: tutorial
tags: [crispr, genomics, cancer]
image: ""
draft: false
---

## Giriş

CRISPR-Cas9, araştırmacıların ...
```

### Step 4 — Preview and submit

Run `npm run dev` and visit `/tr/blog/crispr-in-cancer-research` to verify the translation looks correct, then [submit your work](#6-submitting-your-work).

---

## 4. Adding a Webinar Page

Webinar pages are richer than blog posts — they include a YouTube embed, speaker card, slides link, and key takeaways.

Webinar files live in:
- `src/content/webinars/en/` — English
- `src/content/webinars/tr/` — Turkish

### Step 1 — Create the file

Use a descriptive filename based on the webinar topic:

```
src/content/webinars/en/protein-structure-prediction-2025.md
```

The page will be at `/webinars/protein-structure-prediction-2025`.

### Step 2 — Add frontmatter

```yaml
---
title: "Protein Structure Prediction with AlphaFold3"
date: 2025-04-20
speaker: "Dr. Ayşe Kaya"
speakerTitle: "Associate Professor"
speakerAffiliation: "Bilkent University"
description: "An overview of AlphaFold3 and its implications for drug discovery."
youtubeUrl: "https://youtu.be/VIDEO_ID"
slidesUrl: "https://link-to-slides.com"    # leave empty string if none: ""
image: "https://link-to-speaker-photo.jpg" # leave empty string if none: ""
topic: "Structural Bioinformatics"
keyTakeaways:
  - "How AlphaFold3 differs from AlphaFold2"
  - "Practical use cases in drug discovery"
  - "Limitations and current open challenges"
year: 2025
type: bioinfonet   # use "student" for student webinar series
---
```

### Step 3 — Write the body

The body appears under "About the Talk". Include a summary of the webinar and a speaker bio:

```markdown
This webinar walks through the latest advances in protein structure prediction,
focusing on the newly released AlphaFold3 model...

## About the Speaker

Dr. Ayşe Kaya is an Associate Professor at Bilkent University specializing in
structural bioinformatics. She received her PhD from...
```

### Getting the YouTube video ID

From a URL like `https://youtu.be/G6v_jCEClpc`, the video ID is `G6v_jCEClpc`.
Full URLs like `https://www.youtube.com/watch?v=G6v_jCEClpc` also work.

---

## 5. Translating a Webinar Page

Same principle as blog post translation — use the **exact same filename** in the `tr/` directory:

```bash
cp src/content/webinars/en/protein-structure-prediction-2025.md \
   src/content/webinars/tr/protein-structure-prediction-2025.md
```

Then translate `title`, `description`, `speakerTitle`, `speakerAffiliation`, `topic`, `keyTakeaways`, and the body text. Keep `date`, `speaker`, `youtubeUrl`, `slidesUrl`, `image`, `year`, and `type` unchanged.

---

## 6. Submitting Your Work

1. **Stage your files:**
   ```bash
   git add src/content/blog/tr/crispr-in-cancer-research.md
   ```

2. **Commit with a clear message:**
   ```bash
   git commit -m "Add Turkish translation of CRISPR in cancer research"
   ```

3. **Push your branch:**
   ```bash
   git push origin add-my-blog-post
   ```

4. **Open a Pull Request** on GitHub and request a review from the website committee lead.

Once merged into `main`, Netlify automatically rebuilds and deploys the site within a couple of minutes.

---

## 7. File Naming Rules

- **Lowercase only** — `my-article.md`, not `My-Article.md`
- **Hyphens for spaces** — `genome-editing.md`, not `genome_editing.md`
- **English filename for translations** — Turkish translations use the same filename as the English version (e.g. `crispr-in-cancer-research.md`) so the two versions link automatically
- **No special characters** — avoid accented letters (ş, ğ, ı, ö, ü, ç), slashes, or parentheses in filenames
- **Keep it short but descriptive** — the filename becomes the URL

---

## 8. Frontmatter Reference

### Blog posts (`src/content/blog/en/` and `src/content/blog/tr/`)

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `title` | Yes | string | Article title |
| `pubDate` | Yes | date | Publication date (`YYYY-MM-DD`) |
| `description` | Yes | string | Short summary (1–2 sentences) |
| `author` | Yes | string | Author's full name |
| `category` | Yes | string | Content category (free text) |
| `tags` | No | list | e.g. `[bioinformatics, python]` |
| `image` | No | string | Thumbnail shown next to the post in the blog listing. If empty, the first image in the post body is used automatically. Set this explicitly if you want a specific thumbnail. |
| `draft` | No | boolean | `true` hides from listings. Default: `false` |

### Webinars (`src/content/webinars/en/` and `src/content/webinars/tr/`)

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `title` | Yes | string | Webinar title |
| `date` | Yes | date | Webinar date (`YYYY-MM-DD`) |
| `speaker` | Yes | string | Speaker's full name |
| `speakerTitle` | No | string | Academic title |
| `speakerAffiliation` | No | string | Speaker's institution |
| `description` | Yes | string | Short summary (1–2 sentences) |
| `youtubeUrl` | No | string | Full YouTube or youtu.be URL |
| `slidesUrl` | No | string | Link to slides |
| `image` | No | string | URL to speaker photo |
| `topic` | No | string | Topic badge shown on the page |
| `keyTakeaways` | No | list | Bullet list of learning outcomes |
| `year` | Yes | number | Year of the webinar |
| `type` | Yes | string | `rsg` for RSG Turkey webinars, `bioinfonet` for older Bioinfonet series, `student` for student webinars |

---

## 9. Markdown Tips

```markdown
## Heading 2        ← use these; avoid H1 (the title comes from frontmatter)
### Heading 3

**bold text**
*italic text*

- bullet item
- another item

1. numbered item
2. another item

[link text](https://example.com)

![alt text](https://image-url.com/photo.jpg)

`inline code`

```python
# code block
def hello():
    print("hello")
```

> blockquote / pull quote
```

### Embedding images

Use a full URL to an image already hosted online:

```markdown
![Speaker photo](https://rsgturkey.com/wp-content/uploads/2024/12/speaker.png)
```

Or add an image to `public/images/` and reference it as:

```markdown
![Speaker photo](/images/my-photo.png)
```
