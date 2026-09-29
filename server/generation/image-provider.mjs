import { fetchWithTimeout, normalizeH3Endpoint, readResponsePayload } from "./provider-registry.mjs";

export const IMAGE_PROVIDER_KEY = "openai-compatible-image";
const IMAGE_DEFAULT_MODEL = String(process.env.HJSC_IMAGE_MODEL || "gpt-image-2.5-sunburst").trim();
const imageSecrets = new Map();

function providerError(message, status = 502) {
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

export function rememberImageSecret(accountId, apiKey) {
  const value = String(apiKey || "").trim();
  if (value) imageSecrets.set(`${accountId}:${IMAGE_PROVIDER_KEY}`, value);
}

export function clearImageSecret(accountId) {
  imageSecrets.delete(`${accountId}:${IMAGE_PROVIDER_KEY}`);
}

export function getImageSecret(accountId) {
  return imageSecrets.get(`${accountId}:${IMAGE_PROVIDER_KEY}`)
    || String(process.env.HJSC_IMAGE_API_KEY || "").trim();
}

export function hasImageSecret(accountId) {
  return Boolean(getImageSecret(accountId));
}

export function imageConnectionDefaults() {
  return {
    providerKey: IMAGE_PROVIDER_KEY,
    endpointUrl: String(process.env.HJSC_IMAGE_ENDPOINT || "").trim(),
    modelName: IMAGE_DEFAULT_MODEL,
  };
}

function isGptImageModel(modelName) {
  return /^gpt-image-/i.test(String(modelName || "").trim());
}

export function normalizeImageEndpoint(value) {
  return normalizeH3Endpoint(value);
}

function imagePath(endpoint, path) {
  return `${normalizeH3Endpoint(endpoint)}${path}`;
}

export async function testImageConnection({ endpointUrl, apiKey = "" }) {
  const endpoint = normalizeImageEndpoint(endpointUrl);
  if (!endpoint) throw providerError("请先填写生图服务地址", 400);
  let lastFailure = "接口未返回可用状态";
  for (const path of ["/health", "/v1/models", "/system_stats"]) {
    const response = await fetchWithTimeout(`${endpoint}${path}`, {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
    });
    if (response.ok) return { ok: true, checkedPath: path, payload: await readResponsePayload(response) };
    const payload = await readResponsePayload(response);
    lastFailure = safeErrorText(payload?.error?.message || payload?.error || payload?.message || `${response.status} ${response.statusText}`);
    if ([401, 403].includes(response.status)) break;
  }
  throw providerError(`生图服务检测失败：${lastFailure}`);
}

function sizeForRatio(ratio) {
  return {
    "16:9": "1536x864",
    "9:16": "864x1536",
    "3:4": "1152x1536",
    "4:3": "1536x1152",
    "1:1": "1024x1024",
    "21:9": "1792x768",
  }[ratio] || "1024x1024";
}

function normalizeImageItem(item) {
  if (typeof item === "string") return { url: item };
  if (!item || typeof item !== "object") return null;
  return {
    url: item.url || item.image_url || item.imageUrl || "",
    base64: item.b64_json || item.base64 || item.data || "",
    metadata: item.metadata || item.provider_metadata || {},
  };
}

async function downloadImage(url, apiKey) {
  let parsed;
  try { parsed = new URL(url); } catch { throw providerError("生图服务返回了无效图片地址"); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw providerError("生图服务只支持 HTTP 或 HTTPS 图片地址");
  const response = await fetchWithTimeout(url, { headers: authHeaders(apiKey) }, 120_000);
  if (!response.ok || !response.body) throw providerError(`生成图片下载失败：${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const maxBytes = Number(process.env.HJSC_MAX_GENERATED_IMAGE_BYTES || 25 * 1024 * 1024);
  if (!buffer.length || buffer.length > maxBytes) throw providerError("生成图片超过本机允许保存的大小", 413);
  return { buffer, mimeType: response.headers.get("content-type") || "image/png" };
}

export async function generateImages(connection, task, accountId) {
  const endpoint = normalizeImageEndpoint(connection?.endpoint_url || connection?.endpointUrl);
  if (!endpoint) throw providerError("请先配置生图服务地址", 409);
  const apiKey = getImageSecret(accountId);
  const count = Math.max(1, Math.min(8, Number(task.count) || 4));
  const model = connection?.model_name || connection?.modelName || IMAGE_DEFAULT_MODEL;
  const prompt = String(task.prompt || "").trim();
  if (!model) throw providerError("请先填写图片模型标识", 400);
  const requestBody = (requestCount) => isGptImageModel(model)
    ? {
      model,
      prompt,
      size: sizeForRatio(task.ratio || "1:1"),
      n: requestCount,
      output_format: "png",
    }
    : {
      model,
      prompt,
      negative_prompt: String(task.negativePrompt || task.negative_prompt || "").trim(),
      size: sizeForRatio(task.ratio || "1:1"),
      n: requestCount,
      response_format: "b64_json",
      ...(task.seed === "" || task.seed === null || task.seed === undefined ? {} : { seed: Number(task.seed) }),
    };

  const requestCounts = isGptImageModel(model) ? Array.from({ length: count }, () => 1) : [count];
  const normalized = [];
  const responses = [];
  for (const requestCount of requestCounts) {
    const body = requestBody(requestCount);
    const response = await fetchWithTimeout(imagePath(endpoint, "/v1/images/generations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify(body),
    }, 120_000);
    const payload = await readResponsePayload(response, isGptImageModel(model) ? 64 * 1024 * 1024 : null);
    if (!response.ok) {
      throw providerError(`生图任务提交失败：${safeErrorText(payload?.error?.message || payload?.error || payload?.message || response.statusText)}`, [401, 403].includes(response.status) ? response.status : 502);
    }
    const items = Array.isArray(payload) ? payload : payload.data || payload.images || payload.output || [];
    normalized.push(...items.map(normalizeImageItem).filter(Boolean));
    responses.push(payload);
  }
  if (!normalized.length) throw providerError("生图服务已响应，但没有返回图片数据");
  const images = [];
  for (const item of normalized.slice(0, count)) {
    if (item.base64) {
      const encoded = String(item.base64).replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(encoded, "base64");
      if (!buffer.length) throw providerError("生图服务返回的图片编码无效");
      images.push({ buffer, mimeType: "image/png", metadata: item.metadata });
    } else if (item.url) {
      images.push({ ...(await downloadImage(item.url, apiKey)), metadata: item.metadata });
    }
  }
  return {
    request: isGptImageModel(model) ? { ...requestBody(1), batchCount: count, oneImagePerRequest: true } : requestBody(count),
    response: isGptImageModel(model) ? responses : responses[0],
    images,
  };
}
