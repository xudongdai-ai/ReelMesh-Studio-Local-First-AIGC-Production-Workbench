import JSZip from "jszip";

// The FCP7 XML shape follows the MIT-licensed PEKORA project by yf-dev.
// Keep the converter local so subtitle text and production files never leave the app.
// Premiere's serialized style uses this exact PostScript name. The renderer
// uses a static local font family below because libass does not resolve the
// named variable-font instance reliably on every machine.
export const PREMIERE_FONT_FAMILY = "AlimamaFangYuanTiVF-Medium";
export const PREMIERE_RENDER_FONT_FAMILY = "Alimama FangYuanTi VF Medium";

export const PREMIERE_DEFAULT_SETTINGS = {
  sequenceName: "",
  frameRate: 25,
  ntsc: false,
  width: 1882,
  height: 1080,
  anamorphic: false,
  pixelAspectRatio: "square",
  fieldDominance: "none",
  orientation: "landscape",
  fontName: PREMIERE_FONT_FAMILY,
  fontWeight: 500,
  fontSize: 62,
  scaleX: 98,
  textColor: "#ffffff",
  horizontalPosition: 50,
  verticalPosition: 89,
  strokeWidth: 1.8,
  strokeColor: "#000000",
  shadowWidth: 2,
  shadowOpacity: 85,
  shadowColor: "#000000",
  alignment: "center",
  backgroundOpacity: 0,
  backgroundColor: "#000000",
};

export const PREMIERE_ORIENTATION_PRESETS = {
  landscape: {
    width: 1882,
    height: 1080,
    fontSize: 62,
    scaleX: 98,
    verticalPosition: 89,
    strokeWidth: 1.8,
    shadowWidth: 2,
    shadowOpacity: 85,
  },
  portrait: {
    width: 1080,
    height: 1882,
    fontSize: 92,
    scaleX: 98,
    verticalPosition: 67,
    strokeWidth: 1.8,
    shadowWidth: 2,
    shadowOpacity: 85,
  },
};

const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function safeFilename(value) {
  return String(value || "项目")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "项目";
}

export function subtitleOutputFilename(value) {
  const sourceName = String(value || "视频");
  return /\.mp4$/i.test(sourceName) ? sourceName : `${sourceName.replace(/\.[^.]+$/, "")}.mp4`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlTag(name, content = "", attributes = {}) {
  const attributeText = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
  return `<${name}${attributeText}>${content}</${name}>`;
}

function numberText(value) {
  const normalized = Number(value) || 0;
  if (Number.isInteger(normalized)) return `${normalized}.0`;
  return normalized.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function hexToRgb(hex) {
  const normalized = String(hex || "#000000").replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((item) => `${item}${item}`).join("")
    : normalized, 16);
  return {
    alpha: 255,
    red: Number.isFinite(value) ? (value >> 16) & 255 : 0,
    green: Number.isFinite(value) ? (value >> 8) & 255 : 0,
    blue: Number.isFinite(value) ? value & 255 : 0,
  };
}

function parseTimestamp(value) {
  const raw = String(value || "").trim().replace(",", ".");
  const match = raw.match(/^(?:(\d+):)?([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] || "0").padEnd(3, "0").slice(0, 3));
  return ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + milliseconds;
}

function parseAssTimestamp(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+):([0-5]?\d):([0-5]?\d)\.(\d{1,2})$/);
  if (!match) return parseTimestamp(raw.replace(".", ","));
  return ((Number(match[1]) * 60 * 60 + Number(match[2]) * 60 + Number(match[3])) * 1000)
    + Number(match[4].padEnd(3, "0").slice(0, 3));
}

function cleanCueText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/<\/?(?:i|b|u|font)(?:\s[^>]*)?>/gi, "")
    .replace(/\{\\[^}]+\}/g, "")
    .trim();
}

function normalizeTimedWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((word) => {
      const text = cleanCueText(word?.text).replace(/[\s\u200b\u2581]+/g, "");
      return {
        text,
        startMs: Math.max(0, Math.round(Number(word?.startMs) || 0)),
        endMs: Math.max(0, Math.round(Number(word?.endMs) || 0)),
      };
    })
    .filter((word) => word.text && word.endMs > word.startMs && !/^\[[^\]]+\]$/.test(word.text));
}

function normalizeCues(cues) {
  return cues
    .map((cue, index) => ({
      id: cue.id || `cue-${index + 1}`,
      startMs: Math.max(0, Math.round(Number(cue.startMs) || 0)),
      endMs: Math.max(0, Math.round(Number(cue.endMs) || 0)),
      text: cleanCueText(cue.text),
      words: normalizeTimedWords(cue.words),
    }))
    .filter((cue) => cue.text && cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue, index) => ({ ...cue, id: cue.id || `cue-${index + 1}` }));
}

