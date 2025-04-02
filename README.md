
# 🚀 RSG Turkey Blog [IN PROGRESS] (From scratch!)

Welcome to the **RSG Turkey Blog**—a space for bioinformatics insights, tutorials, and community updates! Built with [Astro](https://astro.build) for performance and simplicity. 

## 🌍 Getting Started

Clone this repository and install dependencies:

```sh
git clone https://github.com/yourusername/rsgwebsite.git
cd rsgwebsite
npm install
```

Start the development server:

```sh
npm run dev
```

Your site will be live at `http://localhost:4321`.

## 📂 Project Structure

Here's how the blog is structured:

```text
/
├── public/                # Static assets (images, icons, etc.)
├── src/
│   ├── components/        # Reusable UI components
│   ├── layouts/           # Page layouts
│   ├── pages/             # Blog posts and main pages
│   │   ├── posts/         # Markdown blog posts
│   │   ├── tags/          # Tag-based post categorization
│   │   ├── index.astro    # Homepage
│   │   ├── about.astro    # About page
│   │   ├── blog.astro     # Blog main page
│   ├── styles/            # Global styles
├── scripts/               # JavaScript utilities
├── package.json           # Project dependencies
└── README.md              # This file
```

## 🛠 Commands

| Command         | Description                                  |
|----------------|----------------------------------------------|
| `npm install`  | Install dependencies                        |
| `npm run dev`  | Start development server (`localhost:4321`) |
| `npm run build` | Build the site for production (`./dist/`)  |
| `npm run preview` | Preview the production build             |

## 📝 Writing a Blog Post

To create a new blog post:

1. Navigate to `src/pages/posts/`
2. Add a new Markdown file: `my-new-post.md`
3. Use the following frontmatter template:

```md
---
title: "My New Post"
date: "2025-04-02"
tags: ["bioinformatics", "research"]
description: "A brief description of the post."
---

Your content goes here...
```

## 🔗 Resources

- 📖 [Astro Docs](https://docs.astro.build)


Happy coding! 🚀

---

Let me know if you want any changes or additions! 🚀