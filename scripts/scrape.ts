/**
 * RSG Turkey Content Scraper
 *
 * Scrapes blog posts and webinar data from the live WordPress site at rsgturkey.com
 * and outputs markdown files with frontmatter into src/content/blog/ and src/content/webinars/.
 *
 * Usage: npx tsx scripts/scrape.ts
 */

import { parse as parseHTML } from "node-html-parser";
import TurndownService from "turndown";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const SITE_URL = "https://rsgturkey.com";
const OUT_DIR = join(import.meta.dirname, "..", "src", "content");
const BLOG_DIR = join(OUT_DIR, "blog");
const WEBINAR_DIR = join(OUT_DIR, "webinars");

// Ensure output directories exist
for (const dir of [BLOG_DIR, WEBINAR_DIR]) {
  mkdirSync(dir, { recursive: true });
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Remove script/style/nav/footer elements
turndown.remove(["script", "style", "nav", "footer", "noscript", "iframe"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeYaml(str: string): string {
  if (/[:#\[\]{}|>&*!%@`'",]/.test(str) || str.trim() !== str) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Sitemap parsing
// ---------------------------------------------------------------------------

async function getPostUrlsFromSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const xml = await fetchText(sitemapUrl);
    const root = parseHTML(xml);
    return root.querySelectorAll("loc").map((el) => el.text.trim());
  } catch (e) {
    console.warn(`  Could not fetch sitemap: ${sitemapUrl}`, (e as Error).message);
    return [];
  }
}

async function discoverPostUrls(): Promise<{ en: string[]; tr: string[] }> {
  console.log("Discovering post URLs from sitemaps...");

  // Try the standard WordPress sitemap locations
  const trUrls = await getPostUrlsFromSitemap(`${SITE_URL}/wp-sitemap-posts-post-1.xml`);
  const enUrls = await getPostUrlsFromSitemap(`${SITE_URL}/language/en/wp-sitemap-posts-post-1.xml`);

  // If sitemaps fail, try to discover from the blog index pages
  if (trUrls.length === 0 && enUrls.length === 0) {
    console.log("Sitemaps not available, trying to discover from blog pages...");
    return await discoverFromBlogPages();
  }

  // Classify URLs by language
  const en: string[] = [];
  const tr: string[] = [];

  for (const url of [...trUrls, ...enUrls]) {
    // Skip non-post URLs (pages, attachments, etc.)
    if (url.includes("/language/en/")) {
      en.push(url);
    } else {
      tr.push(url);
    }
  }

  console.log(`  Found ${en.length} English posts and ${tr.length} Turkish posts`);
  return { en, tr };
}

async function discoverFromBlogPages(): Promise<{ en: string[]; tr: string[] }> {
  const en: string[] = [];
  const tr: string[] = [];

  // Try common WordPress blog listing patterns
  for (const path of ["/blog", "/language/en/blog", "/category/blog"]) {
    try {
      const html = await fetchText(`${SITE_URL}${path}`);
      const root = parseHTML(html);
      const links = root.querySelectorAll("a[href]");
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        // Look for post-like URLs (year/month/day pattern or post slug)
        if (href.includes(SITE_URL) && /\/\d{4}\/\d{2}\//.test(href)) {
          if (href.includes("/language/en/")) {
            en.push(href);
          } else {
            tr.push(href);
          }
        }
      }
    } catch {
      // Continue if page doesn't exist
    }
  }

  // Also try the main page and look for post links
  try {
    const html = await fetchText(SITE_URL);
    const root = parseHTML(html);
    const links = root.querySelectorAll('article a[href], .post a[href], .entry-title a[href], h2 a[href]');
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      if (href.includes(SITE_URL) && href !== SITE_URL && href !== `${SITE_URL}/`) {
        if (href.includes("/language/en/")) {
          if (!en.includes(href)) en.push(href);
        } else {
          if (!tr.includes(href)) tr.push(href);
        }
      }
    }
  } catch {
    // Continue
  }

  console.log(`  Discovered ${en.length} English posts and ${tr.length} Turkish posts from pages`);
  return { en, tr };
}

// ---------------------------------------------------------------------------
// Blog post scraping
// ---------------------------------------------------------------------------

interface BlogPostData {
  title: string;
  pubDate: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  image: string;
  lang: "en" | "tr";
  content: string;
}

async function scrapeBlogPost(url: string, lang: "en" | "tr"): Promise<BlogPostData | null> {
  try {
    const html = await fetchText(url);
    const root = parseHTML(html);

    // Title - try multiple selectors
    const titleEl =
      root.querySelector("h1.entry-title") ||
      root.querySelector("h1.post-title") ||
      root.querySelector("article h1") ||
      root.querySelector("h1");
    const title = titleEl?.text.trim() || "Untitled";

    // Date
    const dateEl =
      root.querySelector("time[datetime]") ||
      root.querySelector(".entry-date") ||
      root.querySelector(".post-date") ||
      root.querySelector('meta[property="article:published_time"]');
    let pubDate = "";
    if (dateEl) {
      pubDate =
        dateEl.getAttribute("datetime") ||
        dateEl.getAttribute("content") ||
        dateEl.text.trim();
    }
    // Normalize date
    if (pubDate) {
      try {
        const d = new Date(pubDate);
        if (!isNaN(d.getTime())) {
          pubDate = d.toISOString().split("T")[0];
        }
      } catch {
        pubDate = new Date().toISOString().split("T")[0];
      }
    } else {
      pubDate = new Date().toISOString().split("T")[0];
    }

    // Author
    const authorEl =
      root.querySelector(".author-name") ||
      root.querySelector(".entry-author") ||
      root.querySelector('meta[name="author"]') ||
      root.querySelector('a[rel="author"]');
    const author =
      authorEl?.getAttribute("content") || authorEl?.text.trim() || "RSG Turkey";

    // Description / excerpt
    const metaDesc = root.querySelector('meta[name="description"]') ||
      root.querySelector('meta[property="og:description"]');
    const description = metaDesc?.getAttribute("content")?.trim() ||
      title.slice(0, 160);

    // Featured image
    const ogImage = root.querySelector('meta[property="og:image"]');
    const featuredImg = root.querySelector(".post-thumbnail img, .wp-post-image, article img");
    const image =
      ogImage?.getAttribute("content") ||
      featuredImg?.getAttribute("src") ||
      "";

    // Categories and tags
    const categories = root
      .querySelectorAll('a[rel="category tag"], .cat-links a, .category a')
      .map((el) => el.text.trim())
      .filter(Boolean);
    const tags = root
      .querySelectorAll('a[rel="tag"], .tag-links a, .tags a')
      .map((el) => el.text.trim())
      .filter(Boolean);

    const category = categories[0] || "general";

    // Main content
    const contentEl =
      root.querySelector(".entry-content") ||
      root.querySelector(".post-content") ||
      root.querySelector("article .content") ||
      root.querySelector("article");

    let content = "";
    if (contentEl) {
      // Remove unwanted elements from content
      contentEl.querySelectorAll("script, style, nav, .sharedaddy, .jp-relatedposts, .post-navigation").forEach((el) => el.remove());
      content = turndown.turndown(contentEl.innerHTML);
    }

    return {
      title,
      pubDate,
      description,
      author,
      category,
      tags: tags.length > 0 ? tags : categories,
      image,
      lang,
      content,
    };
  } catch (e) {
    console.error(`  Error scraping ${url}:`, (e as Error).message);
    return null;
  }
}

function writeBlogPost(post: BlogPostData): string {
  const slug = slugify(post.title);
  const filename = `${slug}.md`;
  const filepath = join(BLOG_DIR, filename);

  const tagsYaml = post.tags.length > 0
    ? `tags:\n${post.tags.map((t) => `  - "${t}"`).join("\n")}`
    : "tags: []";

  const frontmatter = `---
title: ${escapeYaml(post.title)}
pubDate: ${post.pubDate}
description: ${escapeYaml(post.description)}
author: ${escapeYaml(post.author)}
category: ${escapeYaml(post.category)}
${tagsYaml}
image: ${escapeYaml(post.image)}
lang: "${post.lang}"
draft: false
---`;

  const fullContent = `${frontmatter}\n\n${post.content}\n`;
  writeFileSync(filepath, fullContent, "utf-8");
  console.log(`  Wrote: ${filename}`);
  return filename;
}

// ---------------------------------------------------------------------------
// Webinar scraping
// ---------------------------------------------------------------------------

interface WebinarData {
  title: string;
  date: string;
  speaker: string;
  speakerAffiliation: string;
  description: string;
  youtubeUrl: string;
  slidesUrl: string;
  lang: "en" | "tr";
  year: number;
  type: "bioinfonet" | "student";
}

async function scrapeWebinarPage(url: string, lang: "en" | "tr"): Promise<WebinarData[]> {
  const webinars: WebinarData[] = [];

  try {
    const html = await fetchText(url);
    const root = parseHTML(html);

    // Look for webinar entries - these are typically in cards, sections, or list items
    const entries = root.querySelectorAll(
      ".webinar-item, .webinar-card, article, .entry-content section, .elementor-widget-container"
    );

    for (const entry of entries) {
      const titleEl = entry.querySelector("h2, h3, h4, .webinar-title");
      if (!titleEl) continue;

      const title = titleEl.text.trim();
      if (!title || title.length < 5) continue;

      // Try to find speaker info
      const speakerEl = entry.querySelector(".speaker, .presenter, p");
      const speaker = speakerEl?.text.trim() || "";

      // Try to find date
      const dateEl = entry.querySelector(".date, time, .webinar-date");
      const dateStr = dateEl?.text.trim() || dateEl?.getAttribute("datetime") || "";

      // Try to find YouTube link
      const youtubeLink = entry.querySelector('a[href*="youtube"], a[href*="youtu.be"]');
      const youtubeUrl = youtubeLink?.getAttribute("href") || "";

      // Extract year from date or default
      let year = new Date().getFullYear();
      const yearMatch = dateStr.match(/\b(20\d{2})\b/);
      if (yearMatch) year = parseInt(yearMatch[1]);

      webinars.push({
        title,
        date: dateStr || `${year}-01-01`,
        speaker: speaker || "TBA",
        speakerAffiliation: "",
        description: entry.querySelector("p")?.text.trim() || title,
        youtubeUrl,
        slidesUrl: "",
        lang,
        year,
        type: title.toLowerCase().includes("student") ? "student" : "bioinfonet",
      });
    }
  } catch (e) {
    console.error(`  Error scraping webinars from ${url}:`, (e as Error).message);
  }

  return webinars;
}

function writeWebinar(webinar: WebinarData): string {
  const slug = slugify(webinar.title);
  const yearDir = join(WEBINAR_DIR, String(webinar.year));
  mkdirSync(yearDir, { recursive: true });

  const filename = `${slug}.md`;
  const filepath = join(yearDir, filename);

  const frontmatter = `---
title: ${escapeYaml(webinar.title)}
date: ${webinar.date}
speaker: ${escapeYaml(webinar.speaker)}
speakerAffiliation: ${escapeYaml(webinar.speakerAffiliation)}
description: ${escapeYaml(webinar.description)}
youtubeUrl: ${escapeYaml(webinar.youtubeUrl)}
slidesUrl: ""
lang: "${webinar.lang}"
year: ${webinar.year}
type: "${webinar.type}"
---`;

  const fullContent = `${frontmatter}\n\n${webinar.description}\n`;
  writeFileSync(filepath, fullContent, "utf-8");
  console.log(`  Wrote: ${webinar.year}/${filename}`);
  return filename;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== RSG Turkey Content Scraper ===\n");

  // --- Blog posts ---
  console.log("--- Scraping Blog Posts ---");
  const { en: enUrls, tr: trUrls } = await discoverPostUrls();

  let blogCount = 0;
  for (const url of trUrls) {
    console.log(`  Scraping (TR): ${url}`);
    const post = await scrapeBlogPost(url, "tr");
    if (post && post.content.length > 50) {
      writeBlogPost(post);
      blogCount++;
    }
    // Be polite to the server
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const url of enUrls) {
    console.log(`  Scraping (EN): ${url}`);
    const post = await scrapeBlogPost(url, "en");
    if (post && post.content.length > 50) {
      writeBlogPost(post);
      blogCount++;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nScraped ${blogCount} blog posts total.\n`);

  // --- Webinars ---
  console.log("--- Scraping Webinars ---");
  const webinarPaths = ["/webinars", "/language/en/webinars", "/bioinfonet"];
  let webinarCount = 0;

  for (const path of webinarPaths) {
    const lang: "en" | "tr" = path.includes("/language/en/") ? "en" : "tr";
    const url = `${SITE_URL}${path}`;
    console.log(`  Trying: ${url}`);
    const webinars = await scrapeWebinarPage(url, lang);
    for (const w of webinars) {
      writeWebinar(w);
      webinarCount++;
    }
  }
  console.log(`\nScraped ${webinarCount} webinars total.\n`);

  // If no content was scraped, create placeholder content from the existing hardcoded data
  if (blogCount === 0 && webinarCount === 0) {
    console.log("No content scraped from the live site. The site may be down or restructured.");
    console.log("The existing placeholder content in the repo will be migrated to content collections instead.");
  }

  console.log("=== Scraping Complete ===");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
