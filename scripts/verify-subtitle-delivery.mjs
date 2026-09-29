import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { once } from "node:events";
import test from "node:test";
import { matchSubtitleBatch } from "../src/shared/subtitle-batch.js";
import { exportRenderedVideoBatch, subtitleOutputFilename } from "../src/shared/premiere.js";
import { createSubtitleExportSession, createSubtitleRenderIntent, renderSubtitleVideo } from "../server/transcription.mjs";

class Response extends PassThrough {
  status = 0;
  headers = {};
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); return this; }
}

async function invoke(handler, request, ...args) {
  const response = new Response();
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  const completed = once(response, "finish");
  await handler(request, response, ...args);
  await completed;
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
}

test("100 videos pair with 100 subtitles and flag the sole episode fallback", () => {
  const videos = Array.from({ length: 100 }, (_unused, index) => ({ name: `${index + 1}.mp4` }));
  const subtitles = Array.from({ length: 100 }, (_unused, index) => {
    const name = index === 42 ? "43.2.srt" : `${index + 1}.srt`;
    return { name: name.slice(0, -4), fileName: name, subtitleFile: { name }, cues: [{ text: "台词" }] };
  });
  const result = matchSubtitleBatch(videos, subtitles);
  assert.equal(result.items.length, 100);
  assert.equal(result.items.filter((item) => item.cues.length).length, 100);
  assert.equal(result.items.find((item) => item.fileName === "43.mp4").subtitleFile.name, "43.2.srt");
  assert.match(result.items.find((item) => item.fileName === "43.mp4").status, /按集数匹配/);
  assert.deepEqual(result.unmatchedSubtitles, []);
});

test("rendered MP4 names retain episode parts and the original video stem", async () => {
  for (const source of ["1.mp4", "2.mp4", "3.mp4", "39上.mp4", "39中.mp4", "39下.mp4", "39.1.mp4", "39.2.mp4", "王爷第39集（上）.mp4", "点石成金_39.3.MP4"]) {
    assert.equal(subtitleOutputFilename(source), source);
  }
  assert.equal(subtitleOutputFilename("王爷第39集（下）.mov"), "王爷第39集（下）.mp4");
  await assert.rejects(exportRenderedVideoBatch({
    items: ["1.mp4", "1.mov"].map((name) => ({ videoFile: { name }, cues: [{ text: "台词" }] })),
    settings: {}, renderVideo: async () => {}, saveVideo: async () => {},
  }), /同名成片/);
});

test("local render writes a completed MP4 into the chosen output folder", async (context) => {
  const ffmpeg = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";
  if (!existsSync(ffmpeg)) return context.skip("FFmpeg full not installed");
  process.env.HJSC_FFMPEG = ffmpeg;
  const work = await mkdtemp(join(tmpdir(), "hjsc-subtitle-delivery-"));
  try {
    const input = join(work, "source.mp4");
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:r=25:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", input]);
    const exportSession = await createSubtitleExportSession(work);
    const viewer = { id: "subtitle-test-user" };
    const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 240\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,2,10,10,25,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:00.30,Default,,0,0,0,,测试字幕\n`;
    const intent = await invoke(createSubtitleRenderIntent,
      Readable.from([Buffer.from(JSON.stringify({ ass, outputName: "source.mp4", destinationName: "王爷第39集（上）.mp4", width: 320, height: 240, exportSessionId: exportSession.id }))]), viewer);
    assert.equal(intent.status, 201);
    const { id } = JSON.parse(intent.body);
    const video = await readFile(input);
    const result = await invoke(renderSubtitleVideo, Readable.from([video]), { filesDir: work, renderId: id, viewer });
    assert.equal(result.status, 200);
    const saved = JSON.parse(result.body);
    assert.equal(saved.filename, "王爷第39集（上）.mp4");
    assert.equal(saved.path, join(exportSession.directory, "王爷第39集（上）.mp4"));
    assert.ok((await stat(saved.path)).size > 0);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
