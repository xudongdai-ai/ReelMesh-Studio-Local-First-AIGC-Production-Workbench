import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TEST_PASSWORDS } from "./test-credentials.mjs";

const testDataDir = await mkdtemp(join(tmpdir(), "hjsc-image-test-"));
process.env.HJSC_DATA_DIR = testDataDir;
process.env.HJSC_ALLOW_LOOPBACK_IMAGE = "1";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let generationRequests = [];
const mockServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === "POST" && req.url === "/v1/images/generations") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    generationRequests.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: Array.from({ length: body.n || 1 }, () => ({ b64_json: pixel })) }));
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const { db, run } = await import("../server/database.mjs");
const { hashPassword, nowIso } = await import("../server/auth.mjs");
const { startServer, stopServer } = await import("../server/index.mjs");
const now = nowIso();
run(`INSERT INTO accounts (id,account,password_hash,name,role,status,approval_status,joined_at,created_at,updated_at)
  VALUES ('developer-image','developer-image',:passwordHash,'图片验证账号','developer','离线','approved',:joinedAt,:createdAt,:updatedAt)`, {
  passwordHash: hashPassword(TEST_PASSWORDS.image), joinedAt: now, createdAt: now, updatedAt: now,
});
run(`INSERT INTO projects (id,org_id,name,type,aspect_ratio,style,description,stage,progress,owner_user_id,owner_id,created_at,updated_at)
  VALUES ('project-image',NULL,'图片工作流验证','短片','16:9','写实电影感','','项目筹备',0,'developer-image','developer-image',:createdAt,:updatedAt)`, { createdAt: now, updatedAt: now });

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockPort = mockServer.address().port;
const address = await startServer({ port: 0, host: "127.0.0.1" });
const apiBase = `http://127.0.0.1:${address.port}`;
let token = "";

async function request(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

try {
  const corsCheck = await fetch(`${apiBase}/api/health`, { headers: { Origin: "null" } });
  assert.equal(corsCheck.headers.get("access-control-allow-origin"), "null");
  assert.equal(corsCheck.headers.get("access-control-allow-credentials"), "true");
  const login = await request("POST", "/api/auth/login", { role: "developer", account: "developer-image", password: TEST_PASSWORDS.image });
  token = login.token;
  const workspace = await request("GET", "/api/workspace");
  const template = workspace.skillTemplates.find((item) => item.key === "image_prompt_director");
  assert.ok(template, "图片提示词规范未初始化");
  const weddingTemplate = workspace.skillTemplates.find((item) => item.key === "wedding_image");
  assert.ok(weddingTemplate, "婚礼影像生图规范未初始化");
  const connection = await request("PATCH", "/api/image/connection", {
    endpointUrl: `http://127.0.0.1:${mockPort}`,
    modelName: "gpt-image-2.5-sunburst",
  });
  assert.equal(connection.connection.status, "已连接");
  const workflow = await request("POST", "/api/image-workflows", {
    projectId: "project-image",
    templateId: template.id,
    assetName: "雨夜人物",
    archiveCategory: "人物",
    aspectRatio: "3:4",
    count: 4,
    request: "人物：二十岁男主，黑色短发\n服装：深灰旧战袍\n场景：深夜雨巷\n动作：侧身回头",
  });
  assert.equal(workflow.imageTasks.length, 1);
  assert.equal(workflow.imageTasks[0].status, "待审核");
  assert.equal(workflow.imageTasks[0].results.length, 4);
  assert.equal(workflow.workflow.variants[0].extraction["人物"][0], "二十岁男主，黑色短发");
  const imageResponse = await fetch(`${apiBase}${workflow.imageTasks[0].results[0].thumb}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(imageResponse.status, 200);
  const retry = await request("POST", `/api/image-tasks/${workflow.imageTasks[0].id}/retry`);
  assert.equal(retry.imageTask.status, "待审核");
  assert.equal(retry.imageTask.results.length, 8);
  const approved = await request("POST", `/api/image-tasks/${workflow.imageTasks[0].id}/approve`, { resultId: retry.imageTask.results[0].id });
  assert.equal(approved.imageTask.status, "已通过");
  assert.equal(approved.asset.status, "已通过");
  const wedding = await request("POST", "/api/image-workflows", {
    projectId: "project-image",
    templateId: weddingTemplate.id,
    assetName: "婚礼重点分镜",
    archiveCategory: "分镜静帧",
    aspectRatio: "16:9",
    count: 3,
    request: "【婚礼真实资料】\n新人：林澈与周宁\n婚期：2026 年 10 月\n相识与经历：大学社团认识\n重要片段：雨天共撑一把伞\n家人与朋友：双方父母和大学好友\n明确避开：不出现未确认的亲友\n【本步镜头要求】\n场景：黄昏草坪仪式\n服装：白色婚纱与深色西装\n动作：交换戒指",
  });
  assert.equal(wedding.imageTasks[0].results.length, 3);
  assert.equal(wedding.workflow.variants[0].extraction["婚礼事实"].length, 6);
  assert.equal(wedding.workflow.variants[0].extraction["人物"][0], "林澈与周宁");
  assert.equal(wedding.workflow.variants[0].extraction["场景"][0], "黄昏草坪仪式");
  assert.match(wedding.workflow.variants[0].prompt, /婚礼事实与隐私边界/);
  assert.equal(generationRequests.length, 11);
  assert.ok(generationRequests.every((item) => item.n === 1));
  assert.equal(generationRequests[0].output_format, "png");
  assert.equal("response_format" in generationRequests[0], false);
  assert.equal("negative_prompt" in generationRequests[0], false);
  assert.equal(generationRequests[0].size, "1152x1536");
  assert.equal(generationRequests[2].n, 1);
  console.log(JSON.stringify({ ok: true, extracted: workflow.workflow.variants[0].extraction, weddingExtracted: wedding.workflow.variants[0].extraction, firstRunResults: 4, afterRetryResults: retry.imageTask.results.length, weddingResults: 3, approvedAsset: true }, null, 2));
} finally {
  await stopServer();
  await new Promise((resolve) => mockServer.close(resolve));
  db.close();
  await rm(testDataDir, { recursive: true, force: true });
}
