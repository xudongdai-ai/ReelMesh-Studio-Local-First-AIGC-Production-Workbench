import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TEST_PASSWORDS, TEST_PROVIDER_KEY } from "./test-credentials.mjs";

const testDataDir = await mkdtemp(join(tmpdir(), "hjsc-h3-test-"));
process.env.HJSC_DATA_DIR = testDataDir;
process.env.HJSC_ALLOW_LOOPBACK_H3 = "1";

let submittedRequest = null;
let statusReads = 0;
const mockVideo = Buffer.from("mock-h3-mp4-content");
const mockServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.headers.authorization !== `Bearer ${TEST_PROVIDER_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "missing key" }));
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === "POST" && req.url === "/v1/videos") {
    submittedRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(202, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "mock-video-1", status: "queued" }));
  }
  if (req.method === "GET" && req.url === "/v1/videos/mock-video-1") {
    statusReads += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(statusReads === 1
      ? { id: "mock-video-1", status: "in_progress", progress: 42 }
      : { id: "mock-video-1", status: "completed" }));
  }
  if (req.method === "GET" && req.url === "/v1/videos/mock-video-1/content") {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    return res.end(mockVideo);
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockPort = mockServer.address().port;

const { db, all, one, run } = await import("../server/database.mjs");
const { hashPassword, nowIso } = await import("../server/auth.mjs");
const { startServer, stopServer } = await import("../server/index.mjs");
const now = nowIso();
run(`INSERT INTO accounts (id,account,password_hash,name,role,status,approval_status,joined_at,created_at,updated_at)
  VALUES ('developer-h3','developer-h3',:passwordHash,'H3 验证账号','developer','离线','approved',:joinedAt,:createdAt,:updatedAt)`, {
  passwordHash: hashPassword(TEST_PASSWORDS.h3),
  joinedAt: now,
  createdAt: now,
  updatedAt: now,
});
run(`INSERT INTO projects (id,org_id,name,type,aspect_ratio,style,description,stage,progress,owner_user_id,owner_id,created_at,updated_at)
  VALUES ('project-h3',NULL,'H3 接入验证','短片','16:9','写实','','项目筹备',0,'developer-h3','developer-h3',:createdAt,:updatedAt)`, {
  createdAt: now,
  updatedAt: now,
});

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
  const login = await request("POST", "/api/auth/login", { role: "developer", account: "developer-h3", password: TEST_PASSWORDS.h3 });
  token = login.token;
  const connection = await request("PATCH", "/api/h3/connection", {
    endpointUrl: `http://127.0.0.1:${mockPort}/v1`,
    modelName: "MiniMaxAI/MiniMax-H3",
    apiKey: TEST_PROVIDER_KEY,
  });
  assert.equal(connection.ok, true);
  assert.equal(connection.connection.status, "已连接");
  assert.equal(connection.connection.hasSessionKey, true);

  const created = await request("POST", "/api/h3/video-tasks", {
    projectId: "project-h3",
    name: "镜头 001",
    prompt: "雨夜街道，镜头缓慢推进，环境声与脚步声同步。",
    ratio: "16:9",
    durationSeconds: 5,
    seed: 1101,
  });
  assert.equal(created.imageTask.mediaKind, "video");
  assert.equal(created.imageTask.providerJobId, "mock-video-1");
  assert.equal(submittedRequest.task, "t2va");
  assert.equal(submittedRequest.target.short_edge, 768);
  assert.equal(submittedRequest.seconds, 5);

  const firstSync = await request("POST", `/api/h3/video-tasks/${created.imageTask.id}/sync`);
  assert.equal(firstSync.imageTask.status, "生成中");
  const secondSync = await request("POST", `/api/h3/video-tasks/${created.imageTask.id}/sync`);
  assert.equal(secondSync.imageTask.status, "已完成");
  assert.ok(secondSync.imageTask.outputUrl);

  const contentResponse = await fetch(`${apiBase}${secondSync.imageTask.outputUrl}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(contentResponse.status, 200);
  assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), mockVideo);

  const workspace = await request("GET", "/api/workspace");
  const savedTask = workspace.imageTasks.find((item) => item.id === created.imageTask.id);
  assert.equal(savedTask.status, "已完成");
  assert.equal(savedTask.results.length, 1);
  assert.equal(one("SELECT connection_status FROM provider_connections WHERE account_id = 'developer-h3'").connection_status, "已连接");

  const persistedText = JSON.stringify({
    connections: all("SELECT * FROM provider_connections"),
    jobs: all("SELECT provider_request_json,provider_response_json FROM generation_jobs"),
    audits: all("SELECT before_json,after_json FROM audit_logs"),
  });
  assert.equal(persistedText.includes(TEST_PROVIDER_KEY), false, "访问密钥不得写入数据库");

  console.log(JSON.stringify({
    ok: true,
    connection: connection.connection.status,
    submittedTask: submittedRequest.task,
    finalStatus: savedTask.status,
    resultCount: savedTask.results.length,
    secretPersisted: false,
  }, null, 2));
} finally {
  await stopServer();
  await new Promise((resolve) => mockServer.close(resolve));
  db.close();
  await rm(testDataDir, { recursive: true, force: true });
}
