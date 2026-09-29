const configuredApiBase = import.meta.env.VITE_HJSC_API_BASE;
const API_BASE = configuredApiBase === undefined ? "http://127.0.0.1:8787" : configuredApiBase;
const SESSION_PREFIX = "hjsc.v7.apiSession.";
const SESSION_TOKEN_PREFIX = "hjsc.v7.sessionToken.";

export function getSession(role) {
  try {
    const stored = window.localStorage.getItem(`${SESSION_PREFIX}${role}`);
    const session = stored ? JSON.parse(stored) : null;
    const handoffToken = window.sessionStorage.getItem(`${SESSION_TOKEN_PREFIX}${role}`);
    if (!session && !handoffToken) return null;
    return { ...(session || {}), token: handoffToken || session?.token || null };
  } catch {
    return null;
  }
}

export function setSession(role, session) {
  const persistentSession = window.location.protocol === "file:"
    ? session
    : { account: session?.account || null };
  window.localStorage.setItem(`${SESSION_PREFIX}${role}`, JSON.stringify(persistentSession));
  if (session?.token) window.sessionStorage.setItem(`${SESSION_TOKEN_PREFIX}${role}`, session.token);
}

export function clearSession(role) {
  window.localStorage.removeItem(`${SESSION_PREFIX}${role}`);
  window.sessionStorage.removeItem(`${SESSION_TOKEN_PREFIX}${role}`);
}

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "后端请求失败");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function tokenFor(role) {
  const session = getSession(role);
  return session?.token || null;
}

export async function login(role, account, password) {
  const payload = await request("/api/auth/login", {
    method: "POST",
    body: { role, account, password },
  });
  setSession(role, { token: payload.token, account: payload.account });
  return payload;
}

export async function fetchWorkspace(role) {
  const workspace = await request("/api/workspace", { token: tokenFor(role) });
  if (workspace.viewer?.role !== role) {
    const error = new Error("当前登录身份与入口不一致，请重新登录");
    error.status = 403;
    throw error;
  }
  return workspace;
}

export async function logout(role) {
  try {
    await request("/api/auth/logout", { method: "POST", token: tokenFor(role) });
  } finally {
    clearSession(role);
  }
}

export async function createOrganization(role, organization) {
  return request("/api/organizations", { method: "POST", token: tokenFor(role), body: organization });
}

export async function createAccount(role, account) {
  return request("/api/accounts", { method: "POST", token: tokenFor(role), body: account });
}

export async function createInvitation(role, invitation) {
  return request("/api/invitations", { method: "POST", token: tokenFor(role), body: invitation });
}

export async function revokeInvitation(role, invitationId) {
  return request(`/api/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: "POST", token: tokenFor(role) });
}

export async function reviewAccountApproval(role, accountId, approvalStatus) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/approval`, {
    method: "PATCH",
    token: tokenFor(role),
    body: { approvalStatus },
  });
}

export async function createProject(role, project) {
  return request("/api/projects", { method: "POST", token: tokenFor(role), body: project });
}

export async function createAsset(role, asset) {
  return request("/api/assets", { method: "POST", token: tokenFor(role), body: asset });
}

export async function createAssetFolder(role, folder) {
  return request("/api/asset-folders", { method: "POST", token: tokenFor(role), body: folder });
}

export async function deleteAsset(role, assetId) {
  return request(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE", token: tokenFor(role) });
}

export async function uploadAssetFile(role, assetId, filePayload) {
  return request(`/api/assets/${encodeURIComponent(assetId)}/files`, { method: "POST", token: tokenFor(role), body: filePayload });
}

export async function createImageTask(role, task) {
  return request("/api/image-tasks", { method: "POST", token: tokenFor(role), body: task });
}

export async function retryImageTask(role, taskId) {
  return request(`/api/image-tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST", token: tokenFor(role) });
}

export async function approveImageTask(role, taskId, resultId) {
  return request(`/api/image-tasks/${encodeURIComponent(taskId)}/approve`, {
    method: "POST",
    token: tokenFor(role),
    body: { resultId },
  });
}

export async function createImageWorkflow(role, workflow) {
  return request("/api/image-workflows", { method: "POST", token: tokenFor(role), body: workflow });
}

export async function fetchImageConnection(role) {
  return request("/api/image/connection", { token: tokenFor(role) });
}

export async function updateImageConnection(role, connection) {
  return request("/api/image/connection", { method: "PATCH", token: tokenFor(role), body: connection });
}

export async function fetchH3Connection(role) {
  return request("/api/h3/connection", { token: tokenFor(role) });
}

export async function updateH3Connection(role, connection) {
  return request("/api/h3/connection", { method: "PATCH", token: tokenFor(role), body: connection });
}

export async function createH3VideoTask(role, task) {
  return request("/api/h3/video-tasks", { method: "POST", token: tokenFor(role), body: task });
}

export async function syncH3VideoTask(role, taskId) {
  return request(`/api/h3/video-tasks/${encodeURIComponent(taskId)}/sync`, { method: "POST", token: tokenFor(role) });
}

export async function loadGenerationVideo(role, taskId) {
  const response = await fetch(`${API_BASE}/api/generation-jobs/${encodeURIComponent(taskId)}/content`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${tokenFor(role)}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "成片读取失败");
  }
  return response.blob();
}

export async function transcribeVideo(role, file, language = "zh") {
  const response = await fetch(`${API_BASE}/api/subtitles/transcribe`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${tokenFor(role)}`,
      "Content-Type": file.type || "video/mp4",
      "X-File-Name": encodeURIComponent(file.name || "视频.mp4"),
      "X-Language": language,
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "视频字幕识别失败");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function renderSubtitleVideo(role, file, assText, outputName = file.name, renderOptions = {}) {
  const intent = await request("/api/subtitles/render-intent", {
    method: "POST",
    token: tokenFor(role),
    body: {
      ass: assText,
      outputName,
      width: Number(renderOptions.width) || 0,
      height: Number(renderOptions.height) || 0,
      exportSessionId: renderOptions.exportSessionId || "",
      destinationName: renderOptions.destinationName || "",
    },
  });
  const response = await fetch(`${API_BASE}/api/subtitles/render/${encodeURIComponent(intent.id)}`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${tokenFor(role)}`, "Content-Type": file.type || "video/mp4" },
    body: file,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "带字幕成片生成失败");
  }
  return renderOptions.exportSessionId ? response.json() : response.blob();
}

export async function createSkillTemplate(role, template) {
  return request("/api/skill-templates", { method: "POST", token: tokenFor(role), body: template });
}

export async function updateSkillTemplate(role, templateId, patch) {
  return request(`/api/skill-templates/${encodeURIComponent(templateId)}`, { method: "PATCH", token: tokenFor(role), body: patch });
}

export async function createProductionSpec(role, spec) {
  return request("/api/production-specs", { method: "POST", token: tokenFor(role), body: spec });
}

export async function saveWeddingWorkflow(role, workflow) {
  return request("/api/wedding-workflows", { method: "PUT", token: tokenFor(role), body: workflow });
}

export async function createAssignment(role, assignment) {
  return request("/api/assignments", { method: "POST", token: tokenFor(role), body: assignment });
}

export async function updateAssignment(role, assignmentId, patch) {
  return request(`/api/assignments/${encodeURIComponent(assignmentId)}`, { method: "PATCH", token: tokenFor(role), body: patch });
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}
