import http from "node:http";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { all, filesDir, one, run, transaction } from "./database.mjs";
import { hashPassword, hashToken, makeId, makeInvitationToken, makeSessionToken, nowIso, sanitizeAccount, SESSION_MAX_AGE_SECONDS, sessionExpiry, verifyPassword } from "./auth.mjs";
import { cors, readJson, routeParams, sendError, sendJson, serveFile } from "./http-utils.mjs";
import { canManageAccount, canAccessTenantRow, orgIdOf, requireRole, visibleAccounts } from "./permissions.mjs";
import { assetFolderRow, assetRow, assignmentRow, auditRow, fileRow, imageResultRow, imageTaskRow, invitationRow, organizationRow, productionSpecRow, projectRow, shotRow, skillTemplateRow, weddingWorkflowRow } from "./serializers.mjs";
import { saveAssetFile } from "./files.mjs";
import {
  clearH3Secret,
  enqueueGenerationTask,
  fetchH3VideoContent,
  getH3Secret,
  h3ConnectionDefaults,
  hasH3Secret,
  inspectH3Video,
  mapH3Status,
  normalizeH3Endpoint,
  rememberH3Secret,
  submitH3Video,
  testH3Connection,
} from "./generation/provider-registry.mjs";
import {
  clearImageSecret,
  generateImages,
  getImageSecret,
  hasImageSecret,
  imageConnectionDefaults,
  IMAGE_PROVIDER_KEY,
  normalizeImageEndpoint,
  rememberImageSecret,
  testImageConnection,
} from "./generation/image-provider.mjs";
import { saveGeneratedImage } from "./generation/image-storage.mjs";
import { compileImageWorkflow } from "./image-workflow.mjs";
import { activeAccounts, assertScopedProject, scopedAccounts as getScopedAccounts, scopedProjects } from "./scoped-query.mjs";
import { createSubtitleRenderIntent, renderSubtitleVideo, transcribeVideo } from "./transcription.mjs";

const SESSION_COOKIE = "hjsc_session";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authAttempts = new Map();
const h3PollTimers = new Map();
const BUILT_IN_MUSIC = new Set(["calm-loop.mp3", "dark-upbeat-loop.mp3", "ambient-persistence-loop.mp3"]);
const BUILT_IN_SFX = new Set(["click.wav", "mouseclick.wav", "erase.wav"]);
const musicDirectory = process.env.HJSC_MUSIC_DIR
  || (process.resourcesPath && existsSync(join(process.resourcesPath, "music")) ? join(process.resourcesPath, "music") : join(process.cwd(), "public", "music"));
const sfxDirectory = process.env.HJSC_SFX_DIR
  || (process.resourcesPath && existsSync(join(process.resourcesPath, "sfx")) ? join(process.resourcesPath, "sfx") : join(process.cwd(), "public", "sfx"));

