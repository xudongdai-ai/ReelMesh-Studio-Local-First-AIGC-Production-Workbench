import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import { filesDir } from "./database.mjs";

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_IMAGE_BYTES = Number(process.env.HJSC_MAX_IMAGE_BYTES || 25 * 1024 * 1024);
const MAX_DOCUMENT_BYTES = Number(process.env.HJSC_MAX_DOCUMENT_BYTES || 60 * 1024 * 1024);

function safeSegment(value) {
  return String(value || "未归类").replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 80);
}

export async function saveAssetImage({ projectId, assetId, assetType, version, fileName, mimeType, dataUrl }) {
  if (!dataUrl || !dataUrl.includes(",")) {
    const error = new Error("上传文件数据无效");
    error.status = 400;
    throw error;
  }
  if (!EXT_BY_MIME[mimeType]) {
    const error = new Error("当前只允许上传图片文件");
    error.status = 400;
    throw error;
  }

  const [header, base64] = dataUrl.split(",", 2);
  if (!header?.startsWith("data:") || !header.includes(";base64") || !base64) {
    const error = new Error("上传文件编码无效");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(`图片文件必须小于 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
    error.status = 413;
    throw error;
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
  } catch {
    const error = new Error("文件内容不是有效图片");
    error.status = 400;
    throw error;
  }
  const actualMimeType = MIME_BY_FORMAT[metadata.format];
  if (!actualMimeType || actualMimeType !== mimeType) {
    const error = new Error("文件真实格式与声明类型不一致");
    error.status = 400;
    throw error;
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const ext = EXT_BY_MIME[actualMimeType] || extname(fileName) || ".bin";
  const folder = join(filesDir, safeSegment(projectId), safeSegment(assetType), safeSegment(assetId), `v${version}`);
  mkdirSync(folder, { recursive: true });

  const stem = `${Date.now()}-${checksum.slice(0, 10)}`;
  const originalPath = join(folder, `${stem}-原图${ext}`);
  const previewPath = join(folder, `${stem}-预览.jpg`);
  const thumbnailPath = join(folder, `${stem}-缩略图.jpg`);
  writeFileSync(originalPath, buffer);

  let previewUrl = null;
  let thumbnailUrl = null;
  try {
    await sharp(buffer, { limitInputPixels: 100_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(previewPath);
    await sharp(buffer, { limitInputPixels: 100_000_000 }).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(thumbnailPath);
    previewUrl = `/files/${safeSegment(projectId)}/${safeSegment(assetType)}/${safeSegment(assetId)}/v${version}/${stem}-预览.jpg`;
    thumbnailUrl = `/files/${safeSegment(projectId)}/${safeSegment(assetType)}/${safeSegment(assetId)}/v${version}/${stem}-缩略图.jpg`;
  } catch {
    previewUrl = null;
    thumbnailUrl = null;
  }

  return {
    checksum,
    mimeType: actualMimeType,
    sizeBytes: buffer.length,
    storedName: `${stem}-原图${ext}`,
    originalPath,
    previewPath: previewUrl ? previewPath : null,
    thumbnailPath: thumbnailUrl ? thumbnailPath : null,
    originalUrl: `/files/${safeSegment(projectId)}/${safeSegment(assetType)}/${safeSegment(assetId)}/v${version}/${stem}-原图${ext}`,
    previewUrl,
    thumbnailUrl,
  };
}

export async function saveAssetFile(payload) {
  const documentTypes = new Set(["application/pdf", "text/markdown", "text/plain"]);
  if (!documentTypes.has(String(payload.mimeType || ""))) {
    return saveAssetImage(payload);
  }
  const { projectId, assetId, assetType, version, mimeType, dataUrl } = payload;
  const isPdf = mimeType === "application/pdf";
  if (!dataUrl || !dataUrl.includes(",")) {
    const error = new Error("上传文件数据无效");
    error.status = 400;
    throw error;
  }
  const [header, base64] = dataUrl.split(",", 2);
  if (!header?.startsWith(`data:${mimeType}`) || !header.includes(";base64") || !base64) {
    const error = new Error("文档文件编码无效");
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    const error = new Error(`文档文件必须小于 ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB`);
    error.status = 413;
    throw error;
  }
  if (isPdf && buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    const error = new Error("文件内容不是有效 PDF");
    error.status = 400;
    throw error;
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const folder = join(filesDir, safeSegment(projectId), safeSegment(assetType), safeSegment(assetId), `v${version}`);
  mkdirSync(folder, { recursive: true });
  const stem = `${Date.now()}-${checksum.slice(0, 10)}`;
  const extension = isPdf ? ".pdf" : ".md";
  const storedName = `${stem}-原文件${extension}`;
  const originalPath = join(folder, storedName);
  writeFileSync(originalPath, buffer);

  return {
    checksum,
    mimeType,
    sizeBytes: buffer.length,
    storedName,
    originalPath,
    previewPath: null,
    thumbnailPath: null,
    originalUrl: `/files/${safeSegment(projectId)}/${safeSegment(assetType)}/${safeSegment(assetId)}/v${version}/${storedName}`,
    previewUrl: null,
    thumbnailUrl: null,
  };
}
