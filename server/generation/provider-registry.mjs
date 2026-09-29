import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const H3_PROVIDER_KEY = "minimax-h3-sglang";
const H3_DEFAULT_MODEL = "MiniMaxAI/MiniMax-H3";
const H3_REQUEST_TIMEOUT_MS = 15_000;

const providerSecrets = new Map();

function connectionError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeErrorText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export async function readResponsePayload(response, maxBytesOverride = null) {
  const maxBytes = Number(maxBytesOverride || process.env.HJSC_MAX_PROVIDER_JSON_BYTES || 2 * 1024 * 1024);
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw connectionError("云显卡接口返回内容过大");
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: safeErrorText(text) };
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = H3_REQUEST_TIMEOUT_MS) {
  const headerEntries = Object.entries(options.headers || {});
  const apiKey = headerEntries.some(([name, value]) => name.toLowerCase() === "authorization" && value) ? "configured" : "";
  const target = await resolveSafeNetworkTarget(url, apiKey);
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    let settled = false;
    const request = transport.request({
      protocol: target.url.protocol,
      hostname: target.address,
      family: target.family,
      port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
      path: `${target.url.pathname}${target.url.search}`,
      method: options.method || "GET",
      headers: { ...options.headers, Host: target.url.host },
      ...(target.url.protocol === "https:" ? { servername: target.url.hostname } : {}),
    }, (response) => {
      settled = true;
      clearTimeout(timer);
      response.setTimeout(Number(process.env.HJSC_PROVIDER_IDLE_TIMEOUT_MS || 120_000), () => response.destroy(new Error("云显卡接口读取超时")));
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        for (const item of Array.isArray(value) ? value : [value]) {
          if (item !== undefined) responseHeaders.append(name, String(item));
        }
      }
      const status = response.statusCode || 500;
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(response);
      resolve(new Response(body, { status, statusText: response.statusMessage || "", headers: responseHeaders }));
    });
    const timer = setTimeout(() => request.destroy(new Error("云显卡接口连接超时")), timeoutMs);
    request.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) reject(connectionError(`无法连接云显卡接口：${safeErrorText(error?.message)}`));
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase();
  if (value.includes(".")) {
    const parts = value.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && [18, 19].includes(b));
  }
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
    || /^fe[89ab]/.test(value) || value.startsWith("ff") || value.startsWith("::ffff:127.");
}

async function resolveSafeNetworkTarget(endpoint, apiKey = "") {
  const url = new URL(endpoint);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowLoopback = process.env.HJSC_ALLOW_LOOPBACK_H3 === "1" || process.env.HJSC_ALLOW_LOOPBACK_IMAGE === "1";
  const allowPrivate = process.env.HJSC_ALLOW_PRIVATE_H3 === "1" || process.env.HJSC_ALLOW_PRIVATE_IMAGE === "1";
  const loopback = isLoopbackHost(hostname);
  if (url.protocol === "http:" && apiKey && !(loopback && allowLoopback)) {
    throw connectionError("使用访问密钥时必须填写 HTTPS 地址，避免密钥明文传输", 400);
  }
  if (loopback) {
    if (allowLoopback) return { url, address: hostname, family: isIP(hostname) || 4 };
    throw connectionError("当前服务不允许连接本机回环地址", 400);
  }
  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw connectionError(`云显卡主机解析失败：${safeErrorText(error?.message)}`);
  }
  if (!allowPrivate && addresses.some((item) => isPrivateAddress(item.address))) {
    throw connectionError("云显卡地址解析到了内网或保留地址；正式服务请使用公网 HTTPS 地址", 400);
  }
  const selected = addresses[0];
  if (!selected) throw connectionError("云显卡主机没有可用地址");
  return { url, address: selected.address, family: selected.family || isIP(selected.address) };
}

