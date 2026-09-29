import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { filesDir } from "../database.mjs";

function safeSegment(value) {
  return String(value || "未归类").replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 80);
}

export async function saveGeneratedImage({ projectId, taskId, index, buffer }) {
  const maxBytes = Number(process.env.HJSC_MAX_GENERATED_IMAGE_BYTES || 25 * 1024 * 1024);
  if (!buffer?.length || buffer.length > maxBytes) throw new Error("生成图片超过本机允许保存的大小");
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
  } catch {
    const error = new Error("生图服务返回的内容不是有效图片");
    error.status = 502;
    throw error;
  }
  const format = metadata.format || "png";
  const extension = format === "jpeg" ? "jpg" : format;
  const folder = join(filesDir, "generated-images", safeSegment(projectId), safeSegment(taskId));
  await mkdir(folder, { recursive: true });
  const stem = `${String(index + 1).padStart(2, "0")}-${Date.now()}`;
  const originalPath = join(folder, `${stem}.${extension}`);
  const previewPath = join(folder, `${stem}-预览.jpg`);
  const thumbnailPath = join(folder, `${stem}-缩略图.jpg`);
  await writeFile(originalPath, buffer);
  await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(previewPath);
  await sharp(buffer).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbnailPath);
  return { originalPath, previewPath, thumbnailPath, mimeType: `image/${extension === "jpg" ? "jpeg" : extension}`, width: metadata.width || 0, height: metadata.height || 0 };
}