function provisionConfiguredDeveloper() {
  const account = String(process.env.HJSC_BOOTSTRAP_DEVELOPER_ACCOUNT || "").trim();
  const password = String(process.env.HJSC_BOOTSTRAP_DEVELOPER_PASSWORD || "");
  if (!account || password.length < 8) return;
  const accountCount = one("SELECT COUNT(*) AS count FROM accounts")?.count || 0;
  if (accountCount > 0) return;
  const now = nowIso();
  run(`INSERT INTO accounts (id,account,password_hash,name,role,status,approval_status,joined_at,created_at,updated_at)
    VALUES (:id,:account,:passwordHash,:name,'developer','离线','approved',:joinedAt,:createdAt,:updatedAt)`, {
    id: `developer-${account}`,
    account,
    passwordHash: hashPassword(password),
    name: String(process.env.HJSC_BOOTSTRAP_DEVELOPER_NAME || "平台运营").trim() || "平台运营",
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

provisionConfiguredDeveloper();

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function enforceRateLimit(req, scope, limit) {
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    const error = new Error("请求过于频繁，请稍后再试");
    error.status = 429;
    throw error;
  }
}

function clearRateLimit(req, scope) {
  authAttempts.delete(`${scope}:${clientIp(req)}`);
}

function requestMeta(req) {
  return {
    ip: clientIp(req),
    userAgent: req.headers["user-agent"] || "",
  };
}

function recordAudit(viewer, action, target, status = "已完成", before = null, after = null, req = null) {
  const meta = req ? requestMeta(req) : {};
  const orgId = after?.orgId || after?.org_id || before?.orgId || before?.org_id || orgIdOf(viewer);
  run(`INSERT INTO audit_logs (id,org_id,actor_account_id,user_id,user_name,action,target,project,status,before_json,after_json,ip,user_agent,created_at)
    VALUES (:id,:orgId,:actorAccountId,:userId,:userName,:action,:target,:project,:status,:beforeJson,:afterJson,:ip,:userAgent,:createdAt)`, {
    id: makeId("记录"),
    orgId,
    actorAccountId: viewer?.id || "system",
    userId: viewer?.id || "system",
    userName: viewer?.name || "系统",
    action,
    target,
    project: after?.projectName || before?.projectName || "账号与组织",
    status,
    beforeJson: before ? JSON.stringify(before) : null,
    afterJson: after ? JSON.stringify(after) : null,
    ip: meta.ip || "",
    userAgent: meta.userAgent || "",
    createdAt: nowIso(),
  });
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function getCookie(req, name) {
  const cookie = String(req.headers.cookie || "");
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sessionTokenFrom(req) {
  return getBearer(req) || getCookie(req, SESSION_COOKIE);
}

function secureRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https"
    || String(req.headers.host || "").toLowerCase().endsWith("zhiyinstudio.cn");
}

function setSessionCookie(req, res, token) {
  const secure = secureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = secureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function requireViewer(req) {
  const token = sessionTokenFrom(req);
  if (!token) {
    const error = new Error("请先登录");
    error.status = 401;
    throw error;
  }
  const row = one(`SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token_hash = :tokenHash AND sessions.revoked_at IS NULL AND sessions.expires_at > :now`, {
    tokenHash: hashToken(token),
    now: nowIso(),
  });
  if (!row || row.disabled_at) {
    const error = new Error("登录已失效");
    error.status = 401;
    throw error;
  }
  return row;
}

function accountRows() {
  return activeAccounts();
}

function projectRows() {
  return all("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC");
}

function imageTasksWithResults(rows) {
  const results = all("SELECT * FROM generation_results ORDER BY created_at ASC").map(imageResultRow);
  return rows.map((row) => imageTaskRow(row, results.filter((item) => item.taskId === row.id)));
}

function imageResultFilePath(result) {
  try {
    const metadata = result?.provider_metadata ? JSON.parse(result.provider_metadata) : {};
    return metadata.previewPath || metadata.originalPath || "";
  } catch {
    return "";
  }
}

async function generateImageJob(job, viewer, connection = imageConnectionFor(viewer.id)) {
  const now = nowIso();
  run(`UPDATE generation_jobs SET status = '生成中', progress = 15, error_message = '', updated_at = :updatedAt WHERE id = :id`, { id: job.id, updatedAt: now });
  try {
    const generated = await generateImages(connection, { ...job, batchCount: job.batch_count || job.batchCount || 4, count: job.batch_count || job.batchCount || 4 }, viewer.id);
    const previousCount = Number(job.retry_count || 0);
    const results = [];
    for (const [index, image] of generated.images.entries()) {
      const stored = await saveGeneratedImage({ projectId: job.project_id, taskId: job.id, index: previousCount * 8 + index, buffer: image.buffer });
      const resultId = makeId("结果");
      const label = previousCount ? `重生${previousCount} · ${String(index + 1).padStart(2, "0")}` : `初稿 · ${String(index + 1).padStart(2, "0")}`;
      const fullUrl = `/api/generation-results/${encodeURIComponent(resultId)}/content`;
      run(`INSERT INTO generation_results (id,org_id,generation_job_id,label,full_url,thumb_url,provider_metadata,created_at)
        VALUES (:id,:orgId,:jobId,:label,:fullUrl,:thumbUrl,:providerMetadata,:createdAt)`, {
        id: resultId,
        orgId: job.org_id,
        jobId: job.id,
        label,
        fullUrl,
        thumbUrl: fullUrl,
        providerMetadata: JSON.stringify({ ...image.metadata, originalPath: stored.originalPath, previewPath: stored.previewPath, thumbnailPath: stored.thumbnailPath, mimeType: stored.mimeType }),
        createdAt: nowIso(),
      });
      results.push(resultId);
    }
    if (!results.length) throw new Error("生图服务没有返回可保存的图片");
    run(`UPDATE generation_jobs SET status = '待审核', progress = 100, error_message = '', provider = '图片服务', provider_request_json = :providerRequestJson, provider_response_json = :providerResponseJson, completed_at = :completedAt, updated_at = :updatedAt WHERE id = :id`, {
      id: job.id,
      providerRequestJson: JSON.stringify(generated.request || {}),
      providerResponseJson: JSON.stringify({ imageCount: results.length }),
      completedAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (job.asset_id) {
      const first = one("SELECT * FROM generation_results WHERE id = :id", { id: results[0] });
      run("UPDATE assets SET image_url = :imageUrl, image_full_url = :imageFullUrl, thumbnail_url = :thumbnailUrl, status = '待审核', updated_at = :updatedAt WHERE id = :id", {
        id: job.asset_id,
        imageUrl: first?.thumb_url || "",
        imageFullUrl: first?.full_url || "",
        thumbnailUrl: first?.thumb_url || "",
        updatedAt: nowIso(),
      });
    }
  } catch (error) {
    run("UPDATE generation_jobs SET status = '失败', progress = 0, error_message = :errorMessage, updated_at = :updatedAt WHERE id = :id", {
      id: job.id,
      errorMessage: String(error?.message || "生图任务失败").slice(0, 500),
      updatedAt: nowIso(),
    });
  }
  return one("SELECT * FROM generation_jobs WHERE id = :id", { id: job.id });
}

function h3ConnectionFor(accountId) {
  const saved = one("SELECT * FROM provider_connections WHERE account_id = :accountId AND provider_key = 'minimax-h3-sglang'", { accountId });
  if (saved) return saved;
  const defaults = h3ConnectionDefaults();
  return {
    id: null,
    account_id: accountId,
    provider_key: defaults.providerKey,
    endpoint_url: defaults.endpointUrl,
    model_name: defaults.modelName,
    connection_status: defaults.endpointUrl ? "待检测" : "待配置",
    last_error: "",
    last_checked_at: null,
  };
}

function imageConnectionFor(accountId) {
  const saved = one("SELECT * FROM provider_connections WHERE account_id = :accountId AND provider_key = :providerKey", { accountId, providerKey: IMAGE_PROVIDER_KEY });
  if (saved) return saved;
  const defaults = imageConnectionDefaults();
  return {
    id: null,
    account_id: accountId,
    provider_key: defaults.providerKey,
    endpoint_url: defaults.endpointUrl,
    model_name: defaults.modelName,
    connection_status: defaults.endpointUrl ? "待检测" : "待配置",
    last_error: "",
    last_checked_at: null,
  };
}

function h3ConnectionPayload(connection, accountId) {
  return {
    providerKey: connection.provider_key || "minimax-h3-sglang",
    endpointUrl: connection.endpoint_url || "",
    modelName: connection.model_name || "MiniMaxAI/MiniMax-H3",
    status: connection.connection_status || "待配置",
    lastError: connection.last_error || "",
    lastCheckedAt: connection.last_checked_at || null,
    hasSessionKey: hasH3Secret(accountId),
  };
}

function imageConnectionPayload(connection, accountId) {
  return {
    providerKey: connection.provider_key || IMAGE_PROVIDER_KEY,
    endpointUrl: connection.endpoint_url || "",
    modelName: connection.model_name || "",
    status: connection.connection_status || "待配置",
    lastError: connection.last_error || "",
    lastCheckedAt: connection.last_checked_at || null,
    hasSessionKey: hasImageSecret(accountId),
  };
}

function h3JobError(payload) {
  return String(payload?.error?.message || payload?.error || payload?.message || "云端任务失败").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function saveH3Output(job, connection) {
  if (job.output_file_path) return job.output_file_path;
  const response = await fetchH3VideoContent(connection, job.provider_job_id, job.created_by);
  const maxBytes = Number(process.env.HJSC_MAX_GENERATED_VIDEO_BYTES || 1024 * 1024 * 1024);
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > maxBytes) throw new Error("H3 成片超过本机允许保存的大小");
  const outputPath = join(filesDir, "generated", job.org_id || "platform", `${job.id}.mp4`);
  await mkdir(dirname(outputPath), { recursive: true });
  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      callback(receivedBytes > maxBytes ? new Error("H3 成片超过本机允许保存的大小") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(outputPath));
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
  const now = nowIso();
  run(`UPDATE generation_jobs
    SET output_file_path = :outputPath, status = '已完成', progress = 100, error_message = '', completed_at = :completedAt, updated_at = :updatedAt
    WHERE id = :id`, { id: job.id, outputPath, completedAt: now, updatedAt: now });
  const existingResult = one("SELECT id FROM generation_results WHERE generation_job_id = :jobId", { jobId: job.id });
  if (!existingResult) {
    run(`INSERT INTO generation_results (id,org_id,generation_job_id,label,full_url,thumb_url,provider_metadata,created_at)
      VALUES (:id,:orgId,:jobId,'成片',:fullUrl,:thumbUrl,:metadata,:createdAt)`, {
      id: makeId("结果"),
      orgId: job.org_id,
      jobId: job.id,
      fullUrl: `/api/generation-jobs/${encodeURIComponent(job.id)}/content`,
      thumbUrl: "",
      metadata: JSON.stringify({ providerJobId: job.provider_job_id, mediaKind: "video" }),
      createdAt: now,
    });
  }
  return outputPath;
}

async function syncH3Job(jobId) {
  const job = one("SELECT * FROM generation_jobs WHERE id = :id AND media_kind = 'video'", { id: jobId });
  if (!job || !job.provider_job_id) return null;
  const connection = h3ConnectionFor(job.created_by);
  const payload = await inspectH3Video(connection, job.provider_job_id, job.created_by);
  const mapped = mapH3Status(payload);
  const errorMessage = mapped.terminal && !mapped.success ? h3JobError(payload) : "";
  run(`UPDATE generation_jobs
    SET status = :status, progress = :progress, error_message = :errorMessage, provider_response_json = :providerResponseJson, updated_at = :updatedAt
    WHERE id = :id`, {
    id: job.id,
    status: mapped.status,
    progress: mapped.progress,
    errorMessage,
    providerResponseJson: JSON.stringify(payload),
    updatedAt: nowIso(),
  });
  if (mapped.success) await saveH3Output({ ...job, status: mapped.status }, connection);
  return one("SELECT * FROM generation_jobs WHERE id = :id", { id: job.id });
}

function scheduleH3Poll(jobId, delayMs = 4_000) {
  if (h3PollTimers.has(jobId)) return;
  const timer = setTimeout(async () => {
    h3PollTimers.delete(jobId);
    try {
      const job = await syncH3Job(jobId);
      if (job && !["已完成", "失败", "已取消"].includes(job.status)) scheduleH3Poll(jobId, 5_000);
    } catch (error) {
      const needsConnection = [401, 403].includes(error?.status);
      run(`UPDATE generation_jobs
        SET status = CASE WHEN :needsConnection = 1 THEN '待接入' ELSE status END,
            error_message = :errorMessage,
            updated_at = :updatedAt
        WHERE id = :id`, {
        id: jobId,
        needsConnection: needsConnection ? 1 : 0,
        errorMessage: String(error?.message || "状态同步失败").slice(0, 500),
        updatedAt: nowIso(),
      });
      if (!needsConnection) scheduleH3Poll(jobId, 15_000);
    }
  }, delayMs);
  h3PollTimers.set(jobId, timer);
}

function skillTemplatesFor(viewer) {
  const rows = viewer.role === "developer"
    ? all("SELECT * FROM skill_templates ORDER BY scope ASC, created_at ASC")
    : all("SELECT * FROM skill_templates WHERE status = '启用' AND (org_id IS NULL OR org_id = :orgId) ORDER BY scope ASC, created_at ASC", { orgId: orgIdOf(viewer) || "" });
  return rows.map(skillTemplateRow);
}

function canUseSkillTemplate(template, viewer) {
  if (!template) return false;
  if (viewer.role === "developer") return true;
  return template.status === "启用" && (!template.org_id || template.org_id === orgIdOf(viewer));
}

function workspaceFor(viewer) {
  const accounts = accountRows();
  const projects = scopedProjects(viewer);
  const projectIds = new Set(projects.map((project) => project.id));
  const scopedAccounts = getScopedAccounts(viewer);
  const scopedAccountIds = new Set(scopedAccounts.map((account) => account.id));
  const viewerOrgId = orgIdOf(viewer);
  return {
    viewer: sanitizeAccount(viewer),
    accounts: scopedAccounts.map(sanitizeAccount),
    organizations: (viewer.role === "developer"
      ? all("SELECT * FROM organizations ORDER BY created_at DESC")
      : all("SELECT * FROM organizations WHERE id = :id ORDER BY created_at DESC", { id: viewerOrgId || "" })).map(organizationRow),
    projects: projects.map(projectRow),
    weddingWorkflows: all("SELECT * FROM wedding_workflows ORDER BY updated_at DESC").filter((item) => projectIds.has(item.project_id) && (viewer.role === "developer" || item.org_id === viewerOrgId)).map(weddingWorkflowRow),
    assetFolders: all("SELECT * FROM asset_folders WHERE deleted_at IS NULL ORDER BY created_at ASC").filter((item) => projectIds.has(item.project_id) && (viewer.role === "developer" || item.org_id === viewerOrgId)).map(assetFolderRow),
    assets: all("SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC").filter((item) => projectIds.has(item.project_id) && canAccessTenantRow(item, accounts, viewer)).map(assetRow),
    files: all("SELECT * FROM asset_files WHERE deleted_at IS NULL ORDER BY created_at DESC").filter((item) => projectIds.has(item.project_id) && canAccessTenantRow(item, accounts, viewer)).map(fileRow),
    imageTasks: imageTasksWithResults(all("SELECT * FROM generation_jobs ORDER BY created_at DESC").filter((item) => projectIds.has(item.project_id) && canAccessTenantRow(item, accounts, viewer))),
    shots: all("SELECT * FROM shots ORDER BY created_at DESC").filter((item) => projectIds.has(item.project_id) && (viewer.role === "developer" || item.org_id === viewerOrgId)).map(shotRow),
    skillTemplates: skillTemplatesFor(viewer),
    productionSpecs: all("SELECT * FROM production_specs ORDER BY created_at DESC").filter((item) => projectIds.has(item.project_id) && canAccessTenantRow(item, accounts, viewer)).map(productionSpecRow),
    assignments: all("SELECT * FROM assignments ORDER BY created_at DESC").filter((item) => viewer.role === "developer" || (item.org_id === viewerOrgId && (scopedAccountIds.has(item.assigned_by || item.manager_id) || scopedAccountIds.has(item.assigned_to || item.assignee_id)))).map(assignmentRow),
    activityLogs: all("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200").filter((item) => viewer.role === "developer" || (item.org_id === viewerOrgId && scopedAccountIds.has(item.actor_account_id || item.user_id))).map(auditRow),
    invitations: (["admin", "developer"].includes(viewer.role)
      ? all(`SELECT invitations.*, parent.name AS parent_name, creator.name AS created_by_name
          FROM invitations
          LEFT JOIN accounts parent ON parent.id = invitations.parent_id
          LEFT JOIN accounts creator ON creator.id = invitations.created_by
          WHERE (:isDeveloper = 1 OR invitations.org_id = :orgId)
          ORDER BY invitations.created_at DESC`, { isDeveloper: viewer.role === "developer" ? 1 : 0, orgId: viewerOrgId || "" })
      : []).map(invitationRow),
  };
}

function assertProjectAccess(projectId, viewer) {
  return assertScopedProject(projectId, viewer);
}

function issueSession(row, req, res, action, extra = {}) {
  const now = nowIso();
  run("UPDATE accounts SET status = '在线', updated_at = :updatedAt WHERE id = :id", { id: row.id, updatedAt: now });
  const saved = one("SELECT * FROM accounts WHERE id = :id", { id: row.id });
  const token = makeSessionToken();
  run("INSERT INTO sessions (token_hash,account_id,created_at,expires_at) VALUES (:tokenHash,:accountId,:createdAt,:expiresAt)", {
    tokenHash: hashToken(token),
    accountId: saved.id,
    createdAt: now,
    expiresAt: sessionExpiry(),
  });
  setSessionCookie(req, res, token);
  recordAudit(saved, action, saved.name, "已完成", null, sanitizeAccount(saved), req);
  return { token, account: sanitizeAccount(saved), workspace: workspaceFor(saved), ...extra };
}

async function login(req, res) {
  enforceRateLimit(req, "login", 30);
  const body = await readJson(req);
  const role = body.role;
  const account = String(body.account || "").trim();
  const password = String(body.password || "");
  if (!["user", "manager", "admin", "developer"].includes(role) || !account || !password) {
    return sendJson(res, 400, { error: "账号、密码和入口身份不能为空" });
  }
  const row = one("SELECT * FROM accounts WHERE role = :role AND account = :account", { role, account });
  if (!row || !verifyPassword(password, row.password_hash)) {
    return sendJson(res, 401, { error: "账号或密码不正确" });
  } else if (row.disabled_at) {
    return sendJson(res, 403, { error: "账号已被禁用" });
  } else if ((row.approval_status || "approved") === "pending") {
    return sendJson(res, 403, { error: "账号正在等待管理员确认" });
  } else if ((row.approval_status || "approved") === "rejected") {
    return sendJson(res, 403, { error: "账号加入申请未通过" });
  }

  clearRateLimit(req, "login");
  sendJson(res, 200, issueSession(row, req, res, "登录"));
}

async function localDesktopLogin(req, res) {
  if (process.env.HJSC_LOCAL_ACCESS !== "1") {
    return sendJson(res, 403, { error: "本地免登录入口未启用" });
  }
  const remoteAddress = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  if (!["127.0.0.1", "::1"].includes(remoteAddress)) {
    return sendJson(res, 403, { error: "本地免登录入口仅允许本机访问" });
  }
  const row = one("SELECT * FROM accounts WHERE role = 'developer' AND disabled_at IS NULL ORDER BY created_at ASC LIMIT 1");
  if (!row) return sendJson(res, 503, { error: "尚未初始化本地开发者账号" });
  sendJson(res, 200, issueSession(row, req, res, "本地桌面进入"));
}

async function registerAccount(req, res) {
  enforceRateLimit(req, "register", 20);
  const body = await readJson(req);
  const invitationToken = String(body.invitationToken || body.invite || "").trim();
  const account = String(body.account || "").trim();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!invitationToken) return sendJson(res, 403, { error: "当前仅支持受邀注册，请使用管理员发送的邀请链接" });
  if (!account || !name || !password) return sendJson(res, 400, { error: "姓名、账号和密码不能为空" });
  if (password.length < 8) return sendJson(res, 400, { error: "密码至少需要 8 个字符" });

  let invitation = one("SELECT * FROM invitations WHERE token_hash = :tokenHash", { tokenHash: hashToken(invitationToken) });
  if (!invitation) return sendJson(res, 404, { error: "邀请无效，请联系管理员重新发送" });
  const now = nowIso();
  if (invitation.revoked_at) return sendJson(res, 410, { error: "邀请已被撤销" });
  if (invitation.expires_at <= now) return sendJson(res, 410, { error: "邀请已过期" });
  if (invitation.use_count >= invitation.max_uses) return sendJson(res, 410, { error: "邀请使用次数已用完" });

  const role = invitation.role;
  if (body.role && body.role !== role) return sendJson(res, 400, { error: "注册身份与邀请不一致" });
  if (one("SELECT id FROM accounts WHERE role = :role AND account = :account", { role, account })) return sendJson(res, 409, { error: "该账号已经存在" });

  const organization = one("SELECT * FROM organizations WHERE id = :id", { id: invitation.org_id });
  if (!organization) return sendJson(res, 410, { error: "邀请所属组织已不存在" });
  const parent = invitation.parent_id ? one("SELECT * FROM accounts WHERE id = :id AND disabled_at IS NULL", { id: invitation.parent_id }) : null;
  if (parent && orgIdOf(parent) !== organization.id) return sendJson(res, 410, { error: "邀请中的直属关系已失效" });
  const approvalStatus = invitation.requires_approval ? "pending" : "approved";

  const row = {
    id: `${role}-${account}`,
    account,
    name,
    role,
    department: invitation.department || "未设置",
    orgId: organization.id,
    organizationId: organization.id,
    parentId: parent?.id || organization.owner_admin_id || null,
    parentName: parent?.name || "组织管理员",
    adminId: role === "manager" ? (organization.owner_admin_id || parent?.id || null) : (parent?.role === "admin" ? parent.id : parent?.admin_id || organization.owner_admin_id || null),
    managerId: role === "user" && parent?.role === "manager" ? parent.id : null,
    status: approvalStatus === "pending" ? "待确认" : "离线",
    approvalStatus,
    invitedBy: invitation.created_by,
    joinedAt: now,
    createdAt: now,
  };

  transaction(() => {
    invitation = one("SELECT * FROM invitations WHERE id = :id", { id: invitation.id });
    if (!invitation || invitation.revoked_at || invitation.expires_at <= now || invitation.use_count >= invitation.max_uses) {
      const error = new Error("邀请已失效，请联系管理员重新发送");
      error.status = 410;
      throw error;
    }
    run(`INSERT INTO accounts (id,account,password_hash,name,role,department,org_id,organization_id,parent_id,parent_name,admin_id,manager_id,status,approval_status,invited_by,joined_at,created_at,updated_at)
      VALUES (:id,:account,:passwordHash,:name,:role,:department,:orgId,:organizationId,:parentId,:parentName,:adminId,:managerId,:status,:approvalStatus,:invitedBy,:joinedAt,:createdAt,:updatedAt)`, {
      ...row,
      passwordHash: hashPassword(password),
      updatedAt: now,
    });
    run("UPDATE invitations SET use_count = use_count + 1, updated_at = :updatedAt WHERE id = :id", { id: invitation.id, updatedAt: now });
    run(`INSERT INTO invitation_uses (id,invitation_id,org_id,account_id,registered_account,approval_status,created_at)
      VALUES (:id,:invitationId,:orgId,:accountId,:registeredAccount,:approvalStatus,:createdAt)`, {
      id: makeId("邀请使用"),
      invitationId: invitation.id,
      orgId: organization.id,
      accountId: row.id,
      registeredAccount: account,
      approvalStatus,
      createdAt: now,
    });
  });

  const saved = one("SELECT * FROM accounts WHERE id = :id", { id: row.id });
  recordAudit(saved, "受邀注册", `${saved.name} · ${role}`, approvalStatus === "pending" ? "待确认" : "已完成", null, sanitizeAccount(saved), req);
  if (approvalStatus === "pending") {
    sendJson(res, 201, {
      registered: true,
      pendingApproval: true,
      account: sanitizeAccount(saved),
      organization: organizationRow(organization),
      message: "注册已提交，请等待管理员确认后登录",
    });
    return;
  }
  clearRateLimit(req, "register");
  const payload = issueSession(saved, req, res, "受邀注册并登录", {
    registered: true,
    pendingApproval: false,
    organization: organizationRow(organization),
  });
  sendJson(res, 201, payload);
}

async function inspectInvitation(req, res) {
  enforceRateLimit(req, "invite-inspect", 60);
  const body = await readJson(req);
  const token = String(body.invitationToken || body.invite || "").trim();
  if (!token) return sendJson(res, 400, { error: "邀请凭证不能为空" });
  const invitation = one(`SELECT invitations.*, parent.name AS parent_name, creator.name AS created_by_name
    FROM invitations
    LEFT JOIN accounts parent ON parent.id = invitations.parent_id
    LEFT JOIN accounts creator ON creator.id = invitations.created_by
    WHERE invitations.token_hash = :tokenHash`, { tokenHash: hashToken(token) });
  if (!invitation) return sendJson(res, 404, { error: "邀请无效" });
  const now = nowIso();
  if (invitation.revoked_at) return sendJson(res, 410, { error: "邀请已被撤销" });
  if (invitation.expires_at <= now) return sendJson(res, 410, { error: "邀请已过期" });
  if (invitation.use_count >= invitation.max_uses) return sendJson(res, 410, { error: "邀请使用次数已用完" });
  const organization = one("SELECT id,name FROM organizations WHERE id = :id", { id: invitation.org_id });
  if (!organization) return sendJson(res, 410, { error: "邀请所属组织已不存在" });
  sendJson(res, 200, {
    valid: true,
    invitation: invitationRow(invitation),
    organization,
  });
}

async function logout(req, res) {
  const token = sessionTokenFrom(req);
  if (token) {
    const tokenHash = hashToken(token);
    const account = one(`SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id
      WHERE sessions.token_hash = :tokenHash`, { tokenHash });
    run("UPDATE sessions SET revoked_at = COALESCE(revoked_at, :revokedAt) WHERE token_hash = :tokenHash", { revokedAt: nowIso(), tokenHash });
    if (account) recordAudit(account, "退出登录", account.name, "已完成", null, null, req);
  }
  clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
}

async function createInvitation(req, res, viewer) {
  requireRole(viewer, ["admin"]);
  const body = await readJson(req);
  const role = body.role;
  if (!["manager", "user"].includes(role)) return sendJson(res, 400, { error: "邀请身份只能是经理或用户" });

  const orgId = orgIdOf(viewer);
  if (!orgId) return sendJson(res, 400, { error: "管理员账号未归属组织" });
  const requestedParentId = String(body.parentId || "").trim();
  const parent = requestedParentId
    ? one("SELECT * FROM accounts WHERE id = :id AND disabled_at IS NULL", { id: requestedParentId })
    : viewer;
  if (!parent || orgIdOf(parent) !== orgId) return sendJson(res, 403, { error: "直属上级必须属于当前组织" });
  if (role === "manager" && parent.role !== "admin") return sendJson(res, 400, { error: "经理的直属上级必须是管理员" });
  if (role === "user" && !["admin", "manager"].includes(parent.role)) return sendJson(res, 400, { error: "用户的直属上级必须是管理员或经理" });

  const maxUses = Math.max(1, Math.min(100, Number(body.maxUses) || 1));
  const expiresInHours = Math.max(1, Math.min(720, Number(body.expiresInHours) || 72));
  const now = nowIso();
  const token = makeInvitationToken();
  const row = {
    id: makeId("邀请"),
    orgId,
    tokenHash: hashToken(token),
    role,
    department: String(body.department || "未设置").trim() || "未设置",
    parentId: parent.id,
    maxUses,
    requiresApproval: body.requiresApproval === false ? 0 : 1,
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
    createdBy: viewer.id,
    createdAt: now,
  };
  run(`INSERT INTO invitations (id,org_id,token_hash,role,department,parent_id,max_uses,use_count,requires_approval,expires_at,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:tokenHash,:role,:department,:parentId,:maxUses,0,:requiresApproval,:expiresAt,:createdBy,:createdAt,:createdAt)`, row);
  const saved = one(`SELECT invitations.*, parent.name AS parent_name, creator.name AS created_by_name
    FROM invitations
    LEFT JOIN accounts parent ON parent.id = invitations.parent_id
    LEFT JOIN accounts creator ON creator.id = invitations.created_by
    WHERE invitations.id = :id`, { id: row.id });
  recordAudit(viewer, "创建成员邀请", `${role === "manager" ? "经理" : "用户"} · ${maxUses} 次`, "已完成", null, invitationRow(saved), req);
  sendJson(res, 201, { invitation: invitationRow(saved), invitationToken: token });
}

async function revokeInvitation(req, res, viewer, invitationId) {
  requireRole(viewer, ["admin"]);
  const invitation = one("SELECT * FROM invitations WHERE id = :id", { id: invitationId });
  if (!invitation || invitation.org_id !== orgIdOf(viewer)) return sendJson(res, 404, { error: "邀请不存在" });
  if (!invitation.revoked_at) {
    run("UPDATE invitations SET revoked_at = :revokedAt, updated_at = :updatedAt WHERE id = :id", {
      id: invitationId,
      revokedAt: nowIso(),
      updatedAt: nowIso(),
    });
    recordAudit(viewer, "撤销成员邀请", invitationId, "已完成", invitationRow(invitation), null, req);
  }
  const saved = one(`SELECT invitations.*, parent.name AS parent_name, creator.name AS created_by_name
    FROM invitations
    LEFT JOIN accounts parent ON parent.id = invitations.parent_id
    LEFT JOIN accounts creator ON creator.id = invitations.created_by
    WHERE invitations.id = :id`, { id: invitationId });
  sendJson(res, 200, { invitation: invitationRow(saved) });
}

async function reviewAccountApproval(req, res, viewer, accountId) {
  requireRole(viewer, ["admin"]);
  const body = await readJson(req);
  const approvalStatus = body.approvalStatus;
  if (!["approved", "rejected"].includes(approvalStatus)) return sendJson(res, 400, { error: "确认结果无效" });
  const target = one("SELECT * FROM accounts WHERE id = :id", { id: accountId });
  if (!target || orgIdOf(target) !== orgIdOf(viewer) || !["manager", "user"].includes(target.role)) {
    return sendJson(res, 404, { error: "待确认账号不存在" });
  }
  if ((target.approval_status || "approved") !== "pending") return sendJson(res, 409, { error: "该账号已经处理" });

  const now = nowIso();
  run(`UPDATE accounts
    SET approval_status = :approvalStatus,
        status = :status,
        disabled_at = :disabledAt,
        updated_at = :updatedAt
    WHERE id = :id`, {
    id: target.id,
    approvalStatus,
    status: approvalStatus === "approved" ? "离线" : "已拒绝",
    disabledAt: approvalStatus === "rejected" ? now : null,
    updatedAt: now,
  });
  run("UPDATE invitation_uses SET approval_status = :approvalStatus WHERE account_id = :accountId", {
    accountId: target.id,
    approvalStatus,
  });
  if (approvalStatus === "rejected") {
    run("UPDATE sessions SET revoked_at = COALESCE(revoked_at, :revokedAt) WHERE account_id = :accountId", {
      accountId: target.id,
      revokedAt: now,
    });
  }
  const saved = one("SELECT * FROM accounts WHERE id = :id", { id: target.id });
  recordAudit(viewer, approvalStatus === "approved" ? "确认成员加入" : "拒绝成员加入", saved.name, "已完成", sanitizeAccount(target), sanitizeAccount(saved), req);
  sendJson(res, 200, { account: sanitizeAccount(saved) });
}

async function createOrganization(req, res, viewer) {
  requireRole(viewer, ["developer"]);
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "组织名称不能为空" });
  const row = {
    id: makeId("组织"),
    name,
    description: String(body.description || "").trim(),
    createdAt: nowIso(),
  };
  run("INSERT INTO organizations (id,name,description,created_at,updated_at) VALUES (:id,:name,:description,:createdAt,:updatedAt)", {
    ...row,
    updatedAt: row.createdAt,
  });
  recordAudit(viewer, "新增组织", name, "已完成", null, { ...row, orgId: row.id }, req);
  sendJson(res, 201, { organization: row });
}

async function createAccount(req, res, viewer) {
  const body = await readJson(req);
  const account = String(body.account || "").trim();
  const name = String(body.name || "").trim();
  const role = body.role;
  const password = String(body.password || "");
  if (!account || !name || !role || !password) return sendJson(res, 400, { error: "姓名、账号、身份和初始密码不能为空" });
  if (password.length < 8) return sendJson(res, 400, { error: "初始密码至少需要 8 个字符" });
  if (!canManageAccount(viewer, role)) return sendJson(res, 403, { error: "没有权限创建该身份" });
  if (one("SELECT id FROM accounts WHERE role = :role AND account = :account", { role, account })) return sendJson(res, 409, { error: "该账号已经存在" });

  const parent = body.parentId ? one("SELECT * FROM accounts WHERE id = :id", { id: body.parentId }) : null;
  const effectiveParent = parent || (viewer.role === "admin" ? viewer : null);
  const requestedOrgId = body.orgId || body.organizationId || null;
  const organizationId = viewer.role === "developer"
    ? (requestedOrgId || orgIdOf(effectiveParent))
    : orgIdOf(viewer);
  if (role !== "developer" && !organizationId) return sendJson(res, 400, { error: "租户账号必须归属组织" });
  if (organizationId && !one("SELECT id FROM organizations WHERE id = :id", { id: organizationId })) return sendJson(res, 400, { error: "组织不存在" });
  if (parent && orgIdOf(parent) !== organizationId) return sendJson(res, 403, { error: "直属上级必须属于同一组织" });
  if (role === "admin" && parent) return sendJson(res, 400, { error: "管理员账号不设置直属上级" });
  if (role === "manager" && parent && parent.role !== "admin") return sendJson(res, 400, { error: "经理的直属上级必须是管理员" });
  if (role === "user" && parent && !["manager", "admin"].includes(parent.role)) return sendJson(res, 400, { error: "用户的直属上级必须是经理或管理员" });
  const id = `${role}-${account}`;
  const row = {
    id,
    account,
    name,
    role,
    department: String(body.department || "未设置").trim() || "未设置",
    orgId: organizationId,
    organizationId,
    parentId: effectiveParent?.id || null,
    parentName: effectiveParent?.name || "未设置",
    adminId: role === "manager" ? (effectiveParent?.role === "admin" ? effectiveParent.id : viewer.role === "admin" ? viewer.id : null) : role === "user" ? (effectiveParent?.role === "admin" ? effectiveParent.id : effectiveParent?.admin_id || (viewer.role === "admin" ? viewer.id : null)) : null,
    managerId: role === "user" && effectiveParent?.role === "manager" ? effectiveParent.id : null,
    status: "离线",
    createdAt: nowIso(),
  };
  run(`INSERT INTO accounts (id,account,password_hash,name,role,department,org_id,organization_id,parent_id,parent_name,admin_id,manager_id,status,approval_status,joined_at,created_at,updated_at)
    VALUES (:id,:account,:passwordHash,:name,:role,:department,:orgId,:organizationId,:parentId,:parentName,:adminId,:managerId,:status,'approved',:createdAt,:createdAt,:updatedAt)`, {
    ...row,
    passwordHash: hashPassword(password),
    updatedAt: row.createdAt,
  });
  if (role === "admin" && organizationId) {
    run("UPDATE organizations SET owner_admin_id = COALESCE(owner_admin_id, :adminId), updated_at = :updatedAt WHERE id = :orgId", {
      adminId: id,
      orgId: organizationId,
      updatedAt: row.createdAt,
    });
  }
  recordAudit(viewer, "新增账号", `${name} · ${role}`, "已完成", null, row, req);
  sendJson(res, 201, { account: sanitizeAccount(one("SELECT * FROM accounts WHERE id = :id", { id })) });
}

async function createProject(req, res, viewer) {
  const body = await readJson(req);
  if (!body.name) return sendJson(res, 400, { error: "项目名称不能为空" });
  const now = nowIso();
  const accounts = accountRows();
  const requestedOwnerId = body.ownerUserId || body.ownerId || viewer.id;
  const ownerAccount = one("SELECT * FROM accounts WHERE id = :id AND disabled_at IS NULL", { id: requestedOwnerId });
  if (!ownerAccount) return sendJson(res, 400, { error: "项目负责人不存在" });
  if (viewer.role === "user" && requestedOwnerId !== viewer.id) return sendJson(res, 403, { error: "用户只能创建自己的项目" });
  if (viewer.role !== "developer" && orgIdOf(ownerAccount) !== orgIdOf(viewer)) return sendJson(res, 403, { error: "项目负责人必须属于当前组织" });
  if (viewer.role === "manager" && ![viewer.id, ...visibleAccounts(accounts, viewer).map((account) => account.id)].includes(requestedOwnerId)) return sendJson(res, 403, { error: "经理只能为自己或直属用户创建项目" });
  const orgId = orgIdOf(ownerAccount);
  if (!orgId && !(viewer.role === "developer" && requestedOwnerId === viewer.id)) return sendJson(res, 400, { error: "租户项目必须归属组织" });
  const project = {
    id: body.id || makeId("project"),
    orgId,
    name: String(body.name),
    type: body.type || "短剧",
    aspectRatio: body.aspectRatio || "16:9",
    style: body.style || "",
    description: body.description || "",
    stage: body.stage || "项目筹备",
    progress: Number(body.progress || 5),
    ownerUserId: requestedOwnerId,
    ownerId: requestedOwnerId,
    organizationId: orgId,
    createdAt: now,
  };
  run(`INSERT INTO projects (id,org_id,name,type,aspect_ratio,style,description,stage,progress,owner_user_id,owner_id,organization_id,created_at,updated_at)
    VALUES (:id,:orgId,:name,:type,:aspectRatio,:style,:description,:stage,:progress,:ownerUserId,:ownerId,:organizationId,:createdAt,:updatedAt)`, {
    ...project,
    updatedAt: now,
  });
  recordAudit(viewer, "新建项目", project.name, "已完成", null, project, req);
  sendJson(res, 201, { project });
}

async function createAsset(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const now = nowIso();
  const asset = {
    id: body.id || makeId("asset"),
    orgId: project.org_id || project.organization_id,
    projectId: project.id,
    ownerUserId: project.owner_user_id || project.owner_id,
    type: body.type || "",
    typeLabel: body.typeLabel || "",
    name: body.name || "未命名资产",
    code: body.code || `资产${String(Date.now()).slice(-4)}`,
    version: Number(body.version || 1),
    status: body.status || "待生成",
    prompt: body.prompt || "",
    notes: body.notes || "",
    filename: body.filename || "",
    createdAt: now,
  };
  run(`INSERT INTO assets (id,org_id,project_id,owner_user_id,type,type_label,name,code,version,status,prompt,notes,filename,created_at,updated_at)
    VALUES (:id,:orgId,:projectId,:ownerUserId,:type,:typeLabel,:name,:code,:version,:status,:prompt,:notes,:filename,:createdAt,:updatedAt)`, {
    ...asset,
    updatedAt: now,
  });
  recordAudit(viewer, "新建资产", asset.name, asset.status, null, { ...asset, projectName: project.name }, req);
  sendJson(res, 201, { asset });
}

async function createAssetFolder(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "文件夹名称不能为空" });
  const existing = one("SELECT * FROM asset_folders WHERE project_id = :projectId AND name = :name AND deleted_at IS NULL", { projectId: project.id, name });
  if (existing) return sendJson(res, 200, { folder: assetFolderRow(existing) });
  const now = nowIso();
  const folder = { id: makeId("folder"), orgId: project.org_id || project.organization_id, projectId: project.id, name, createdBy: viewer.id, createdAt: now };
  run(`INSERT INTO asset_folders (id,org_id,project_id,name,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:projectId,:name,:createdBy,:createdAt,:createdAt)`, folder);
  recordAudit(viewer, "新建资产文件夹", name, "已完成", null, { ...folder, projectName: project.name }, req);
  sendJson(res, 201, { folder });
}

async function uploadAssetFile(req, res, viewer, assetId) {
  const asset = one("SELECT * FROM assets WHERE id = :id AND deleted_at IS NULL", { id: assetId });
  if (!asset) return sendJson(res, 404, { error: "资产不存在" });
  const project = assertProjectAccess(asset.project_id, viewer);
  const body = await readJson(req);
  const version = Number(asset.version || 1);
  const saved = await saveAssetFile({
    projectId: project.id,
    assetId: asset.id,
    assetType: asset.type_label || asset.type || "未归类",
    version,
    fileName: body.fileName,
    mimeType: body.mimeType,
    dataUrl: body.dataUrl,
  });
  const now = nowIso();
  const fileId = makeId("file");
  run(`INSERT INTO asset_files (id,org_id,asset_id,project_id,owner_user_id,owner_id,kind,asset_type,original_name,stored_name,mime_type,size_bytes,original_path,preview_path,thumbnail_path,original_url,preview_url,thumbnail_url,checksum,version,created_at)
    VALUES (:id,:orgId,:assetId,:projectId,:ownerUserId,:ownerId,:kind,:assetType,:originalName,:storedName,:mimeType,:sizeBytes,:originalPath,:previewPath,:thumbnailPath,:originalUrl,:previewUrl,:thumbnailUrl,:checksum,:version,:createdAt)`, {
    id: fileId,
    orgId: asset.org_id,
    assetId: asset.id,
    projectId: project.id,
    ownerUserId: asset.owner_user_id || project.owner_user_id || viewer.id,
    ownerId: viewer.id,
    kind: body.kind || "原图",
    assetType: asset.type_label || asset.type || "未归类",
    originalName: body.fileName,
    storedName: saved.storedName,
    mimeType: saved.mimeType,
    sizeBytes: saved.sizeBytes,
    originalPath: saved.originalPath,
    previewPath: saved.previewPath,
    thumbnailPath: saved.thumbnailPath,
    originalUrl: saved.originalUrl,
    previewUrl: saved.previewUrl,
    thumbnailUrl: saved.thumbnailUrl,
    checksum: saved.checksum,
    version,
    createdAt: now,
  });
  run(`UPDATE assets SET image_url = :imageUrl, image_full_url = :imageFullUrl, thumbnail_url = :thumbnailUrl, filename = :filename, status = :status, updated_at = :updatedAt WHERE id = :id`, {
    id: asset.id,
    imageUrl: saved.previewUrl || saved.originalUrl,
    imageFullUrl: saved.originalUrl,
    thumbnailUrl: saved.thumbnailUrl || saved.previewUrl || saved.originalUrl,
    filename: body.fileName || asset.filename,
    status: asset.status === "待生成" ? "待审核" : asset.status,
    updatedAt: now,
  });
  const updatedAsset = assetRow(one("SELECT * FROM assets WHERE id = :id", { id: asset.id }));
  const file = fileRow(one("SELECT * FROM asset_files WHERE id = :id", { id: fileId }));
  recordAudit(viewer, "上传文件", body.fileName, "已完成", null, { file, projectName: project.name }, req);
  sendJson(res, 201, { asset: updatedAsset, file });
}

async function deleteAsset(req, res, viewer, assetId) {
  const asset = one("SELECT * FROM assets WHERE id = :id AND deleted_at IS NULL", { id: assetId });
  if (!asset) return sendJson(res, 404, { error: "资产不存在" });
  const project = assertProjectAccess(asset.project_id, viewer);
  if (!canAccessTenantRow(asset, accountRows(), viewer)) {
    return sendJson(res, 403, { error: "没有权限删除该资产" });
  }
  const now = nowIso();
  run("UPDATE assets SET deleted_at = :deletedAt, updated_at = :updatedAt WHERE id = :id", {
    id: asset.id,
    deletedAt: now,
    updatedAt: now,
  });
  run("UPDATE asset_files SET deleted_at = :deletedAt WHERE asset_id = :assetId AND deleted_at IS NULL", {
    assetId: asset.id,
    deletedAt: now,
  });
  recordAudit(viewer, "删除资产", asset.name, "已完成", { ...asset, projectName: project.name }, { id: asset.id, deletedAt: now, projectName: project.name }, req);
  sendJson(res, 200, { ok: true, assetId: asset.id });
}

function insertImageTaskRecord({ project, viewer, body, queueState, prompt, negativePrompt, batchCount = 4 }) {
  const now = nowIso();
  const task = {
    id: body.id || makeId("任务"),
    orgId: project.org_id || project.organization_id || "platform",
    projectId: project.id,
    assetId: body.assetId || null,
    ownerUserId: project.owner_user_id || project.owner_id || viewer.id,
    name: body.name || "未命名任务",
    type: body.type || "",
    ratio: body.ratio || project.aspect_ratio || "",
    prompt: prompt ?? body.prompt ?? "",
    negativePrompt: negativePrompt ?? body.negativePrompt ?? body.negative_prompt ?? "",
    style: body.style || "",
    modelName: body.modelName || body.model_name || "",
    provider: body.provider || queueState.provider || "未配置",
    seed: body.seed ?? "",
    generationCost: Number(body.generationCost || 0),
    status: queueState.status,
    progress: queueState.progress,
    errorMessage: queueState.errorMessage,
    batchCount: Math.max(1, Math.min(8, Number(batchCount) || 4)),
    createdAt: now,
  };
  if (!task.prompt) {
    const error = new Error("提示词不能为空");
    error.status = 400;
    throw error;
  }
  run(`INSERT INTO generation_jobs (id,org_id,project_id,asset_id,owner_user_id,name,type,ratio,prompt,negative_prompt,style,model_name,provider,seed,generation_cost,status,progress,error_message,batch_count,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:projectId,:assetId,:ownerUserId,:name,:type,:ratio,:prompt,:negativePrompt,:style,:modelName,:provider,:seed,:generationCost,:status,:progress,:errorMessage,:batchCount,:createdBy,:createdAt,:updatedAt)`, {
    ...task,
    createdBy: viewer.id,
    updatedAt: now,
  });
  return one("SELECT * FROM generation_jobs WHERE id = :id", { id: task.id });
}

async function createImageTask(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  if (body.assetId) {
    const asset = one("SELECT * FROM assets WHERE id = :id AND deleted_at IS NULL", { id: body.assetId });
    if (!asset || asset.project_id !== project.id || asset.org_id !== (project.org_id || project.organization_id)) {
      return sendJson(res, 403, { error: "关联资产不属于当前项目或组织" });
    }
  }
  const connection = imageConnectionFor(viewer.id);
  const connected = Boolean(connection.endpoint_url && connection.connection_status === "已连接");
  const queueState = connected
    ? { status: "排队中", progress: 1, errorMessage: "", provider: "图片服务" }
    : await enqueueGenerationTask(body, {});
  const task = insertImageTaskRecord({ project, viewer, body, queueState, batchCount: body.batchCount || body.count || 4 });
  const saved = connected ? await generateImageJob(task, viewer, connection) : task;
  recordAudit(viewer, "新建生图任务", task.name, saved.status, null, { ...imageTaskRow(saved, []), projectName: project.name }, req);
  const results = all("SELECT * FROM generation_results WHERE generation_job_id = :jobId ORDER BY created_at ASC", { jobId: saved.id }).map(imageResultRow);
  sendJson(res, 201, { imageTask: imageTaskRow(saved, results) });
}

const IMAGE_ASSET_TYPES = {
  图片: "image",
  人物: "character",
  服装: "costume",
  场景: "scene",
  道具: "prop",
  群演: "extras",
  分镜静帧: "storyboard",
};

async function createImageWorkflow(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const template = one("SELECT * FROM skill_templates WHERE id = :id", { id: body.templateId });
  if (!canUseSkillTemplate(template, viewer)) return sendJson(res, 403, { error: "没有权限使用该规范模板" });
  const request = String(body.request || "").trim();
  if (!request) return sendJson(res, 400, { error: "请先输入本次具体需求" });
  if (request.length > 80_000) return sendJson(res, 413, { error: "本次需求过长，请拆成多批提交" });
  const projectAssets = all("SELECT * FROM assets WHERE project_id = :projectId AND deleted_at IS NULL ORDER BY created_at DESC", { projectId: project.id }).filter((asset) => asset.status === "已通过").map(assetRow);
  const skill = skillTemplateRow(template);
  const aspectRatio = String(body.aspectRatio || template.recommended_ratio || project.aspect_ratio || "16:9").trim();
  const archiveCategory = String(body.archiveCategory || template.asset_type_label || "图片").trim();
  const type = IMAGE_ASSET_TYPES[archiveCategory] || template.type || "image";
  const baseName = String(body.assetName || `${project.name}-${archiveCategory}`).trim();
  const workflow = compileImageWorkflow({
    request,
    skill,
    project: projectRow(project),
    assetName: baseName,
    aspectRatio,
    approvedAssets: projectAssets,
    negativePrompt: body.negativePrompt,
  });
  if (!workflow.variants.length) return sendJson(res, 400, { error: "没有可生成的需求内容" });

  const connection = imageConnectionFor(viewer.id);
  const connected = Boolean(connection.endpoint_url && connection.connection_status === "已连接");
  const batchCount = Math.max(1, Math.min(8, Number(body.count || body.batchCount) || 4));
  const savedTasks = [];
  for (const variant of workflow.variants) {
    const suffix = workflow.variants.length > 1 ? ` · 第${variant.index}批` : "";
    const now = nowIso();
    const asset = {
      id: makeId("asset"),
      orgId: project.org_id || project.organization_id || "platform",
      projectId: project.id,
      ownerUserId: project.owner_user_id || project.owner_id || viewer.id,
      type,
      typeLabel: archiveCategory,
      name: `${baseName}${suffix}`,
      code: `生图${String(Date.now()).slice(-4)}`,
      version: 1,
      status: connected ? "生成中" : "待生成",
      prompt: variant.prompt,
      notes: `规范抽取：${Object.keys(variant.extraction).join("、") || "原始需求"}；生成张数：${batchCount}；可在生成队列中重生。`,
      filename: `${project.name}_${archiveCategory}_${Date.now()}_第1版_待生成.png`,
      createdAt: now,
    };
    run(`INSERT INTO assets (id,org_id,project_id,owner_user_id,type,type_label,name,code,version,status,prompt,notes,filename,created_at,updated_at)
      VALUES (:id,:orgId,:projectId,:ownerUserId,:type,:typeLabel,:name,:code,:version,:status,:prompt,:notes,:filename,:createdAt,:updatedAt)`, { ...asset, updatedAt: now });
    const spec = {
      id: makeId("spec"),
      orgId: asset.orgId,
      projectId: project.id,
      templateId: template.id,
      templateKey: template.template_key,
      templateVersion: template.version || 1,
      ownerUserId: asset.ownerUserId,
      title: asset.name,
      type,
      assetTypeLabel: archiveCategory,
      content: variant.prompt,
      notes: asset.notes,
      status: connected ? "生成中" : "待确认",
      linkedAssetId: asset.id,
      createdBy: viewer.id,
      createdAt: now,
    };
    run(`INSERT INTO production_specs (id,org_id,project_id,template_id,template_key,template_version,owner_user_id,title,type,asset_type_label,content,notes,status,linked_asset_id,created_by,created_at,updated_at)
      VALUES (:id,:orgId,:projectId,:templateId,:templateKey,:templateVersion,:ownerUserId,:title,:type,:assetTypeLabel,:content,:notes,:status,:linkedAssetId,:createdBy,:createdAt,:updatedAt)`, { ...spec, updatedAt: now });
    const task = insertImageTaskRecord({
      project,
      viewer,
      body: {
        id: makeId("任务"),
        assetId: asset.id,
        name: asset.name,
        type: archiveCategory,
        ratio: aspectRatio,
        style: project.style,
        modelName: body.modelName || connection.model_name || "",
        seed: body.seed ?? "",
        count: batchCount,
      },
      queueState: connected ? { status: "排队中", progress: 1, errorMessage: "", provider: "图片服务" } : await enqueueGenerationTask({}, {}),
      prompt: variant.prompt,
      negativePrompt: variant.negativePrompt,
      batchCount,
    });
    const saved = connected ? await generateImageJob(task, viewer, connection) : task;
    workflow.variants[variant.index - 1] = { ...variant, taskId: saved.id, assetId: asset.id, status: saved.status };
    savedTasks.push(saved);
  }
  recordAudit(viewer, "从规范批量生成图片", baseName, savedTasks.some((task) => task.status === "失败") ? "部分失败" : "已完成", null, {
    projectName: project.name,
    variantCount: workflow.variants.length,
    batchCount,
    skillName: template.name,
    taskIds: savedTasks.map((task) => task.id),
  }, req);
  const tasks = savedTasks.map((task) => imageTaskRow(task, all("SELECT * FROM generation_results WHERE generation_job_id = :jobId ORDER BY created_at ASC", { jobId: task.id }).map(imageResultRow)));
  sendJson(res, 201, { workflow, imageTasks: tasks });
}

async function createSkillTemplate(req, res, viewer) {
  requireRole(viewer, ["developer", "admin"]);
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  const type = String(body.type || "").trim();
  if (!name || !type) return sendJson(res, 400, { error: "模板名称和类型不能为空" });

  const requestedOrgId = body.orgId || body.organizationId || null;
  const orgId = viewer.role === "developer" ? (body.scope === "平台" ? null : requestedOrgId) : orgIdOf(viewer);
  if (viewer.role === "developer" && body.scope === "组织" && !requestedOrgId) return sendJson(res, 400, { error: "组织模板必须选择所属组织" });
  if (viewer.role !== "developer" && !orgId) return sendJson(res, 400, { error: "组织模板必须归属组织" });
  if (orgId && !one("SELECT id FROM organizations WHERE id = :id", { id: orgId })) return sendJson(res, 400, { error: "组织不存在" });

  const now = nowIso();
  const keyBase = String(body.templateKey || body.key || name).trim().replace(/[^\w.-]+/g, "_").slice(0, 64) || "template";
  const template = {
    id: body.id || makeId("skill"),
    orgId,
    templateKey: `${keyBase}-${Date.now()}`,
    name,
    type,
    description: String(body.description || "").trim(),
    assetTypeLabel: String(body.assetTypeLabel || body.typeLabel || "制作记录").trim(),
    recommendedRatio: String(body.recommendedRatio || "").trim(),
    fieldsJson: JSON.stringify(Array.isArray(body.fields) ? body.fields : [{ key: "requirement", label: "制作要求", required: true }]),
    checklistJson: JSON.stringify(Array.isArray(body.checklist) ? body.checklist : []),
    sourceContent: String(body.sourceContent || "").trim(),
    sourceFilesJson: JSON.stringify(Array.isArray(body.sourceFiles) ? body.sourceFiles : []),
    version: Number(body.version || 1),
    status: body.status || "启用",
    scope: orgId ? "组织" : "平台",
    createdBy: viewer.id,
    createdAt: now,
  };

  run(`INSERT INTO skill_templates (id,org_id,template_key,name,type,description,asset_type_label,recommended_ratio,fields_json,checklist_json,source_content,source_files_json,version,status,scope,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:templateKey,:name,:type,:description,:assetTypeLabel,:recommendedRatio,:fieldsJson,:checklistJson,:sourceContent,:sourceFilesJson,:version,:status,:scope,:createdBy,:createdAt,:updatedAt)`, {
    ...template,
    updatedAt: now,
  });
  recordAudit(viewer, "新增规范模板", template.name, "已完成", null, template, req);
  sendJson(res, 201, { skillTemplate: skillTemplateRow(one("SELECT * FROM skill_templates WHERE id = :id", { id: template.id })) });
}

async function updateSkillTemplate(req, res, viewer, templateId) {
  requireRole(viewer, ["developer", "admin"]);
  const before = one("SELECT * FROM skill_templates WHERE id = :id", { id: templateId });
  if (!before) return sendJson(res, 404, { error: "模板不存在" });
  if (viewer.role !== "developer" && before.org_id !== orgIdOf(viewer)) return sendJson(res, 403, { error: "只能修改本组织模板" });
  if (viewer.role !== "developer" && before.scope === "平台") return sendJson(res, 403, { error: "组织管理员不能修改平台模板" });
  const body = await readJson(req);
  const after = {
    id: templateId,
    name: body.name ?? before.name,
    description: body.description ?? before.description,
    assetTypeLabel: body.assetTypeLabel ?? before.asset_type_label,
    recommendedRatio: body.recommendedRatio ?? before.recommended_ratio,
    fieldsJson: Array.isArray(body.fields) ? JSON.stringify(body.fields) : before.fields_json,
    checklistJson: Array.isArray(body.checklist) ? JSON.stringify(body.checklist) : before.checklist_json,
    sourceContent: body.sourceContent ?? before.source_content,
    sourceFilesJson: Array.isArray(body.sourceFiles) ? JSON.stringify(body.sourceFiles) : before.source_files_json,
    status: body.status ?? before.status,
    updatedAt: nowIso(),
  };
  run(`UPDATE skill_templates SET name = :name, description = :description, asset_type_label = :assetTypeLabel,
    recommended_ratio = :recommendedRatio, fields_json = :fieldsJson, checklist_json = :checklistJson,
    source_content = :sourceContent, source_files_json = :sourceFilesJson, status = :status,
    updated_at = :updatedAt WHERE id = :id`, after);
  const saved = one("SELECT * FROM skill_templates WHERE id = :id", { id: templateId });
  recordAudit(viewer, "更新规范模板", saved.name, "已完成", before, saved, req);
  sendJson(res, 200, { skillTemplate: skillTemplateRow(saved) });
}

async function createProductionSpec(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const template = one("SELECT * FROM skill_templates WHERE id = :id", { id: body.templateId });
  if (!canUseSkillTemplate(template, viewer)) return sendJson(res, 403, { error: "没有权限使用该规范模板" });
  const content = String(body.content || "").trim();
  if (!content) return sendJson(res, 400, { error: "制作要求不能为空" });

  const now = nowIso();
  const specType = String(body.type || template.type || "script").trim();
  const specAssetTypeLabel = String(body.assetTypeLabel || template.asset_type_label || "制作记录").trim();
  const spec = {
    id: body.id || makeId("spec"),
    orgId: project.org_id || project.organization_id,
    projectId: project.id,
    templateId: template.id,
    templateKey: template.template_key,
    templateVersion: template.version || 1,
    ownerUserId: project.owner_user_id || project.owner_id,
    title: body.title || template.name,
    type: specType,
    assetTypeLabel: specAssetTypeLabel,
    content,
    notes: body.notes || `制作规范：${template.name}；所属项目：${project.name}。`,
    status: body.status || "待确认",
    linkedAssetId: null,
    createdBy: viewer.id,
    createdAt: now,
  };

  let linkedAsset = null;
  if (body.createAsset !== false) {
    const filenameExt = ["script", "shotlist", "video", "workflow"].includes(spec.type) ? "txt" : "png";
    linkedAsset = {
      id: makeId("asset"),
      orgId: spec.orgId,
      projectId: project.id,
      ownerUserId: spec.ownerUserId,
      type: spec.type,
      typeLabel: spec.assetTypeLabel,
      name: spec.title,
      code: `规范${String(Date.now()).slice(-4)}`,
      version: 1,
      status: "待生成",
      prompt: spec.content,
      notes: spec.notes,
      filename: `${project.name}_${spec.assetTypeLabel}_${Date.now()}_第1版_待生成.${filenameExt}`,
      createdAt: now,
    };
    run(`INSERT INTO assets (id,org_id,project_id,owner_user_id,type,type_label,name,code,version,status,prompt,notes,filename,created_at,updated_at)
      VALUES (:id,:orgId,:projectId,:ownerUserId,:type,:typeLabel,:name,:code,:version,:status,:prompt,:notes,:filename,:createdAt,:updatedAt)`, {
      ...linkedAsset,
      updatedAt: now,
    });
    spec.linkedAssetId = linkedAsset.id;
  }

  run(`INSERT INTO production_specs (id,org_id,project_id,template_id,template_key,template_version,owner_user_id,title,type,asset_type_label,content,notes,status,linked_asset_id,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:projectId,:templateId,:templateKey,:templateVersion,:ownerUserId,:title,:type,:assetTypeLabel,:content,:notes,:status,:linkedAssetId,:createdBy,:createdAt,:updatedAt)`, {
    ...spec,
    updatedAt: now,
  });
  const saved = productionSpecRow(one("SELECT * FROM production_specs WHERE id = :id", { id: spec.id }));
  recordAudit(viewer, "保存制作规范", spec.title, spec.status, null, { ...saved, projectName: project.name }, req);
  sendJson(res, 201, {
    productionSpec: saved,
    asset: linkedAsset ? assetRow(one("SELECT * FROM assets WHERE id = :id", { id: linkedAsset.id })) : null,
  });
}

async function saveWeddingWorkflow(req, res, viewer) {
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const currentStep = Math.min(14, Math.max(1, Number(body.currentStep) || 1));
  const completedSteps = Array.isArray(body.completedSteps)
    ? [...new Set(body.completedSteps.map(Number).filter((step) => step >= 1 && step <= 14))]
    : [];
  const notes = body.notes && typeof body.notes === "object" ? body.notes : {};
  const story = body.story && typeof body.story === "object" ? body.story : {};
  const imageTaskIds = Array.isArray(body.imageTaskIds) ? body.imageTaskIds.map(String).slice(0, 200) : [];
  const notesJson = JSON.stringify(notes);
  const storyJson = JSON.stringify(story);
  if (notesJson.length > 120_000 || storyJson.length > 120_000) return sendJson(res, 413, { error: "婚礼制作资料过长，请拆分后保存" });
  const now = nowIso();
  const before = one("SELECT * FROM wedding_workflows WHERE project_id = :projectId", { projectId: project.id });
  const workflow = {
    id: before?.id || body.id || makeId("婚礼流程"),
    orgId: project.org_id || project.organization_id || null,
    projectId: project.id,
    ownerUserId: project.owner_user_id || project.owner_id || viewer.id,
    currentStep,
    status: String(body.status || before?.status || "进行中").slice(0, 40),
    completedStepsJson: JSON.stringify(completedSteps),
    notesJson,
    storyJson,
    imageTaskIdsJson: JSON.stringify(imageTaskIds),
    createdBy: before?.created_by || viewer.id,
    createdAt: before?.created_at || now,
    updatedAt: now,
  };
  run(`INSERT INTO wedding_workflows
      (id,org_id,project_id,owner_user_id,current_step,status,completed_steps_json,notes_json,story_json,image_task_ids_json,created_by,created_at,updated_at)
    VALUES (:id,:orgId,:projectId,:ownerUserId,:currentStep,:status,:completedStepsJson,:notesJson,:storyJson,:imageTaskIdsJson,:createdBy,:createdAt,:updatedAt)
    ON CONFLICT(project_id) DO UPDATE SET
      current_step = excluded.current_step,
      status = excluded.status,
      completed_steps_json = excluded.completed_steps_json,
      notes_json = excluded.notes_json,
      story_json = excluded.story_json,
      image_task_ids_json = excluded.image_task_ids_json,
      updated_at = excluded.updated_at`, workflow);
  const saved = one("SELECT * FROM wedding_workflows WHERE project_id = :projectId", { projectId: project.id });
  recordAudit(viewer, "保存婚礼制作流程", project.name, workflow.status, before, { ...saved, projectName: project.name }, req);
  sendJson(res, 200, { weddingWorkflow: weddingWorkflowRow(saved) });
}

async function retryImageTask(req, res, viewer, taskId) {
  const task = one("SELECT * FROM generation_jobs WHERE id = :id", { id: taskId });
  if (!task) return sendJson(res, 404, { error: "任务不存在" });
  const project = assertProjectAccess(task.project_id, viewer);
  const connection = imageConnectionFor(viewer.id);
  const connected = Boolean(connection.endpoint_url && connection.connection_status === "已连接");
  run("UPDATE generation_jobs SET retry_count = retry_count + 1, status = :status, progress = :progress, error_message = :errorMessage, updated_at = :updatedAt WHERE id = :id", {
    id: taskId,
    status: connected ? "排队中" : "待接入",
    progress: connected ? 1 : 0,
    errorMessage: connected ? "" : "生成服务尚未配置，任务已保存到后端队列。",
    updatedAt: nowIso(),
  });
  const updated = one("SELECT * FROM generation_jobs WHERE id = :id", { id: taskId });
  const saved = connected ? await generateImageJob(updated, viewer, connection) : updated;
  recordAudit(viewer, "重试生图任务", task.name, saved.status, task, { taskId, projectName: project.name }, req);
  const results = all("SELECT * FROM generation_results WHERE generation_job_id = :jobId ORDER BY created_at ASC", { jobId: taskId }).map(imageResultRow);
  sendJson(res, 200, { imageTask: imageTaskRow(saved, results) });
}

async function approveImageTask(req, res, viewer, taskId) {
  const task = one("SELECT * FROM generation_jobs WHERE id = :id AND media_kind = 'image'", { id: taskId });
  if (!task) return sendJson(res, 404, { error: "图片任务不存在" });
  const project = assertProjectAccess(task.project_id, viewer);
  const body = await readJson(req);
  const result = one("SELECT * FROM generation_results WHERE id = :id AND generation_job_id = :jobId AND discarded_at IS NULL", { id: body.resultId, jobId: task.id });
  if (!result) return sendJson(res, 400, { error: "请选择当前任务中的有效结果图" });
  const now = nowIso();
  run("UPDATE generation_results SET selected_at = :selectedAt WHERE generation_job_id = :jobId AND discarded_at IS NULL", { selectedAt: null, jobId: task.id });
  run("UPDATE generation_results SET selected_at = :selectedAt WHERE id = :id", { selectedAt: now, id: result.id });
  run("UPDATE generation_jobs SET selected_result_id = :resultId, status = '已通过', progress = 100, error_message = '', updated_at = :updatedAt WHERE id = :id", { resultId: result.id, updatedAt: now, id: task.id });
  let asset = null;
  if (task.asset_id) {
    run("UPDATE assets SET image_url = :imageUrl, image_full_url = :imageFullUrl, thumbnail_url = :thumbnailUrl, status = '已通过', updated_at = :updatedAt WHERE id = :id", {
      id: task.asset_id,
      imageUrl: result.thumb_url,
      imageFullUrl: result.full_url,
      thumbnailUrl: result.thumb_url,
      updatedAt: now,
    });
    asset = assetRow(one("SELECT * FROM assets WHERE id = :id", { id: task.asset_id }));
  }
  recordAudit(viewer, "通过并锁版", task.name, "已通过", task, { taskId: task.id, resultId: result.id, assetId: task.asset_id, projectName: project.name }, req);
  const savedTask = one("SELECT * FROM generation_jobs WHERE id = :id", { id: task.id });
  const results = all("SELECT * FROM generation_results WHERE generation_job_id = :jobId ORDER BY created_at ASC", { jobId: task.id }).map(imageResultRow);
  sendJson(res, 200, { imageTask: imageTaskRow(savedTask, results), asset });
}

async function updateH3Connection(req, res, viewer) {
  enforceRateLimit(req, "h3-connect", 20);
  const body = await readJson(req);
  const endpointUrl = normalizeH3Endpoint(body.endpointUrl);
  const modelName = String(body.modelName || "MiniMaxAI/MiniMax-H3").trim() || "MiniMaxAI/MiniMax-H3";
  if (!endpointUrl) return sendJson(res, 400, { error: "请填写云显卡地址" });
  if (modelName.length > 200) return sendJson(res, 400, { error: "模型标识过长" });
  if (body.clearKey) clearH3Secret(viewer.id);
  if (String(body.apiKey || "").trim()) rememberH3Secret(viewer.id, body.apiKey);

  const now = nowIso();
  const existing = one("SELECT * FROM provider_connections WHERE account_id = :accountId AND provider_key = 'minimax-h3-sglang'", { accountId: viewer.id });
  const id = existing?.id || makeId("连接");
  run(`INSERT INTO provider_connections
      (id,org_id,account_id,provider_key,endpoint_url,model_name,connection_status,last_error,last_checked_at,created_at,updated_at)
    VALUES (:id,:orgId,:accountId,'minimax-h3-sglang',:endpointUrl,:modelName,'待检测','',NULL,:createdAt,:updatedAt)
    ON CONFLICT(account_id,provider_key) DO UPDATE SET
      endpoint_url = excluded.endpoint_url,
      model_name = excluded.model_name,
      connection_status = '待检测',
      last_error = '',
      updated_at = excluded.updated_at`, {
    id,
    orgId: orgIdOf(viewer),
    accountId: viewer.id,
    endpointUrl,
    modelName,
    createdAt: existing?.created_at || now,
    updatedAt: now,
  });

  let status = "已连接";
  let lastError = "";
  let checkedPath = "";
  try {
    const checked = await testH3Connection({ endpointUrl, apiKey: getH3Secret(viewer.id) });
    checkedPath = checked.checkedPath;
  } catch (error) {
    status = "连接失败";
    lastError = String(error?.message || "连接检测失败").slice(0, 500);
  }
  const checkedAt = nowIso();
  run(`UPDATE provider_connections
    SET connection_status = :status, last_error = :lastError, last_checked_at = :checkedAt, updated_at = :updatedAt
    WHERE account_id = :accountId AND provider_key = 'minimax-h3-sglang'`, {
    accountId: viewer.id,
    status,
    lastError,
    checkedAt,
    updatedAt: checkedAt,
  });
  const saved = h3ConnectionFor(viewer.id);
  recordAudit(viewer, "配置云显卡连接", "H3 云显卡", status, existing ? h3ConnectionPayload(existing, viewer.id) : null, h3ConnectionPayload(saved, viewer.id), req);
  if (status === "已连接") {
    all(`SELECT id FROM generation_jobs
      WHERE created_by = :accountId AND media_kind = 'video' AND provider_job_id IS NOT NULL
        AND status NOT IN ('已完成','失败','已取消')`, { accountId: viewer.id }).forEach((job) => scheduleH3Poll(job.id, 500));
  }
  sendJson(res, 200, { ok: status === "已连接", checkedPath, connection: h3ConnectionPayload(saved, viewer.id) });
}

async function updateImageConnection(req, res, viewer) {
  enforceRateLimit(req, "image-connect", 20);
  const body = await readJson(req);
  const endpointUrl = normalizeImageEndpoint(body.endpointUrl);
  const modelName = String(body.modelName || "").trim();
  if (!endpointUrl) return sendJson(res, 400, { error: "请填写生图服务地址" });
  if (!modelName) return sendJson(res, 400, { error: "请填写图片模型标识" });
  if (modelName.length > 200) return sendJson(res, 400, { error: "图片模型标识过长" });
  if (body.clearKey) clearImageSecret(viewer.id);
  if (String(body.apiKey || "").trim()) rememberImageSecret(viewer.id, body.apiKey);

  const now = nowIso();
  const existing = one("SELECT * FROM provider_connections WHERE account_id = :accountId AND provider_key = :providerKey", { accountId: viewer.id, providerKey: IMAGE_PROVIDER_KEY });
  const id = existing?.id || makeId("连接");
  run(`INSERT INTO provider_connections
      (id,org_id,account_id,provider_key,endpoint_url,model_name,connection_status,last_error,last_checked_at,created_at,updated_at)
    VALUES (:id,:orgId,:accountId,:providerKey,:endpointUrl,:modelName,'待检测','',NULL,:createdAt,:updatedAt)
    ON CONFLICT(account_id,provider_key) DO UPDATE SET
      endpoint_url = excluded.endpoint_url,
      model_name = excluded.model_name,
      connection_status = '待检测',
      last_error = '',
      updated_at = excluded.updated_at`, {
    id,
    orgId: orgIdOf(viewer),
    accountId: viewer.id,
    providerKey: IMAGE_PROVIDER_KEY,
    endpointUrl,
    modelName,
    createdAt: existing?.created_at || now,
    updatedAt: now,
  });

  let status = "已连接";
  let lastError = "";
  let checkedPath = "";
  try {
    const checked = await testImageConnection({ endpointUrl, apiKey: getImageSecret(viewer.id) });
    checkedPath = checked.checkedPath;
  } catch (error) {
    status = "连接失败";
    lastError = String(error?.message || "连接检测失败").slice(0, 500);
  }
  const checkedAt = nowIso();
  run(`UPDATE provider_connections SET connection_status = :status, last_error = :lastError, last_checked_at = :checkedAt, updated_at = :updatedAt
    WHERE account_id = :accountId AND provider_key = :providerKey`, {
    accountId: viewer.id,
    providerKey: IMAGE_PROVIDER_KEY,
    status,
    lastError,
    checkedAt,
    updatedAt: checkedAt,
  });
  const saved = imageConnectionFor(viewer.id);
  recordAudit(viewer, "配置生图服务", "图片生成接口", status, existing ? imageConnectionPayload(existing, viewer.id) : null, imageConnectionPayload(saved, viewer.id), req);
  sendJson(res, 200, { ok: status === "已连接", checkedPath, connection: imageConnectionPayload(saved, viewer.id) });
}

async function createH3VideoTask(req, res, viewer) {
  enforceRateLimit(req, "h3-submit", 60);
  const body = await readJson(req);
  const project = assertProjectAccess(body.projectId, viewer);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return sendJson(res, 400, { error: "视频提示词不能为空" });
  if (prompt.length > 30_000) return sendJson(res, 400, { error: "视频提示词过长" });
  if ((project.owner_user_id || project.owner_id) !== viewer.id) {
    return sendJson(res, 403, { error: "只能给自己负责的项目提交视频任务" });
  }
  const seed = String(body.seed ?? "").trim();
  if (seed && !/^\d{1,10}$/.test(seed)) return sendJson(res, 400, { error: "随机种子必须是 10 位以内的非负整数" });
  const durationSeconds = Math.max(4, Math.min(15, Number(body.durationSeconds) || 5));
  const ratio = String(body.ratio || project.aspect_ratio || "16:9");
  const connection = h3ConnectionFor(viewer.id);
  if (!connection.endpoint_url) return sendJson(res, 409, { error: "请先在云显卡连接页填写 H3 服务地址" });

  const now = nowIso();
  const task = {
    id: makeId("视频"),
    orgId: project.org_id || project.organization_id || orgIdOf(viewer) || "platform",
    projectId: project.id,
    ownerUserId: project.owner_user_id || project.owner_id,
    name: String(body.name || "H3 视频任务").trim() || "H3 视频任务",
    ratio,
    prompt,
    modelName: connection.model_name,
    seed,
    durationSeconds,
    createdAt: now,
  };
  run(`INSERT INTO generation_jobs
      (id,org_id,project_id,asset_id,owner_user_id,name,type,ratio,prompt,negative_prompt,style,model_name,provider,seed,generation_cost,status,progress,error_message,retry_count,provider_request_json,provider_response_json,created_by,created_at,updated_at,media_kind,duration_seconds)
    VALUES (:id,:orgId,:projectId,NULL,:ownerUserId,:name,'视频',:ratio,:prompt,'','',:modelName,'H3 云显卡',:seed,0,'排队中',1,'',0,'{}','{}',:createdBy,:createdAt,:updatedAt,'video',:durationSeconds)`, {
    ...task,
    createdBy: viewer.id,
    updatedAt: now,
  });

  try {
    const submitted = await submitH3Video(connection, task, viewer.id);
    run(`UPDATE generation_jobs
      SET provider_job_id = :providerJobId, provider_request_json = :requestJson, provider_response_json = :responseJson, status = '排队中', progress = 5, updated_at = :updatedAt
      WHERE id = :id`, {
      id: task.id,
      providerJobId: submitted.providerJobId,
      requestJson: JSON.stringify(submitted.request),
      responseJson: JSON.stringify(submitted.response),
      updatedAt: nowIso(),
    });
    scheduleH3Poll(task.id);
    const saved = imageTaskRow(one("SELECT * FROM generation_jobs WHERE id = :id", { id: task.id }), []);
    recordAudit(viewer, "提交视频任务", task.name, "排队中", null, { ...saved, projectName: project.name }, req);
    return sendJson(res, 201, { imageTask: saved });
  } catch (error) {
    run("UPDATE generation_jobs SET status = '失败', progress = 0, error_message = :errorMessage, updated_at = :updatedAt WHERE id = :id", {
      id: task.id,
      errorMessage: String(error?.message || "视频任务提交失败").slice(0, 500),
      updatedAt: nowIso(),
    });
    recordAudit(viewer, "提交视频任务", task.name, "失败", null, { taskId: task.id, error: error.message, projectName: project.name }, req);
    throw error;
  }
}

async function syncH3VideoTask(req, res, viewer, taskId) {
  const before = one("SELECT * FROM generation_jobs WHERE id = :id AND media_kind = 'video'", { id: taskId });
  if (!before) return sendJson(res, 404, { error: "视频任务不存在" });
  assertProjectAccess(before.project_id, viewer);
  const after = await syncH3Job(taskId);
  const results = all("SELECT * FROM generation_results WHERE generation_job_id = :jobId ORDER BY created_at ASC", { jobId: taskId }).map(imageResultRow);
  sendJson(res, 200, { imageTask: imageTaskRow(after, results) });
}

function serveGeneratedContent(res, viewer, taskId) {
  const job = one("SELECT * FROM generation_jobs WHERE id = :id AND media_kind = 'video'", { id: taskId });
  if (!job) return sendJson(res, 404, { error: "视频任务不存在" });
  assertProjectAccess(job.project_id, viewer);
  if (!job.output_file_path) return sendJson(res, 404, { error: "成片尚未下载完成" });
  return serveFile(res, job.output_file_path);
}

function serveGeneratedImageContent(res, viewer, resultId) {
  const result = one("SELECT * FROM generation_results WHERE id = :id", { id: resultId });
  if (!result) return sendJson(res, 404, { error: "生成结果不存在" });
  const job = one("SELECT * FROM generation_jobs WHERE id = :id", { id: result.generation_job_id });
  if (!job) return sendJson(res, 404, { error: "生成任务不存在" });
  assertProjectAccess(job.project_id, viewer);
  const filePath = imageResultFilePath(result);
  if (!filePath) return sendJson(res, 404, { error: "生成图片尚未保存完成" });
  return serveFile(res, filePath);
}

async function createAssignment(req, res, viewer) {
  requireRole(viewer, ["manager", "admin"]);
  const body = await readJson(req);
  const assignee = one("SELECT * FROM accounts WHERE id = :id AND role = 'user' AND disabled_at IS NULL", { id: body.assigneeId });
  if (!assignee || orgIdOf(assignee) !== orgIdOf(viewer)) return sendJson(res, 403, { error: "只能给同组织用户分配任务" });
  if (viewer.role === "manager" && !(assignee.manager_id === viewer.id || assignee.parent_id === viewer.id)) return sendJson(res, 403, { error: "经理只能给直属用户分配任务" });
  const now = nowIso();
  const assignment = {
    id: body.id || makeId("任务"),
    orgId: orgIdOf(viewer),
    assignedBy: viewer.id,
    assignedTo: assignee.id,
    managerId: viewer.id,
    managerName: viewer.name,
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    title: body.title || "",
    description: body.description || "",
    dueDate: body.dueDate || "未设置",
    priority: body.priority || "普通",
    status: "待接受",
    createdAt: now,
  };
  if (!assignment.title) return sendJson(res, 400, { error: "任务名称不能为空" });
  run(`INSERT INTO assignments (id,org_id,assigned_by,assigned_to,manager_id,manager_name,assignee_id,assignee_name,title,description,due_date,priority,status,created_at,updated_at)
    VALUES (:id,:orgId,:assignedBy,:assignedTo,:managerId,:managerName,:assigneeId,:assigneeName,:title,:description,:dueDate,:priority,:status,:createdAt,:updatedAt)`, {
    ...assignment,
    updatedAt: now,
  });
  recordAudit(viewer, "分配任务", `${assignment.title} · ${assignment.assigneeName}`, "待接受", null, assignment, req);
  sendJson(res, 201, { assignment });
}

async function updateAssignment(req, res, viewer, assignmentId) {
  const before = one("SELECT * FROM assignments WHERE id = :id", { id: assignmentId });
  if (!before) return sendJson(res, 404, { error: "任务不存在" });
  if (viewer.role !== "developer" && before.org_id !== orgIdOf(viewer)) return sendJson(res, 403, { error: "没有权限访问该组织任务" });
  if (![before.assigned_to || before.assignee_id, before.assigned_by || before.manager_id].includes(viewer.id) && !["admin", "developer"].includes(viewer.role)) return sendJson(res, 403, { error: "没有权限更新该任务" });
  const body = await readJson(req);
  const status = body.status || before.status;
  run("UPDATE assignments SET status = :status, updated_at = :updatedAt WHERE id = :id", { id: assignmentId, status, updatedAt: nowIso() });
  const after = one("SELECT * FROM assignments WHERE id = :id", { id: assignmentId });
  recordAudit(viewer, status === "已完成" ? "完成任务" : "更新任务", after.title, status, before, after, req);
  sendJson(res, 200, { assignment: assignmentRow(after) });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "ReelMesh Studio API", database: true, time: nowIso() });
  }
  if (req.method === "POST" && pathname === "/api/auth/login") return login(req, res);
  if (req.method === "POST" && pathname === "/api/auth/local") return localDesktopLogin(req, res);
  if (req.method === "POST" && pathname === "/api/auth/logout") return logout(req, res);
  if (req.method === "POST" && pathname === "/api/auth/invitations/inspect") return inspectInvitation(req, res);
  if (req.method === "POST" && pathname === "/api/auth/register") return registerAccount(req, res);

  const viewer = requireViewer(req);
  const bearer = getBearer(req);
  if (bearer) setSessionCookie(req, res, bearer);
  if (req.method === "GET" && pathname === "/api/workspace") return sendJson(res, 200, workspaceFor(viewer));
  if (req.method === "GET" && pathname === "/api/h3/connection") return sendJson(res, 200, { connection: h3ConnectionPayload(h3ConnectionFor(viewer.id), viewer.id) });
  if (req.method === "PATCH" && pathname === "/api/h3/connection") return updateH3Connection(req, res, viewer);
  if (req.method === "GET" && pathname === "/api/image/connection") return sendJson(res, 200, { connection: imageConnectionPayload(imageConnectionFor(viewer.id), viewer.id) });
  if (req.method === "PATCH" && pathname === "/api/image/connection") return updateImageConnection(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/h3/video-tasks") return createH3VideoTask(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/subtitles/transcribe") return transcribeVideo(req, res, { filesDir });
  if (req.method === "POST" && pathname === "/api/subtitles/render-intent") return createSubtitleRenderIntent(req, res, viewer);
  const subtitleRenderMatch = routeParams("/api/subtitles/render/:id", pathname);
  if (req.method === "POST" && subtitleRenderMatch) return renderSubtitleVideo(req, res, { filesDir, renderId: subtitleRenderMatch.id, viewer });
  if (req.method === "POST" && pathname === "/api/organizations") return createOrganization(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/accounts") return createAccount(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/invitations") return createInvitation(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/projects") return createProject(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/assets") return createAsset(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/asset-folders") return createAssetFolder(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/image-tasks") return createImageTask(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/image-workflows") return createImageWorkflow(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/skill-templates") return createSkillTemplate(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/production-specs") return createProductionSpec(req, res, viewer);
  if (req.method === "PUT" && pathname === "/api/wedding-workflows") return saveWeddingWorkflow(req, res, viewer);
  if (req.method === "POST" && pathname === "/api/assignments") return createAssignment(req, res, viewer);

  const uploadMatch = routeParams("/api/assets/:id/files", pathname);
  if (req.method === "POST" && uploadMatch) return uploadAssetFile(req, res, viewer, uploadMatch.id);
  const assetMatch = routeParams("/api/assets/:id", pathname);
  if (req.method === "DELETE" && assetMatch) return deleteAsset(req, res, viewer, assetMatch.id);
  const retryMatch = routeParams("/api/image-tasks/:id/retry", pathname);
  if (req.method === "POST" && retryMatch) return retryImageTask(req, res, viewer, retryMatch.id);
  const approveMatch = routeParams("/api/image-tasks/:id/approve", pathname);
  if (req.method === "POST" && approveMatch) return approveImageTask(req, res, viewer, approveMatch.id);
  const h3SyncMatch = routeParams("/api/h3/video-tasks/:id/sync", pathname);
  if (req.method === "POST" && h3SyncMatch) return syncH3VideoTask(req, res, viewer, h3SyncMatch.id);
  const generatedContentMatch = routeParams("/api/generation-jobs/:id/content", pathname);
  if (req.method === "GET" && generatedContentMatch) return serveGeneratedContent(res, viewer, generatedContentMatch.id);
  const generatedImageMatch = routeParams("/api/generation-results/:id/content", pathname);
  if (req.method === "GET" && generatedImageMatch) return serveGeneratedImageContent(res, viewer, generatedImageMatch.id);
  const skillTemplateMatch = routeParams("/api/skill-templates/:id", pathname);
  if (req.method === "PATCH" && skillTemplateMatch) return updateSkillTemplate(req, res, viewer, skillTemplateMatch.id);
  const assignmentMatch = routeParams("/api/assignments/:id", pathname);
  if (req.method === "PATCH" && assignmentMatch) return updateAssignment(req, res, viewer, assignmentMatch.id);
  const invitationRevokeMatch = routeParams("/api/invitations/:id/revoke", pathname);
  if (req.method === "POST" && invitationRevokeMatch) return revokeInvitation(req, res, viewer, invitationRevokeMatch.id);
  const accountApprovalMatch = routeParams("/api/accounts/:id/approval", pathname);
  if (req.method === "PATCH" && accountApprovalMatch) return reviewAccountApproval(req, res, viewer, accountApprovalMatch.id);

  sendJson(res, 404, { error: "接口不存在" });
}

