import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { constants as fsConstants, createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readJson, sendJson } from "./http-utils.mjs";

const execFileAsync = promisify(execFile);
const renderJobs = new Map();
const exportSessions = new Map();

export async function createSubtitleExportSession(parentDirectory) {
  if (!isAbsolute(parentDirectory) || !(await stat(parentDirectory)).isDirectory()) throw new Error("请选择有效的保存文件夹");
  const directory = join(parentDirectory, `批量带字幕成片_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}_${randomUUID().slice(0, 6)}`);
  await mkdir(directory);
  const id = randomUUID();
  exportSessions.set(id, { directory, ownerId: null, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return { id, directory };
}

export function getSubtitleExportDirectory(id) {
  const session = exportSessions.get(id);
  return session?.expiresAt > Date.now() ? session.directory : null;
}

function exportSessionFor(id, viewerId) {
  const session = exportSessions.get(id);
  if (!session || session.expiresAt <= Date.now() || (session.ownerId && session.ownerId !== viewerId)) {
    const error = new Error("保存位置已失效，请重新选择文件夹");
    error.status = 403;
    throw error;
  }
  if (!session.ownerId) session.ownerId = viewerId;
  session.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return session;
}

function safeName(value, fallback = "video.mp4") {
  const name = decodeURIComponent(String(value || fallback)).replace(/[^\w\-.\u4e00-\u9fff ]/g, "_").trim();
  return name || fallback;
}

function exactOutputName(value) {
  const name = String(value || "");
  if (!name || !/\.mp4$/i.test(name) || /[\\/:*?"<>|\u0000-\u001f]/u.test(name)) {
    const error = new Error("成片文件名无效，必须是原视频文件名对应的 MP4 名称");
    error.status = 400;
    throw error;
  }
  return name;
}

function parseTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return 0;
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}

export function parseSrt(source) {
  return String(source || "").replace(/^\uFEFF/, "").split(/\r?\n\r?\n+/).map((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return null;
    const [start, end] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!text) return null;
    return { id: `cue-${index + 1}`, startMs: parseTime(start), endMs: parseTime(end), text };
  }).filter((cue) => cue && cue.endMs > cue.startMs);
}

function parseWhisperJson(source) {
  let payload;
  try {
    payload = JSON.parse(String(source || ""));
  } catch {
    return [];
  }
  return (Array.isArray(payload.transcription) ? payload.transcription : []).map((segment, index) => {
    const startMs = Number(segment?.offsets?.from);
    const endMs = Number(segment?.offsets?.to);
    const words = (Array.isArray(segment?.tokens) ? segment.tokens : []).map((token) => ({
      text: String(token?.text || "").replace(/[\s\u200b\u2581]+/g, ""),
      startMs: Number(token?.offsets?.from),
      endMs: Number(token?.offsets?.to),
    })).filter((word) => word.text && Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs && !/^\[[^\]]+\]$/.test(word.text));
    return {
      id: `cue-${index + 1}`,
      startMs,
      endMs,
      text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
      words,
    };
  }).filter((cue) => cue.text && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs);
}

async function writeRequest(req, target, maxBytes) {
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(received > maxBytes ? new Error("视频超过允许上传大小") : null, chunk);
    },
  });
  await pipeline(req, limiter, createWriteStream(target));
  return received;
}

function commandPath(name, fallback) {
  return process.env[name] || fallback;
}

