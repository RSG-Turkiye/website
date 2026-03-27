/**
 * Upload all symposium WordPress images to Cloudinary.
 * Reads attachment URLs from the WP XML export, downloads each image,
 * uploads to Cloudinary under rsgturkey/symposium/, and writes
 * symposium_website/cloudinary-mapping.json.
 *
 * Run from symposium_website/: npx tsx scripts/upload-images.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v2 as cloudinary } from "cloudinary";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env from parent directory (root of repo)
const envPath = join(ROOT, "..", ".env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const XML_PATH = join(ROOT, "WordPress.2026-03-27.xml");
const MAPPING_PATH = join(ROOT, "cloudinary-mapping.json");

// Extract all attachment URLs from WordPress XML
function extractAttachmentUrls(xml: string): string[] {
  const urls: string[] = [];
  // Match <wp:attachment_url><![CDATA[...]]></wp:attachment_url>
  const regex = /<wp:attachment_url><!\[CDATA\[([^\]]+)\]\]><\/wp:attachment_url>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return [...new Set(urls)]; // deduplicate
}

// Derive a stable Cloudinary public_id from the original URL
function toPublicId(url: string): string {
  // e.g. https://symposium.rsgturkey.com/wp-content/uploads/2024/10/photo.jpg
  // → rsgturkey/symposium/2024/10/photo
  const match = url.match(/\/wp-content\/uploads\/(.+?)(\.[^.]+)?$/);
  if (!match) return `rsgturkey/symposium/${Date.now()}`;
  const path = match[1].replace(/\/$/, ""); // e.g. 2024/10/photo
  return `rsgturkey/symposium/${path}`;
}

// Determine resource_type from URL extension
function resourceType(url: string): "image" | "video" | "raw" {
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf"].includes(ext)) return "raw";
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  return "image";
}

async function uploadUrl(
  originalUrl: string
): Promise<{ originalUrl: string; cloudinaryUrl: string } | null> {
  const publicId = toPublicId(originalUrl);
  const resType = resourceType(originalUrl);

  try {
    const result = await cloudinary.uploader.upload(originalUrl, {
      public_id: publicId,
      resource_type: resType,
      overwrite: false, // skip if already uploaded
      unique_filename: false,
    });
    return { originalUrl, cloudinaryUrl: result.secure_url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If already exists Cloudinary returns the existing URL via a different path;
    // treat "already exists" as success by fetching the resource URL
    if (msg.includes("already exists") || msg.includes("overwrite")) {
      const ext = originalUrl.split(".").pop()?.toLowerCase() ?? "jpg";
      const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/${resType}/upload/${publicId}.${ext}`;
      console.log(`  [skip] already exists: ${publicId}`);
      return { originalUrl, cloudinaryUrl: url };
    }
    console.error(`  [error] ${originalUrl}: ${msg}`);
    return null;
  }
}

async function main() {
  console.log("Reading WordPress XML…");
  const xml = readFileSync(XML_PATH, "utf-8");
  const urls = extractAttachmentUrls(xml);
  console.log(`Found ${urls.length} attachment URLs.`);

  // Load existing mapping if present (to resume interrupted runs)
  let mapping: Record<string, string> = {};
  try {
    mapping = JSON.parse(readFileSync(MAPPING_PATH, "utf-8"));
    console.log(`Resuming — ${Object.keys(mapping).length} already mapped.`);
  } catch {
    // no existing mapping
  }

  const todo = urls.filter((u) => !mapping[u]);
  console.log(`${todo.length} images to upload.\n`);

  let done = 0;
  // Upload in batches of 5 to avoid rate limits
  const BATCH = 5;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(uploadUrl));
    for (const r of results) {
      if (r) {
        mapping[r.originalUrl] = r.cloudinaryUrl;
        done++;
        console.log(`[${done}/${todo.length}] ${r.originalUrl.split("/").pop()}`);
      }
    }
    // Save after every batch in case of interruption
    writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));
  }

  console.log(`\nDone. ${Object.keys(mapping).length} total mappings saved to cloudinary-mapping.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