function parseSrtOrVtt(text) {
  const source = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^WEBVTT[^\n]*\n+/i, "");
  const cues = [];
  const timestampPattern = "(?:\\d+:)?\\d{1,2}:\\d{2}[,.]\\d{1,3}";
  for (const block of source.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => new RegExp(`${timestampPattern}\\s*-->\\s*${timestampPattern}`).test(line));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(new RegExp(`(${timestampPattern})\\s*-->\\s*(${timestampPattern})`));
    if (!timing) continue;
    const startMs = parseTimestamp(timing[1]);
    const endMs = parseTimestamp(timing[2]);
    const cueText = lines.slice(timingIndex + 1).join("\n").trim();
    if (startMs !== null && endMs !== null) cues.push({ startMs, endMs, text: cueText });
  }
  return normalizeCues(cues);
}

function parseAss(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = source.split("\n");
  const formatLine = lines.find((line) => /^Format\s*:/i.test(line) && lines.slice(0, lines.indexOf(line)).some((item) => /^\s*\[Events\]/i.test(item))) || "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
  const fields = formatLine.replace(/^Format\s*:/i, "").split(",").map((field) => field.trim().toLowerCase());
  const startIndex = fields.indexOf("start");
  const endIndex = fields.indexOf("end");
  const textIndex = fields.indexOf("text");
  if (startIndex < 0 || endIndex < 0 || textIndex < 0) return [];
  return normalizeCues(lines.filter((line) => /^Dialogue\s*:/i.test(line)).map((line) => {
    const values = line.replace(/^Dialogue\s*:/i, "").split(",");
    const textValue = values.slice(textIndex).join(",");
    return {
      startMs: parseAssTimestamp(values[startIndex]),
      endMs: parseAssTimestamp(values[endIndex]),
      text: textValue.replace(/\\N/g, "\n"),
    };
  }));
}

