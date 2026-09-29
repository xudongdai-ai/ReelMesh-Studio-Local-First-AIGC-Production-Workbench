import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, nowIso } from "../server/auth.mjs";
import { TEST_PASSWORDS } from "./test-credentials.mjs";

const base = process.env.HJSC_API_BASE || "http://127.0.0.1:8787";
const defaultDataDir = fileURLToPath(new URL("../.hjsc-data", import.meta.url));
const dataDir = process.env.HJSC_DATA_DIR ? resolve(process.env.HJSC_DATA_DIR) : defaultDataDir;
const db = new DatabaseSync(join(dataDir, "hjsc.sqlite"));
const suffix = `${Date.now()}`.slice(-6);
const created = {
  accountIds: [],
  orgIds: [],
};

async function request(method, path, token, body, ok = true) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (ok && !response.ok) {
    throw new Error(`${method} ${path} ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

async function rawRequest(path, token) {
  return fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function ensureDeveloperAccount(account, password) {
  const existing = db.prepare("SELECT id FROM accounts WHERE role = 'developer' AND account = ?").get(account);
  if (existing) return existing.id;
  const id = `developer-${account}`;
  const now = nowIso();
  db.prepare(`INSERT INTO accounts (id,account,password_hash,name,role,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, account, hashPassword(password), "规范验证开发者", "developer", "离线", now, now);
  created.accountIds.push(id);
  return id;
}

async function main() {
  const blocked = await request("POST", "/api/auth/login", null, { role: "user", account: `blocked-${suffix}`, password: TEST_PASSWORDS.user }, false);
  if (blocked.status !== 401) throw new Error("未创建用户应被拒绝登录");

  const blockedRegister = await request("POST", "/api/auth/register", null, {
    role: "admin",
    name: "自助管理员",
    account: `register-admin-${suffix}`,
    password: TEST_PASSWORDS.admin,
    organizationName: `自助注册组织-${suffix}`,
  }, false);
  if (blockedRegister.status !== 403) throw new Error("没有邀请时不应允许公开注册");

  const devAccount = `dev-skill-${suffix}`;
  ensureDeveloperAccount(devAccount, TEST_PASSWORDS.developer);
  const dev = await request("POST", "/api/auth/login", null, { role: "developer", account: devAccount, password: TEST_PASSWORDS.developer });

  const workspace = await request("GET", "/api/workspace", dev.payload.token);
  if (!workspace.payload.skillTemplates?.some((item) => item.key === "character_asset")) {
    throw new Error("默认平台规范模板未初始化");
  }

  const missingOrgTemplate = await request("POST", "/api/skill-templates", dev.payload.token, {
    scope: "组织",
    name: "缺少组织的模板",
    type: "character",
  }, false);
  if (missingOrgTemplate.status !== 400) throw new Error("开发者创建组织模板时必须校验所属组织");

  const org = await request("POST", "/api/organizations", dev.payload.token, { name: `规范验证组织-${suffix}`, description: "测试后清理" });
  created.orgIds.push(org.payload.organization.id);

  const blockedManager = await request("POST", "/api/accounts", dev.payload.token, {
    role: "manager",
    account: `blocked-manager-${suffix}`,
    name: "不应创建的经理",
    password: TEST_PASSWORDS.manager,
    organizationId: org.payload.organization.id,
  }, false);
  if (blockedManager.status !== 403) throw new Error("开发者不应直接创建经理账号");

  const adminAccount = `admin-skill-${suffix}`;
  const admin = await request("POST", "/api/accounts", dev.payload.token, {
    role: "admin",
    account: adminAccount,
    name: "规范管理员",
    password: TEST_PASSWORDS.admin,
    organizationId: org.payload.organization.id,
  });
  created.accountIds.push(admin.payload.account.id);

  const adminLogin = await request("POST", "/api/auth/login", null, { role: "admin", account: adminAccount, password: TEST_PASSWORDS.admin });
  const managerAccount = `manager-skill-${suffix}`;
  const manager = await request("POST", "/api/accounts", adminLogin.payload.token, {
    role: "manager",
    account: managerAccount,
    name: "规范经理",
    password: TEST_PASSWORDS.manager,
  });
  created.accountIds.push(manager.payload.account.id);

  const orgTemplate = await request("POST", "/api/skill-templates", adminLogin.payload.token, {
    name: "组织人物精修规范",
    type: "character",
    assetTypeLabel: "人物",
    recommendedRatio: "3:4",
    description: "组织级人物资产字段",
  });
  if (orgTemplate.payload.skillTemplate.scope !== "组织") throw new Error("管理员创建的模板必须是组织模板");

  const userAccount = `user-skill-${suffix}`;
  const invitation = await request("POST", "/api/invitations", adminLogin.payload.token, {
    role: "user",
    parentId: manager.payload.account.id,
    department: "资产制作",
    expiresInHours: 24,
    maxUses: 1,
    requiresApproval: true,
  });
  if (!invitation.payload.invitationToken) throw new Error("创建邀请后必须返回一次性凭证");

  const inspected = await request("POST", "/api/auth/invitations/inspect", null, {
    invitationToken: invitation.payload.invitationToken,
  });
  if (inspected.payload.invitation.role !== "user") throw new Error("邀请身份不正确");

  const registeredUser = await request("POST", "/api/auth/register", null, {
    role: "user",
    name: "规范用户",
    account: userAccount,
    password: TEST_PASSWORDS.user,
    invitationToken: invitation.payload.invitationToken,
  });
  created.accountIds.push(registeredUser.payload.account.id);
  if (!registeredUser.payload.pendingApproval) throw new Error("邀请要求确认时注册账号应进入待确认状态");

  const exhaustedInvitation = await request("POST", "/api/auth/register", null, {
    role: "user",
    name: "重复邀请用户",
    account: `duplicate-${suffix}`,
    password: TEST_PASSWORDS.user,
    invitationToken: invitation.payload.invitationToken,
  }, false);
  if (exhaustedInvitation.status !== 410) throw new Error("邀请次数用完后应拒绝再次注册");

  const pendingLogin = await request("POST", "/api/auth/login", null, { role: "user", account: userAccount, password: TEST_PASSWORDS.user }, false);
  if (pendingLogin.status !== 403) throw new Error("待确认账号不应允许登录");

  await request("PATCH", `/api/accounts/${encodeURIComponent(registeredUser.payload.account.id)}/approval`, adminLogin.payload.token, {
    approvalStatus: "approved",
  });

  const userLogin = await request("POST", "/api/auth/login", null, { role: "user", account: userAccount, password: TEST_PASSWORDS.user });
  const userWorkspace = await request("GET", "/api/workspace", userLogin.payload.token);
  if (!userWorkspace.payload.skillTemplates.some((item) => item.id === orgTemplate.payload.skillTemplate.id)) {
    throw new Error("用户看不到本组织规范模板");
  }

  const project = await request("POST", "/api/projects", userLogin.payload.token, {
    name: `规范验证项目-${suffix}`,
    type: "短剧",
    aspectRatio: "16:9",
    style: "写实",
  });

  const spec = await request("POST", "/api/production-specs", userLogin.payload.token, {
    projectId: project.payload.project.id,
    templateId: orgTemplate.payload.skillTemplate.id,
    title: "人物制作要求",
    content: "角色年龄三十岁，黑色短发，服装保持同一套。",
    createAsset: true,
  });
  if (!spec.payload.productionSpec?.id || !spec.payload.asset?.id) {
    throw new Error("制作规范保存后必须返回规范记录和关联资产");
  }

  const uploaded = await request("POST", `/api/assets/${encodeURIComponent(spec.payload.asset.id)}/files`, userLogin.payload.token, {
    fileName: "权限验证.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  });
  const disguisedFile = await request("POST", `/api/assets/${encodeURIComponent(spec.payload.asset.id)}/files`, userLogin.payload.token, {
    fileName: "伪装图片.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,5L2g5aW9",
  }, false);
  if (disguisedFile.status !== 400) throw new Error("伪装成图片的异常文件应被拒绝");
  const protectedFileUrl = uploaded.payload.file.originalUrl;
  const anonymousFile = await rawRequest(protectedFileUrl, null);
  if (anonymousFile.status !== 401) throw new Error("未登录访问资产文件应被拒绝");
  const ownFile = await rawRequest(protectedFileUrl, userLogin.payload.token);
  if (ownFile.status !== 200) throw new Error("资产所有者应能读取自己的文件");

  const org2 = await request("POST", "/api/organizations", dev.payload.token, { name: `隔离规范组织-${suffix}`, description: "测试后清理" });
  created.orgIds.push(org2.payload.organization.id);
  const admin2Account = `admin-skill-other-${suffix}`;
  const admin2 = await request("POST", "/api/accounts", dev.payload.token, {
    role: "admin",
    account: admin2Account,
    name: "隔离管理员",
    password: TEST_PASSWORDS.admin,
    organizationId: org2.payload.organization.id,
  });
  created.accountIds.push(admin2.payload.account.id);

  const admin2Login = await request("POST", "/api/auth/login", null, { role: "admin", account: admin2Account, password: TEST_PASSWORDS.admin });
  const crossTenantFile = await rawRequest(protectedFileUrl, admin2Login.payload.token);
  if (crossTenantFile.status !== 403) throw new Error("其他组织不应读取资产文件");
  const admin2Workspace = await request("GET", "/api/workspace", admin2Login.payload.token);
  if (admin2Workspace.payload.productionSpecs.some((item) => item.id === spec.payload.productionSpec.id)) {
    throw new Error("跨租户看到了其他组织的制作规范记录");
  }

  const revokedInvitation = await request("POST", "/api/invitations", adminLogin.payload.token, {
    role: "user",
    expiresInHours: 24,
    maxUses: 1,
  });
  await request("POST", `/api/invitations/${encodeURIComponent(revokedInvitation.payload.invitation.id)}/revoke`, adminLogin.payload.token);
  const revokedInspect = await request("POST", "/api/auth/invitations/inspect", null, {
    invitationToken: revokedInvitation.payload.invitationToken,
  }, false);
  if (revokedInspect.status !== 410) throw new Error("已撤销邀请应立即失效");

  console.log(JSON.stringify({
    ok: true,
    defaultTemplates: workspace.payload.skillTemplates.length,
    orgTemplate: orgTemplate.payload.skillTemplate.id,
    productionSpec: spec.payload.productionSpec.id,
    linkedAsset: spec.payload.asset.id,
  }, null, 2));
}

function cleanup() {
  db.exec("PRAGMA foreign_keys = OFF");
  const deleteByOrg = db.prepare("DELETE FROM organizations WHERE id = ?");
  for (const orgId of created.orgIds) {
    for (const table of ["invitation_uses", "invitations", "audit_logs", "notifications", "generation_results", "generation_jobs", "asset_files", "production_specs", "assets", "shots", "assignments", "projects", "skill_templates"]) {
      db.prepare(`DELETE FROM ${table} WHERE org_id = ?`).run(orgId);
    }
    db.prepare("DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE org_id = ?)").run(orgId);
    db.prepare("DELETE FROM accounts WHERE org_id = ?").run(orgId);
    deleteByOrg.run(orgId);
  }
  for (const accountId of created.accountIds) {
    db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM audit_logs WHERE actor_account_id = ? OR user_id = ?").run(accountId, accountId);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  }
  db.exec("PRAGMA foreign_keys = ON");
}

try {
  await main();
} finally {
  cleanup();
}
