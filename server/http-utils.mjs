import { createReadStream, existsSync } from "node:fs";
import { extname } from "node:path";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".json": "application/json; charset=utf-8",
};

export function cors(res) {
  const origin = res.__hjscOrigin || "";
  const allowedOrigin = /^https:\/\/(www\.)?zhiyinstudio\.cn$/i.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else if (origin === "null") {
    // Electron file:// pages use the opaque `null` origin. It must be echoed
    // explicitly when requests include credentials; `*` is rejected by Fetch.
    res.setHeader("Access-Control-Allow-Origin", "null");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export function sendJson(res, status, payload) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, { error: error.message || "服务器错误" });
}

export async function readJson(req) {
  const chunks = [];
  const maxBytes = Number(process.env.HJSC_MAX_JSON_BYTES || 40 * 1024 * 1024);
  let receivedBytes = 0;
  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      const error = new Error("请求内容过大");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "文件不存在" });
    return;
  }
  cors(res);
  res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

export function routeParams(pattern, pathname) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:([^/]+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  })}$`);
  const match = pathname.match(re);
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}