export function normalizeH3Endpoint(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 2048) throw connectionError("云显卡地址过长", 400);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw connectionError("云显卡地址格式不正确", 400);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw connectionError("云显卡地址只支持 HTTP 或 HTTPS", 400);
  }
  if (url.username || url.password) {
    throw connectionError("请不要把账号或密钥写进云显卡地址", 400);
  }
  const blockedHosts = new Set(["0.0.0.0", "169.254.169.254", "100.100.100.200", "metadata.google.internal", "fd00:ec2::254"]);
  if (blockedHosts.has(url.hostname.toLowerCase())) {
    throw connectionError("该地址属于保留的主机元数据地址，不能连接", 400);
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/(v1\/?)?$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function rememberH3Secret(accountId, apiKey) {
  const key = String(apiKey || "").trim();
  if (key) providerSecrets.set(`${accountId}:${H3_PROVIDER_KEY}`, key);
}

export function clearH3Secret(accountId) {
  providerSecrets.delete(`${accountId}:${H3_PROVIDER_KEY}`);
}

export function getH3Secret(accountId) {
  return providerSecrets.get(`${accountId}:${H3_PROVIDER_KEY}`)
    || String(process.env.HJSC_MINIMAX_H3_API_KEY || "").trim();
}

export function hasH3Secret(accountId) {
  return Boolean(getH3Secret(accountId));
}

export function h3ConnectionDefaults() {
  return {
    providerKey: H3_PROVIDER_KEY,
    endpointUrl: normalizeH3Endpoint(process.env.HJSC_MINIMAX_H3_ENDPOINT || ""),
    modelName: String(process.env.HJSC_MINIMAX_H3_MODEL || H3_DEFAULT_MODEL).trim() || H3_DEFAULT_MODEL,
  };
}

export async function testH3Connection({ endpointUrl, apiKey = "" }) {
  const endpoint = normalizeH3Endpoint(endpointUrl);
  if (!endpoint) throw connectionError("请先填写云显卡地址", 400);
  const headers = { Accept: "application/json", ...authHeaders(apiKey) };
  const candidates = ["/health", "/v1/models"];
  let lastFailure = "接口未返回可用状态";
  for (const path of candidates) {
    const response = await fetchWithTimeout(`${endpoint}${path}`, { headers });
    if (response.ok) {
      const payload = await readResponsePayload(response);
      return { ok: true, endpointUrl: endpoint, checkedPath: path, payload };
    }
    const payload = await readResponsePayload(response);
    lastFailure = safeErrorText(payload?.error?.message || payload?.error || payload?.message || `${response.status} ${response.statusText}`);
    if ([401, 403].includes(response.status)) break;
  }
  throw connectionError(`云显卡接口检测失败：${lastFailure}`);
}

export async function submitH3Video(connection, task, accountId) {
  const endpoint = normalizeH3Endpoint(connection?.endpoint_url || connection?.endpointUrl);
  if (!endpoint) throw connectionError("请先配置 H3 云显卡地址", 409);
  const duration = Math.max(4, Math.min(15, Number(task.durationSeconds) || 5));
  const body = {
    model: connection?.model_name || connection?.modelName || H3_DEFAULT_MODEL,
    prompt: String(task.prompt || "").trim(),
    seconds: duration,
    task: task.taskMode || "t2va",
    conditions: Array.isArray(task.conditions) ? task.conditions : [],
    target: { short_edge: 768, aspect_ratio: task.ratio || "16:9", duration_seconds: duration },
    num_outputs_per_prompt: 1,
    num_inference_steps: 50,
    flow_shift: 12,
    audio_flow_shift: 3,
    ...(task.seed === "" || task.seed === null || task.seed === undefined ? {} : { seed: Number(task.seed) }),
  };
  const response = await fetchWithTimeout(`${endpoint}/v1/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders(getH3Secret(accountId)) },
    body: JSON.stringify(body),
  }, 30_000);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw connectionError(`H3 视频任务提交失败：${safeErrorText(payload?.error?.message || payload?.error || payload?.message || response.statusText)}`, [401, 403].includes(response.status) ? response.status : 502);
  }
  const providerJobId = payload.id || payload.video_id || payload.task_id;
  if (!providerJobId) throw connectionError("H3 接口已响应，但没有返回视频任务号");
  return { providerJobId: String(providerJobId), request: body, response: payload };
}

export async function inspectH3Video(connection, providerJobId, accountId) {
  const endpoint = normalizeH3Endpoint(connection?.endpoint_url || connection?.endpointUrl);
  const response = await fetchWithTimeout(`${endpoint}/v1/videos/${encodeURIComponent(providerJobId)}`, {
    headers: { Accept: "application/json", ...authHeaders(getH3Secret(accountId)) },
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw connectionError(`H3 任务状态读取失败：${safeErrorText(payload?.error?.message || payload?.error || payload?.message || response.statusText)}`, [401, 403].includes(response.status) ? response.status : 502);
  }
  return payload;
}

export async function fetchH3VideoContent(connection, providerJobId, accountId) {
  const endpoint = normalizeH3Endpoint(connection?.endpoint_url || connection?.endpointUrl);
  const response = await fetchWithTimeout(`${endpoint}/v1/videos/${encodeURIComponent(providerJobId)}/content`, {
    headers: authHeaders(getH3Secret(accountId)),
  }, 30_000);
  if (!response.ok || !response.body) {
    const payload = await readResponsePayload(response);
    throw connectionError(`H3 成片下载失败：${safeErrorText(payload?.error?.message || payload?.error || payload?.message || response.statusText)}`, [401, 403].includes(response.status) ? response.status : 502);
  }
  return response;
}

export function mapH3Status(payload = {}) {
  const raw = String(payload.status || payload.state || "queued").toLowerCase();
  if (["completed", "succeeded", "success", "finished"].includes(raw)) return { status: "已完成", progress: 100, terminal: true, success: true };
  if (["failed", "error", "cancelled", "canceled"].includes(raw)) return { status: "失败", progress: 0, terminal: true, success: false };
  if (["in_progress", "processing", "running", "generating"].includes(raw)) return { status: "生成中", progress: Math.max(1, Math.min(99, Number(payload.progress) || 50)), terminal: false, success: false };
  return { status: "排队中", progress: Math.max(0, Math.min(20, Number(payload.progress) || 5)), terminal: false, success: false };
}

export function configuredProvider(settings = {}) {
  if (!settings.provider || !settings.apiKey) return { id: "未配置", label: "等待生成服务配置", canGenerate: false };
  return { id: settings.provider, label: settings.provider, canGenerate: true };
}

export async function enqueueGenerationTask(task, settings = {}) {
  const provider = configuredProvider(settings);
  if (!provider.canGenerate) {
    return { status: "待接入", progress: 0, errorMessage: "生成服务尚未配置，任务已保存到后端队列。", provider: provider.id, results: [] };
  }
  return { status: "排队中", progress: 0, errorMessage: "", provider: provider.id, results: [], task };
}