function serveAuthorizedFile(req, res, relativePath) {
  const viewer = requireViewer(req);
  const bearer = getBearer(req);
  if (bearer) setSessionCookie(req, res, bearer);
  const normalized = String(relativePath || "").replace(/^\/+/, "");
  const publicUrl = `/files/${normalized}`;
  const file = one(`SELECT * FROM asset_files
    WHERE deleted_at IS NULL
      AND (original_url = :publicUrl OR preview_url = :publicUrl OR thumbnail_url = :publicUrl)`, { publicUrl });
  if (!file) {
    const error = new Error("文件不存在");
    error.status = 404;
    throw error;
  }
  if (!canAccessTenantRow(file, accountRows(), viewer)) {
    const error = new Error("没有权限访问该文件");
    error.status = 403;
    throw error;
  }
  const filePath = file.original_url === publicUrl
    ? file.original_path
    : file.preview_url === publicUrl
      ? file.preview_path
      : file.thumbnail_path;
  if (!filePath) {
    const error = new Error("文件不存在");
    error.status = 404;
    throw error;
  }
  return serveFile(res, filePath);
}

function serveBuiltInMusic(res, fileName) {
  const safeName = String(fileName || "").trim();
  if (!BUILT_IN_MUSIC.has(safeName)) {
    const error = new Error("配乐不存在");
    error.status = 404;
    throw error;
  }
  return serveFile(res, join(musicDirectory, safeName));
}

