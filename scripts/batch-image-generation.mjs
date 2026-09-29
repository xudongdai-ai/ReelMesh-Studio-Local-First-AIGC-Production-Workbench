#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

async function request(base, path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${payload.error || "请求失败"}`);
  return payload;
}

function readRequests(payload) {
  const items = Array.isArray(payload) ? payload : payload.requests;
  if (!Array.isArray(items) || !items.length) throw new Error("输入文件必须是非空数组，或包含 requests 数组");
  return items.map((item, index) => {
    if (typeof item === "string") return { name: `批量任务-${index + 1}`, request: item };
    if (!item?.request) throw new Error(`第 ${index + 1} 条缺少 request`);
    return item;
  });
}

const base = option("--base", "http://127.0.0.1:8787").replace(/\/$/, "");
const role = option("--role", "user");
const account = required("--account");
const password = required("--password");
const projectId = required("--project");
const inputFile = required("--input");
const count = Math.max(1, Math.min(8, Number(option("--count", "4")) || 4));

const login = await request(base, "/api/auth/login", { method: "POST", body: { role, account, password } });
const token = login.token;
const workspace = await request(base, "/api/workspace", { token });
const explicitTemplate = option("--template");
const template = workspace.skillTemplates.find((item) => item.id === explicitTemplate)
  || workspace.skillTemplates.find((item) => item.key === "image_prompt_director")
  || workspace.skillTemplates.find((item) => item.type === "image");
if (!template) throw new Error("当前账号看不到图片提示词规范模板，请先在规范模板中启用图片规范");

const imageEndpoint = option("--image-endpoint");
if (imageEndpoint) {
  await request(base, "/api/image/connection", {
    method: "PATCH",
    token,
    body: { endpointUrl: imageEndpoint, modelName: required("--image-model"), apiKey: option("--image-key") },
  });
}

const payload = JSON.parse(await readFile(inputFile, "utf8"));
const requests = readRequests(payload);
const results = [];
for (const item of requests) {
  const workflow = await request(base, "/api/image-workflows", {
    method: "POST",
    token,
    body: {
      projectId,
      templateId: item.templateId || template.id,
      assetName: item.name || "批量图片资产",
      archiveCategory: item.archiveCategory || template.assetTypeLabel || "图片",
      aspectRatio: item.aspectRatio || "16:9",
      count: item.count || count,
      request: item.request,
      negativePrompt: item.negativePrompt || "",
    },
  });
  results.push(...workflow.imageTasks.map((task) => ({
    name: task.name,
    taskId: task.id,
    status: task.status,
    resultCount: task.results.length,
    errorMessage: task.errorMessage,
  })));
}

console.log(JSON.stringify({ ok: true, template: template.name, submitted: results.length, tasks: results }, null, 2));