export function parseSubtitleText(text, fileName = "") {
  if (/\.ass$/i.test(fileName)) return parseAss(text);
  return parseSrtOrVtt(text);
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function decodePremiereBinaryText(value) {
  if (typeof atob !== "function") return "";
  try {
    const bytes = atob(String(value || "").replace(/\s+/g, ""));
    return Array.from(bytes, (character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126 ? character : " ";
    }).join("");
  } catch {
    return "";
  }
}

function namedPremiereKeyframe(source, name) {
  const blocks = String(source || "").match(/<(?:PointComponentParam|VideoComponentParam)\b[\s\S]*?<\/(?:PointComponentParam|VideoComponentParam)>/gi) || [];
  const escapedName = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = blocks.find((item) => new RegExp(`<Name>\\s*${escapedName}\\s*<\\/Name>`, "i").test(item));
  return block?.match(/<StartKeyframe>([\s\S]*?)<\/StartKeyframe>/i)?.[1]?.trim() || "";
}

function numberFromKeyframe(value) {
  const match = String(value || "").match(/,\s*(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function likelyPremiereFont(binaryText) {
  const candidates = [...new Set(String(binaryText || "").match(/[A-Za-z][A-Za-z0-9 _.-]{2,80}/g) || [])]
    .map((item) => item.replace(/\s{2,}[A-Za-z]\s*$/, "").trim())
    .filter((item) => /[A-Za-z]/.test(item))
    .filter((item) => !/^(?:Premiere|Adobe|Project|Default|true|false|null|undefined)$/i.test(item));
  return candidates.find((item) => /(?:font|hei|song|kai|yuan|fang|gothic|medium|regular|bold|light|sc|tc|vf[-_])/i.test(item)) || "";
}

export function normalizePremiereFontName(value) {
  const name = String(value || "").trim();
  if (!name || [
    "Alimama FangYuanTi VF",
    "Alimama FangYuanTi VF Medium",
    "AlimamaFangYuanTiVF-Medium",
    "AlimamaFangYuanTiVF-Medium.ttf",
    "阿里妈妈方圆体 VF",
  ].includes(name)) return PREMIERE_FONT_FAMILY;
  return name;
}

export function parsePremiereTextStyle(source, fileName = "") {
  const text = String(source || "");
  if (!/<PremiereData\b/i.test(text) || !/<StyleProjectItem\b/i.test(text)) {
    throw new Error("这不是可识别的 Premiere 文字样式文件");
  }
  const styleBlock = text.match(/<StyleProjectItem\b[\s\S]*?<\/StyleProjectItem>/i)?.[0] || text;
  const styleName = decodeXmlText(styleBlock.match(/<ProjectItem\b[\s\S]*?<Name>([\s\S]*?)<\/Name>/i)?.[1])
    || decodeXmlText(styleBlock.match(/<Name>([\s\S]*?)<\/Name>/i)?.[1])
    || String(fileName || "PR 文字样式").replace(/\.prtextstyle$/i, "");
  const binaryText = [...text.matchAll(/<StartKeyframeValue\b[^>]*\bEncoding=["']base64["'][^>]*>([\s\S]*?)<\/StartKeyframeValue>/gi)]
    .map((match) => decodePremiereBinaryText(match[1]))
    .join("\n");
  const fontName = normalizePremiereFontName(likelyPremiereFont(binaryText));
  const position = namedPremiereKeyframe(text, "位置").match(/,\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)/);
  const horizontalPosition = position ? Number(position[1]) * 100 : null;
  const verticalPosition = position ? Number(position[2]) * 100 : null;
  const scale = numberFromKeyframe(namedPremiereKeyframe(text, "缩放"));
  const opacity = numberFromKeyframe(namedPremiereKeyframe(text, "不透明度"));
  const frameSize = text.match(/<FrameSize>\s*([^<]+?)\s*<\/FrameSize>/i)?.[1]?.split(",").map((item) => Number(item.trim())) || [];
  const legacyCanvas = frameSize.length >= 4 && frameSize.slice(2, 4).every(Number.isFinite)
    ? { width: frameSize[2], height: frameSize[3] }
    : null;
  const recognizedFields = ["样式名称"];
  if (fontName) recognizedFields.push("字体名称");
  if (horizontalPosition !== null && verticalPosition !== null) recognizedFields.push("文字位置");
  if (scale !== null) recognizedFields.push("缩放");
  if (opacity !== null) recognizedFields.push("不透明度");
  if (legacyCanvas) recognizedFields.push("样式画布");
  return {
    sourceFormat: "Premiere .prtextstyle",
    sourceFileName: fileName || "",
    styleName,
    fontName,
    horizontalPosition,
    verticalPosition,
    scale,
    opacity,
    legacyCanvas,
    recognizedFields,
  };
}

export function formatSubtitleTime(milliseconds, separator = ",") {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function formatSrt(cues) {
  return normalizeCues(cues).map((cue, index) => `${index + 1}\n${formatSubtitleTime(cue.startMs)} --> ${formatSubtitleTime(cue.endMs)}\n${cue.text}`).join("\n\n") + "\n";
}

export function cuesFromShots(shots, frameRate = 25) {
  let cursor = 0;
  const cues = [];
  for (const shot of shots || []) {
    const text = cleanCueText(shot.dialogue);
    const durationMatch = String(shot.duration || "").match(/[\d.]+/);
    const durationMs = Math.max(1000, Math.round((Number(durationMatch?.[0]) || 5) * 1000));
    if (text && text !== "无" && text !== "暂无") cues.push({ startMs: cursor, endMs: cursor + durationMs, text });
    cursor += durationMs;
  }
  return normalizeCues(cues).map((cue, index) => ({ ...cue, frame: Math.round((cue.startMs / 1000) * Number(frameRate || 25)), id: `shot-cue-${index + 1}` }));
}

export function normalizePremiereSettings(settings = {}, project = null) {
  const merged = { ...PREMIERE_DEFAULT_SETTINGS, ...(settings || {}) };
  const orientation = ["landscape", "portrait"].includes(merged.orientation) ? merged.orientation : "landscape";
  const frameRate = FRAME_RATES.reduce((closest, item) => Math.abs(item - Number(merged.frameRate)) < Math.abs(closest - Number(merged.frameRate)) ? item : closest, 25);
  return {
    ...merged,
    sequenceName: String(merged.sequenceName || project?.name || "字幕序列").trim() || "字幕序列",
    frameRate,
    ntsc: Boolean(merged.ntsc),
    width: Math.round(clampNumber(merged.width, 320, 8192, 1882)),
    height: Math.round(clampNumber(merged.height, 240, 8192, 1080)),
    orientation,
    fontName: normalizePremiereFontName(merged.fontName),
    fontWeight: Math.round(clampNumber(merged.fontWeight, 100, 900, 500)),
    fontSize: clampNumber(merged.fontSize, 8, 300, orientation === "portrait" ? 90 : 60),
    scaleX: clampNumber(merged.scaleX, 75, 125, 98),
    textColor: /^#[0-9a-f]{6}$/i.test(merged.textColor) ? merged.textColor : "#ffffff",
    horizontalPosition: clampNumber(merged.horizontalPosition, 0, 100, 50),
    verticalPosition: clampNumber(merged.verticalPosition, 0, 100, 90),
    strokeWidth: clampNumber(merged.strokeWidth, 0, 100, 1.8),
    strokeColor: /^#[0-9a-f]{6}$/i.test(merged.strokeColor) ? merged.strokeColor : "#000000",
    shadowWidth: clampNumber(merged.shadowWidth, 0, 20, 2),
    shadowOpacity: clampNumber(merged.shadowOpacity, 0, 100, 85),
    shadowColor: /^#[0-9a-f]{6}$/i.test(merged.shadowColor) ? merged.shadowColor : "#000000",
    alignment: ["left", "center", "right"].includes(merged.alignment) ? merged.alignment : "center",
    backgroundOpacity: clampNumber(merged.backgroundOpacity, 0, 100, 0),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(merged.backgroundColor) ? merged.backgroundColor : "#000000",
  };
}

export function settingsForOrientation(settings = {}, orientation = "landscape", project = null) {
  const preset = PREMIERE_ORIENTATION_PRESETS[orientation] || PREMIERE_ORIENTATION_PRESETS.landscape;
  return normalizePremiereSettings({ ...settings, ...preset, orientation }, project);
}

export function detectVideoMetadata(file) {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !file) return resolve({ width: 0, height: 0, orientation: "landscape" });
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = (width, height) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve({
        width: Math.round(Number(width) || 0),
        height: Math.round(Number(height) || 0),
        orientation: Number(height) > Number(width) ? "portrait" : "landscape",
      });
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => cleanup(video.videoWidth, video.videoHeight);
    video.onerror = () => cleanup(0, 0);
    video.src = url;
  });
}

export function detectVideoOrientation(file) {
  return detectVideoMetadata(file).then((metadata) => metadata.orientation);
}

function createEffectParameter({ parameterid, name, value, valuemin, valuemax, valuelist }) {
  let content = xmlTag("parameterid", parameterid) + xmlTag("name", name);
  if (valuemin !== undefined) content += xmlTag("valuemin", valuemin);
  if (valuemax !== undefined) content += xmlTag("valuemax", valuemax);
  if (valuelist) {
    content += xmlTag("valuelist", valuelist.map((item) => xmlTag("valueentry", xmlTag("name", item.name) + xmlTag("value", item.value))).join(""));
  }
  if (value !== undefined) {
    if (value === null) content += xmlTag("value");
    else if (typeof value === "object") content += xmlTag("value", Object.entries(value).map(([key, item]) => xmlTag(key, item)).join(""));
    else content += xmlTag("value", value);
  }
  return xmlTag("parameter", content);
}

function effectForCue(cue, settings) {
  const alignment = { left: "1", center: "2", right: "3" }[settings.alignment] || "2";
  const parameters = [
    createEffectParameter({ parameterid: "part1", name: "Text Settings", value: null }),
    createEffectParameter({ parameterid: "str", name: "Text", value: cue.text }),
    createEffectParameter({ parameterid: "font", name: "Font", value: settings.fontName }),
    createEffectParameter({ parameterid: "align", name: "Alignment", valuemin: "1", valuemax: "3", valuelist: [{ name: "Left", value: "1" }, { name: "Center", value: "2" }, { name: "Right", value: "3" }], value: alignment }),
    createEffectParameter({ parameterid: "size", name: "Size", valuemin: "0", valuemax: "200", value: numberText((settings.fontSize * 480) / settings.height) }),
    createEffectParameter({ parameterid: "aspect", name: "Aspect", valuemin: "0", valuemax: "4", value: numberText((Number(settings.scaleX) || 100) / 100) }),
    createEffectParameter({ parameterid: "linewidth", name: "Line Width", valuemin: "0", valuemax: "200", value: numberText((settings.strokeWidth * 480) / settings.height) }),
    createEffectParameter({ parameterid: "center", name: "Center", value: { horiz: numberText((settings.horizontalPosition - 50) / 100), vert: numberText((settings.verticalPosition - 50) / 100) } }),
    createEffectParameter({ parameterid: "textcolor", name: "Text Color", value: hexToRgb(settings.textColor) }),
    createEffectParameter({ parameterid: "supertext", name: "Text Graphic" }),
    createEffectParameter({ parameterid: "linecolor", name: "Line Color", value: hexToRgb(settings.strokeColor) }),
    createEffectParameter({ parameterid: "superline", name: "Line Graphic" }),
    createEffectParameter({ parameterid: "part2", name: "Background Settings" }),
    createEffectParameter({ parameterid: "xscale", name: "Horizontal Size", valuemin: "0", valuemax: "200", value: "0" }),
    createEffectParameter({ parameterid: "yscale", name: "Vertical Size", valuemin: "0", valuemax: "200", value: "0" }),
    createEffectParameter({ parameterid: "xoffset", name: "Horizontal Offset", valuemin: "-100", valuemax: "100", value: "0" }),
    createEffectParameter({ parameterid: "yoffset", name: "Vertical Offset", valuemin: "-100", valuemax: "100", value: "0" }),
    createEffectParameter({ parameterid: "backsoft", name: "Back Soft", valuemin: "0", valuemax: "100", value: "0" }),
    createEffectParameter({ parameterid: "backopacity", name: "Back Opacity", valuemin: "0", valuemax: "100", value: settings.backgroundOpacity }),
    createEffectParameter({ parameterid: "backcolor", name: "Back Color", value: hexToRgb(settings.backgroundColor) }),
    createEffectParameter({ parameterid: "superback", name: "Back Graphic" }),
    createEffectParameter({ parameterid: "crop", name: "Crop", value: "false" }),
    createEffectParameter({ parameterid: "autokern", name: "Auto Kerning", value: "true" }),
  ];
  return xmlTag("effect", xmlTag("name", "Outline Text") + xmlTag("effectid", "Outline Text") + xmlTag("effectcategory", "Text") + xmlTag("effecttype", "generator") + xmlTag("mediatype", "video") + parameters.join(""));
}

function generatorItem(cue, index, settings) {
  const start = Math.round((cue.startMs / 1000) * settings.frameRate);
  const end = Math.max(start + 1, Math.round((cue.endMs / 1000) * settings.frameRate));
  const id = `Subtitle ${index + 1}`;
  const content = xmlTag("name", `Subtitle(${cue.text})`)
    + xmlTag("duration", end - start)
    + xmlTag("rate", xmlTag("timebase", numberText(settings.frameRate)) + xmlTag("ntsc", settings.ntsc ? "true" : "false"))
    + xmlTag("start", start)
    + xmlTag("end", end)
    + xmlTag("in", start)
    + xmlTag("out", end)
    + xmlTag("enabled", "true")
    + xmlTag("anamorphic", "false")
    + xmlTag("alphatype", "black")
    + xmlTag("masterclipid", id)
    + effectForCue(cue, settings)
    + xmlTag("sourcetrack", xmlTag("mediatype", "video"));
  return xmlTag("generatoritem", content, { id });
}

export function buildPremiereXml(project, cues, settings = {}) {
  const normalizedSettings = normalizePremiereSettings(settings, project);
  const normalizedCues = normalizeCues(cues);
  if (!normalizedCues.length) throw new Error("没有可导出的字幕，请先上传 SRT、VTT 或 ASS 文件");
  const totalFrames = Math.max(...normalizedCues.map((cue) => Math.round((cue.endMs / 1000) * normalizedSettings.frameRate)), 1);
  const sampleCharacteristics = xmlTag("samplecharacteristics",
    xmlTag("width", normalizedSettings.width)
      + xmlTag("height", normalizedSettings.height)
      + xmlTag("anamorphic", normalizedSettings.anamorphic ? "true" : "false")
      + xmlTag("pixelaspectratio", normalizedSettings.pixelAspectRatio)
      + xmlTag("fielddominance", normalizedSettings.fieldDominance));
  const track = xmlTag("track", normalizedCues.map((cue, index) => generatorItem(cue, index, normalizedSettings)).join(""));
  const video = xmlTag("video", xmlTag("format", sampleCharacteristics) + track);
  const sequence = xmlTag("sequence",
    xmlTag("name", normalizedSettings.sequenceName)
      + xmlTag("duration", totalFrames)
      + xmlTag("rate", xmlTag("timebase", numberText(normalizedSettings.frameRate)) + xmlTag("ntsc", normalizedSettings.ntsc ? "true" : "false"))
      + xmlTag("media", video),
    { id: "Subtitle Sequence" });
  return `<?xml version="1.0" encoding="utf-8"?>${xmlTag("xmeml", sequence, { version: "5" })}`;
}

function subtitleWidthUnits(value) {
  return Array.from(String(value || "")).reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.35;
    if (/[A-Za-z0-9]/.test(character)) return total + 0.55;
    return total + 1;
  }, 0);
}

function subtitleTokens(value) {
  const text = String(value || "");
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return Array.from(text);
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const tokens = [];
  for (const part of segmenter.segment(text)) {
    const token = part.segment;
    if (!token) continue;
    if (tokens.length && !part.isWordLike) tokens[tokens.length - 1] += token;
    else tokens.push(token);
  }
  return tokens;
}

function splitSubtitleText(value, maximumUnits) {
  const paragraphs = String(value || "")
    .replace(/\r/g, "")
    .replace(/\\N/g, "\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const segments = [];
  for (const paragraph of paragraphs) {
    const tokens = subtitleTokens(paragraph);
    let segment = "";
    let width = 0;
    for (let index = 0; index < tokens.length;) {
      let token = tokens[index];
      const nextToken = tokens[index + 1];
      if (/^[\u4e00-\u9fff]{2}$/.test(token) && /^[\u4e00-\u9fff]{2}$/.test(nextToken || "") && subtitleWidthUnits(`${token}${nextToken}`) <= maximumUnits) {
        token += nextToken;
        index += 2;
      } else {
        index += 1;
      }
      const tokenWidth = subtitleWidthUnits(token);
      if (segment && width + tokenWidth > maximumUnits) {
        segments.push(segment.trim());
        segment = "";
        width = 0;
      }
      if (tokenWidth > maximumUnits) {
        for (const character of Array.from(token)) {
          const characterWidth = subtitleWidthUnits(character);
          if (segment && width + characterWidth > maximumUnits) {
            segments.push(segment.trim());
            segment = "";
            width = 0;
          }
          segment += character;
          width += characterWidth;
        }
      } else {
        segment += token;
        width += tokenWidth;
      }
    }
    if (segment.trim()) segments.push(segment.trim());
  }
  return segments.filter(Boolean);
}

function splitCueForAss(cue, settings) {
  const maximumUnits = Math.max(6, (settings.width * 0.82) / settings.fontSize);
  const segments = splitSubtitleText(cue.text, maximumUnits);
  if (segments.length <= 1) return [{ ...cue, text: String(cue.text || "").replace(/[{}]/g, "").trim() }];
  const duration = Math.max(1, cue.endMs - cue.startMs);
  const timedWords = normalizeTimedWords(cue.words);
  if (timedWords.length) {
    const groups = [];
    let group = [];
    let groupWidth = 0;
    for (const word of timedWords) {
      const wordWidth = subtitleWidthUnits(word.text);
      if (group.length && groupWidth + wordWidth > maximumUnits) {
        groups.push(group);
        group = [];
        groupWidth = 0;
      }
      group.push(word);
      groupWidth += wordWidth;
    }
    if (group.length) groups.push(group);
    if (groups.length > 1) {
      let cursor = cue.startMs;
      return groups.map((words, index) => {
        const startMs = index === 0 ? cue.startMs : Math.max(cursor, words[0].startMs);
        const endMs = index === groups.length - 1
          ? cue.endMs
          : Math.max(startMs + 1, Math.min(cue.endMs, words[words.length - 1].endMs));
        cursor = endMs;
        return {
          startMs,
          endMs,
          text: words.map((word) => word.text).join("").replace(/[{}]/g, ""),
          words,
        };
      });
    }
  }

  // Imported SRT files do not carry word timestamps. Use text width for a stable
  // fallback instead of equal-duration chunks, which visibly drifts from speech.
  const weights = segments.map((text) => Math.max(1, subtitleWidthUnits(text)));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let elapsedWeight = 0;
  return segments.map((text, index) => {
    const startMs = index === 0 ? cue.startMs : Math.round(cue.startMs + (duration * elapsedWeight) / totalWeight);
    elapsedWeight += weights[index];
    const endMs = index === segments.length - 1
      ? cue.endMs
      : Math.max(startMs + 1, Math.round(cue.startMs + (duration * elapsedWeight) / totalWeight));
    return { startMs, endMs, text: text.replace(/[{}]/g, "") };
  });
}

function mergeAdjacentSubtitleCues(cues) {
  const merged = [];
  for (const cue of cues) {
    const previous = merged[merged.length - 1];
    const gap = previous ? cue.startMs - previous.endMs : Infinity;
    const previousText = String(previous?.text || "").trim();
    const currentText = String(cue.text || "").trim();
    const canMerge = previous
      && gap >= 0
      && gap <= 80
      && previousText
      && currentText
      && !/[。！？!?；;]$/.test(previousText)
      && !/^[。！？!?；;]/.test(currentText);
    if (canMerge) {
      previous.endMs = cue.endMs;
      previous.text = `${previousText}${currentText}`;
      previous.words = [...(previous.words || []), ...(cue.words || [])];
    } else {
      merged.push({ ...cue });
    }
  }
  return merged;
}

export function buildAss(cues, settings = {}) {
  const normalized = normalizePremiereSettings(settings);
  const renderFontName = normalized.fontName === PREMIERE_FONT_FAMILY
    ? PREMIERE_RENDER_FONT_FAMILY
    : normalized.fontName;
  const color = (hex, alpha = "00") => {
    const { red, green, blue } = hexToRgb(hex);
    return `&H${alpha}${blue.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${red.toString(16).padStart(2, "0")}`.toUpperCase();
  };
  const alphaHex = (opacity) => Math.round(255 - (clampNumber(opacity, 0, 100, 50) * 2.55)).toString(16).padStart(2, "0").toUpperCase();
  const alignment = { left: 1, center: 2, right: 3 }[normalized.alignment] || 2;
  // Premiere's Medium instance renders slightly lighter through libass than in the
  // client export. Keep the exact PR font name, but use renderer-side emphasis only
  // for the built-in client font so the burn-in matches the supplied reference.
  const rendererBold = normalized.fontName === PREMIERE_FONT_FAMILY ? 1 : 0;
  const marginV = Math.max(0, Math.round(normalized.height * (100 - normalized.verticalPosition) / 100));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${normalized.width}`,
    `PlayResY: ${normalized.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${renderFontName},${normalized.fontSize},${color(normalized.textColor)},${color(normalized.textColor)},${color(normalized.strokeColor)},${color(normalized.shadowColor, alphaHex(normalized.shadowOpacity))},${rendererBold},0,0,0,${normalized.scaleX},100,0,0,1,${normalized.strokeWidth},${normalized.shadowWidth},${alignment},40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const assTime = (milliseconds) => formatSubtitleTime(milliseconds, ".").replace(/\.(\d{3})$/, (_, value) => `.${value.slice(0, 2)}`);
  const events = mergeAdjacentSubtitleCues(normalizeCues(cues))
    .flatMap((cue) => splitCueForAss(cue, normalized))
    .map((cue) => `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${cue.text}`);
  return `${header.join("\n")}\n${events.join("\n")}\n`;
}

function downloadBlob(blob, filename, { onReady = null } = {}) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof onReady === "function") {
    onReady({ url, filename, size: blob.size });
  } else {
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  }
  return { url, filename, size: blob.size };
}

function packageReadme(project, settings, cues, fontFile, textStyleFile, textStyleMeta) {
  return [
    `${project?.name || settings.sequenceName} · Premiere 字幕导入包`,
    "",
    "使用方式：",
    "1. 在 Premiere Pro 中选择“文件 > 导入”，导入 01_导入文件夹中的 XML。",
    "2. XML 会生成可编辑的字幕图形序列，字体、字号、颜色、描边和位置已经写入。",
    "3. 如需原生字幕轨道，同时导入同目录下的 SRT；ASS 文件是带样式参数的备用文件。",
    "4. Premiere 使用的字体名称必须与本机已安装字体名称一致；字体文件放在 02_字体 文件夹。",
    "",
    `字幕条数：${cues.length}`,
    `字体：${settings.fontName}`,
    `画幅：${settings.width} × ${settings.height}`,
    `帧率：${settings.frameRate}`,
    `字体文件：${fontFile ? fontFile.name : "未附带，使用本机同名字体"}`,
    `PR 文字样式：${textStyleFile ? textStyleFile.name : "未附带"}`,
    textStyleMeta?.recognizedFields?.length ? `已识别参数：${textStyleMeta.recognizedFields.join("、")}` : "",
    textStyleFile ? "原始 .prtextstyle 已保存在 02_参数/原始样式/，可在 Premiere 中继续使用。" : "",
    "",
    "本包转换器参考 MIT 许可的 PEKORA 项目（https://github.com/yf-dev/pekora）。",
  ].join("\n");
}

export async function exportPremierePackage({ project, cues, settings, fontFile = null, textStyleFile = null, textStyleMeta = null, referenceFiles = [], onDownloadReady = null }) {
  const normalizedSettings = normalizePremiereSettings({
    ...settings,
    fontName: textStyleMeta?.fontName || settings.fontName,
  }, project);
  const normalizedCues = normalizeCues(cues);
  if (!normalizedCues.length) throw new Error("没有可导出的字幕，请先上传字幕文件或从当前分镜生成台词");
  const baseName = safeFilename(project?.name || normalizedSettings.sequenceName);
  const xml = buildPremiereXml(project, normalizedCues, normalizedSettings);
  const zip = new JSZip();
  const root = `${baseName}_PR字幕导入`;
  zip.folder(root).file("01_导入文件/字幕图形.xml", xml);
  zip.folder(root).file("01_导入文件/字幕原文.srt", formatSrt(normalizedCues));
  zip.folder(root).file("01_导入文件/字幕样式.ass", buildAss(normalizedCues, normalizedSettings));
  zip.folder(root).file("02_参数/字幕参数.json", JSON.stringify({ formatVersion: "1.1", project, settings: normalizedSettings, cueCount: normalizedCues.length, premiereTextStyle: textStyleMeta || null }, null, 2));
  if (textStyleFile) zip.folder(root).file(`02_参数/原始样式/${safeFilename(textStyleFile.name)}`, await textStyleFile.arrayBuffer());
  if (fontFile) zip.folder(root).file(`02_字体/${safeFilename(fontFile.name)}`, await fontFile.arrayBuffer());
  for (const file of referenceFiles || []) zip.folder(root).file(`02_参数/参考文件/${safeFilename(file.name)}`, await file.arrayBuffer());
  zip.file(`${root}/README.txt`, packageReadme(project, normalizedSettings, normalizedCues, fontFile, textStyleFile, textStyleMeta));
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${root}.zip`, { onReady: onDownloadReady });
  return { filename: `${root}.zip`, cueCount: normalizedCues.length };
}

export async function exportPremiereBatchPackage({ items, settings, fontFile = null, textStyleFile = null, textStyleMeta = null, referenceFiles = [], onDownloadReady = null }) {
  const validItems = (items || []).filter((item) => Array.isArray(item.cues) && item.cues.length);
  if (!validItems.length) throw new Error("没有可导出的字幕结果");
  const zip = new JSZip();
  const root = "批量字幕_PR导入包";
  for (const [index, item] of validItems.entries()) {
    const project = { id: item.id || `video-${index + 1}`, name: item.name || `视频_${String(index + 1).padStart(2, "0")}` };
    const orientation = item.videoFile ? await detectVideoOrientation(item.videoFile) : settings.orientation;
    const normalizedSettings = settingsForOrientation({
      ...settings,
      sequenceName: project.name,
      fontName: textStyleMeta?.fontName || settings.fontName,
    }, orientation, project);
    const normalizedCues = normalizeCues(item.cues);
    const folder = `${root}/${String(index + 1).padStart(2, "0")}_${safeFilename(project.name)}`;
    zip.folder(folder).file("01_导入文件/字幕图形.xml", buildPremiereXml(project, normalizedCues, normalizedSettings));
    zip.folder(folder).file("01_导入文件/字幕原文.srt", formatSrt(normalizedCues));
    zip.folder(folder).file("01_导入文件/字幕样式.ass", buildAss(normalizedCues, normalizedSettings));
    zip.folder(folder).file("02_参数/字幕参数.json", JSON.stringify({ formatVersion: "1.1", project, settings: normalizedSettings, cueCount: normalizedCues.length, premiereTextStyle: textStyleMeta || null }, null, 2));
    if (textStyleFile) zip.folder(folder).file(`02_参数/原始样式/${safeFilename(textStyleFile.name)}`, await textStyleFile.arrayBuffer());
    if (fontFile) zip.folder(folder).file(`02_字体/${safeFilename(fontFile.name)}`, await fontFile.arrayBuffer());
    for (const file of referenceFiles || []) zip.folder(folder).file(`02_参数/参考文件/${safeFilename(file.name)}`, await file.arrayBuffer());
    zip.file(`${folder}/README.txt`, packageReadme(project, normalizedSettings, normalizedCues, fontFile, textStyleFile, textStyleMeta));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${root}.zip`, { onReady: onDownloadReady });
  return { filename: `${root}.zip`, itemCount: validItems.length, cueCount: validItems.reduce((total, item) => total + item.cues.length, 0) };
}

export async function exportSubtitleSrtBatch({ items, onDownloadReady = null }) {
  const validItems = (items || []).filter((item) => Array.isArray(item.cues) && item.cues.length);
  if (!validItems.length) throw new Error("没有可导出的字幕结果");
  const zip = new JSZip();
  const root = "批量字幕文件";
  const usedNames = new Set();
  for (const [index, item] of validItems.entries()) {
    const base = safeFilename(item.name || `视频_${String(index + 1).padStart(2, "0")}`);
    let fileName = `${base}.srt`;
    let suffix = 2;
    while (usedNames.has(fileName)) fileName = `${base}_${suffix++}.srt`;
    usedNames.add(fileName);
    zip.file(`${root}/${fileName}`, formatSrt(item.cues));
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  downloadBlob(blob, `${root}.zip`, { onReady: onDownloadReady });
  return { filename: `${root}.zip`, itemCount: validItems.length, cueCount: validItems.reduce((total, item) => total + item.cues.length, 0) };
}

export async function exportRenderedVideoBatch({ items, settings, textStyleMeta = null, renderVideo, saveVideo, onProgress }) {
  if (!items?.length || items.some((item) => !item.videoFile || !item.cues?.length)) {
    throw new Error("请先为每个视频匹配有效字幕，再导出成片");
  }
  const outputNames = items.map((item) => subtitleOutputFilename(item.videoFile.name));
  if (new Set(outputNames.map((name) => name.toLowerCase())).size !== outputNames.length) {
    throw new Error("上传的视频存在同名成片，无法保持原文件名；请先调整重复文件名");
  }
  const successes = [];
  const failures = [];
  for (const [index, item] of items.entries()) {
    const project = { id: item.id || `video-${index + 1}`, name: item.name || `视频_${String(index + 1).padStart(2, "0")}` };
    const filename = outputNames[index];
    try {
      const orientation = await detectVideoOrientation(item.videoFile);
      const normalizedSettings = settingsForOrientation({
        ...settings,
        sequenceName: project.name,
        fontName: textStyleMeta?.fontName || settings.fontName,
      }, orientation, project);
      const result = await renderVideo(item, normalizedSettings, filename);
      await saveVideo(result, filename);
      successes.push({ item, filename });
      onProgress?.(index + 1, items.length, item, null, filename);
    } catch (error) {
      const message = error?.message || "成片生成失败";
      failures.push({ item, filename, error: message });
      onProgress?.(index + 1, items.length, item, message, filename);
    }
  }
  return { successes, failures, itemCount: items.length };
}

export function downloadPremiereXml(project, cues, settings = {}, options = {}) {
  const normalizedSettings = normalizePremiereSettings(settings, project);
  const baseName = safeFilename(project?.name || normalizedSettings.sequenceName);
  const xml = buildPremiereXml(project, cues, normalizedSettings);
  downloadBlob(new Blob([xml], { type: "application/xml;charset=utf-8" }), `${baseName}_字幕图形.xml`, options);
}

export function downloadSubtitleSrt(project, cues, options = {}) {
  const baseName = safeFilename(project?.name || "视频字幕");
  downloadBlob(new Blob([formatSrt(cues)], { type: "text/plain;charset=utf-8" }), `${baseName}_字幕.srt`, options);
}