function serveBuiltInSfx(res, fileName) {
  const safeName = String(fileName || "").trim();
  if (!BUILT_IN_SFX.has(safeName)) {
    const error = new Error("音效不存在");
    error.status = 404;
    throw error;
  }
  return serveFile(res, join(sfxDirectory, safeName));
}

export const server = http.createServer(async (req, res) => {
  res.__hjscOrigin = String(req.headers.origin || "");
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/files/")) {
      const relativePath = decodeURIComponent(url.pathname.replace("/files/", ""));
      if (relativePath.includes("..")) return sendJson(res, 400, { error: "文件路径无效" });
      return serveAuthorizedFile(req, res, relativePath);
    }
    if (req.method === "GET" && url.pathname.startsWith("/music/")) {
      return serveBuiltInMusic(res, decodeURIComponent(url.pathname.replace("/music/", "")));
    }
    if (req.method === "GET" && url.pathname.startsWith("/sfx/")) {
      return serveBuiltInSfx(res, decodeURIComponent(url.pathname.replace("/sfx/", "")));
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
    sendJson(res, 404, { error: "路径不存在" });
  } catch (error) {
    sendError(res, error);
  }
});

export function startServer({
  port = Number(process.env.HJSC_API_PORT || 8787),
  host = process.env.HJSC_API_HOST || "127.0.0.1",
} = {}) {
  if (server.listening) return Promise.resolve(server.address());
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      console.log(`ReelMesh Studio API 已启动：http://${host}:${address?.port || port}`);
      resolve(address);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function stopServer() {
  for (const timer of h3PollTimers.values()) clearTimeout(timer);
  h3PollTimers.clear();
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const isDirectRun = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  startServer().catch((error) => {
    console.error("ReelMesh Studio API 启动失败", error);
    process.exitCode = 1;
  });
}
