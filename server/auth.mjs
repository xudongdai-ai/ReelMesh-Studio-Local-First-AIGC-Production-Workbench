import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const SESSION_HOURS = 24 * 14;
export const SESSION_MAX_AGE_SECONDS = SESSION_HOURS * 60 * 60;

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, expected] = storedHash.split(":");
  const actual = scryptSync(String(password), salt, 64);
  const expectedBytes = Buffer.from(expected, "hex");
  return expectedBytes.length === actual.length && timingSafeEqual(expectedBytes, actual);
}

export function makeSessionToken() {
  return randomBytes(32).toString("hex");
}

export function makeInvitationToken() {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
}

export function sanitizeAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    account: account.account,
    name: account.name,
    role: account.role,
    department: account.department,
    orgId: account.org_id || account.organization_id,
    organizationId: account.org_id || account.organization_id,
    parentId: account.parent_id,
    parentName: account.parent_name,
    adminId: account.admin_id,
    managerId: account.manager_id,
    status: account.status,
    approvalStatus: account.approval_status || "approved",
    invitedBy: account.invited_by,
    joinedAt: account.joined_at,
    createdAt: account.created_at,
  };
}