async function run(command, args, label) {
  try {
    await execFileAsync(command, args, { timeout: Number(process.env.HJSC_TRANSCRIPTION_TIMEOUT_MS || 3_600_000), maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "").replace(/\s+/g, " ").trim().slice(-800);
    throw new Error(`${label}失败${detail ? `：${detail}` : ""}`);
  }
}

export async function transcribeVideo(req, res, { filesDir }) {
  const model = String(process.env.HJSC_WHISPER_MODEL || join(filesDir, "models", "ggml-base.bin")).trim();
  if (!model) {
    const error = new Error("尚未配置本地语音识别模型。请在开发者端设置 HJSC_WHISPER_MODEL 后再识别视频。");
    error.status = 503;
    throw error;
  }
  try {
    const modelInfo = await stat(model);
    if (!modelInfo.isFile()) throw new Error("语音识别模型路径不是文件");
  } catch {
    const error = new Error("语音识别模型文件不存在，请检查 HJSC_WHISPER_MODEL 配置");
    error.status = 503;
    throw error;
  }

  const uploadDir = join(filesDir, "transcription", "incoming");
  const workDir = join(filesDir, "transcription", "work");
  await mkdir(uploadDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const id = `transcribe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sourceName = safeName(req.headers["x-file-name"], "视频.mp4");
  const sourcePath = join(uploadDir, `${id}-${sourceName}`);
  const audioPath = join(workDir, `${id}.m4a`);
  const wavPath = join(workDir, `${id}.wav`);
  const outputBase = join(workDir, id);
  const srtPath = `${outputBase}.srt`;
  const jsonPath = `${outputBase}.json`;
  const maxBytes = Number(process.env.HJSC_MAX_TRANSCRIPTION_VIDEO_BYTES || 2 * 1024 * 1024 * 1024);
  try {
    const size = await writeRequest(req, sourcePath, maxBytes);
    if (!size) throw new Error("没有收到视频文件");
    const ext = extname(sourceName).toLowerCase();
    if (![".mp4", ".mov", ".m4v", ".webm"].includes(ext)) throw new Error("视频格式暂不支持，请上传 MP4、MOV、M4V 或 WebM");

    const whisper = commandPath("HJSC_WHISPER_CLI", "/opt/homebrew/bin/whisper-cli");
    if (process.platform === "win32") {
      const ffmpeg = commandPath("HJSC_FFMPEG", "ffmpeg");
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath], "视频音频提取");
    } else {
      const avconvert = commandPath("HJSC_AVCONVERT", "/usr/bin/avconvert");
      const afconvert = commandPath("HJSC_AFCONVERT", "/usr/bin/afconvert");
      await run(avconvert, ["--source", sourcePath, "--preset", "PresetAppleM4A", "--output", audioPath, "--replace"], "视频音频提取");
      await run(afconvert, ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", audioPath, wavPath], "音频预处理");
    }
    const language = String(req.headers["x-language"] || "zh").trim() || "zh";
    await run(whisper, ["-m", model, "-l", language, "-osrt", "-ojf", "-sow", "-of", outputBase, "-np", wavPath], "语音识别");
    const wordTimedCues = parseWhisperJson(await readFile(jsonPath, "utf8"));
    const cues = wordTimedCues.length ? wordTimedCues : parseSrt(await readFile(srtPath, "utf8"));
    if (!cues.length) throw new Error("没有识别到可用台词，请确认视频有清晰人声");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ fileName: sourceName, cues, provider: "本地语音识别 · 词级时间轴", style: "pr字幕", recognizedAt: new Date().toISOString() }));
  } finally {
    await Promise.all([sourcePath, audioPath, wavPath, srtPath, jsonPath].map((file) => rm(file, { force: true }).catch(() => {})));
  }
}

export async function createSubtitleRenderIntent(req, res, viewer) {
  const body = await readJson(req);
  const ass = String(body.ass || "").trim();
  if (!ass) return sendJson(res, 400, { error: "字幕样式内容不能为空" });
  const exportSessionId = String(body.exportSessionId || "");
  if (exportSessionId) exportSessionFor(exportSessionId, viewer.id);
  const id = `render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const targetWidth = Math.round(Number(body.width) || 0);
  const targetHeight = Math.round(Number(body.height) || 0);
  const validCanvas = targetWidth >= 320 && targetWidth <= 8192 && targetHeight >= 240 && targetHeight <= 8192;
  renderJobs.set(id, {
    ass,
    outputName: safeName(body.outputName, "视频.mp4"),
    targetWidth: validCanvas ? targetWidth : 0,
    targetHeight: validCanvas ? targetHeight : 0,
    viewerId: viewer.id,
    exportSessionId,
    destinationName: exportSessionId ? exactOutputName(body.destinationName) : safeName(body.destinationName, "视频.mp4"),
  });
  setTimeout(() => renderJobs.delete(id), 30 * 60 * 1000).unref?.();
  sendJson(res, 201, { id });
}

function escapeFilterPath(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

export async function renderSubtitleVideo(req, res, { filesDir, renderId, viewer }) {
  const job = renderJobs.get(renderId);
  if (!job) {
    const error = new Error("成片任务不存在或已过期，请重新导出");
    error.status = 404;
    throw error;
  }
  if (job.viewerId !== viewer.id) {
    const error = new Error("没有权限访问该成片任务");
    error.status = 403;
    throw error;
  }
  const exportSession = job.exportSessionId ? exportSessionFor(job.exportSessionId, viewer.id) : null;
  renderJobs.delete(renderId);
  const workDir = join(filesDir, "transcription", "render");
  await mkdir(workDir, { recursive: true });
  const base = `render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sourcePath = join(workDir, `${base}-source${extname(job.outputName) || ".mp4"}`);
  const assPath = join(workDir, `${base}.ass`);
  const outputPath = join(workDir, `${base}-with-subtitles.mp4`);
  const maxBytes = Number(process.env.HJSC_MAX_RENDER_VIDEO_BYTES || 2 * 1024 * 1024 * 1024);
  try {
    await writeRequest(req, sourcePath, maxBytes);
    await writeFile(assPath, job.ass, "utf8");
    const ffmpeg = commandPath("HJSC_FFMPEG", existsSync("/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg") ? "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg" : "/opt/homebrew/bin/ffmpeg");
    const preset = String(process.env.HJSC_RENDER_PRESET || "medium").trim() || "medium";
    const configuredFontsDir = String(process.env.HJSC_SUBTITLE_FONT_DIR || join(process.cwd(), "assets", "fonts")).trim();
    const fontsDir = existsSync(configuredFontsDir) ? configuredFontsDir : "";
    const assFilter = fontsDir
      ? `ass=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(fontsDir)}`
      : `ass=${escapeFilterPath(assPath)}`;
    const renderFilters = job.targetWidth && job.targetHeight
      ? `scale=${job.targetWidth}:${job.targetHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${job.targetWidth}:${job.targetHeight},${assFilter}`
      : assFilter;
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath, "-vf", renderFilters, "-c:v", "libx264", "-preset", preset, "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "16", "-maxrate", "25M", "-bufsize", "50M", "-tag:v", "avc1", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", outputPath], "字幕烧录");
    const outputInfo = await stat(outputPath);
    if (outputInfo.size > maxBytes) throw new Error("输出成片超过允许保存大小");
    if (exportSession) {
      if (!job.destinationName.toLowerCase().endsWith(".mp4")) throw new Error("成片文件名必须以 .mp4 结尾");
      const savedPath = join(exportSession.directory, job.destinationName);
      await copyFile(outputPath, savedPath, fsConstants.COPYFILE_EXCL);
      const savedInfo = await stat(savedPath);
      if (savedInfo.size !== outputInfo.size) {
        await rm(savedPath, { force: true });
        throw new Error("成片保存不完整，请重试此集");
      }
      await rm(sourcePath, { force: true });
      await rm(assPath, { force: true });
      await rm(outputPath, { force: true });
      return sendJson(res, 200, { filename: job.destinationName, path: savedPath, size: outputInfo.size });
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": outputInfo.size, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.outputName.replace(/\.[^.]+$/, "") + "_已加字幕.mp4")}` });
    const stream = createReadStream(outputPath);
    stream.on("close", () => Promise.all([sourcePath, assPath, outputPath].map((file) => rm(file, { force: true }).catch(() => {}))));
    stream.pipe(res);
  } catch (error) {
    await Promise.all([sourcePath, assPath, outputPath].map((file) => rm(file, { force: true }).catch(() => {})));
    throw error;
  }
}
