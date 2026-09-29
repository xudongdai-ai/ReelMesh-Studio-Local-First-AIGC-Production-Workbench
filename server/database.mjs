import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SKILL_TEMPLATES } from "./skill-defaults.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const dataDir = process.env.HJSC_DATA_DIR
  ? resolve(process.env.HJSC_DATA_DIR)
  : join(rootDir, ".hjsc-data");
export const filesDir = join(dataDir, "files");
export const dbPath = join(dataDir, "hjsc.sqlite");

mkdirSync(filesDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner_admin_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','manager','admin','developer')),
  department TEXT DEFAULT '未设置',
  org_id TEXT,
  organization_id TEXT,
  parent_id TEXT,
  parent_name TEXT DEFAULT '未设置',
  admin_id TEXT,
  manager_id TEXT,
  status TEXT DEFAULT '离线',
  approval_status TEXT DEFAULT 'approved',
  invited_by TEXT,
  joined_at TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(role, account)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  aspect_ratio TEXT DEFAULT '',
  style TEXT DEFAULT '',
  description TEXT DEFAULT '',
  stage TEXT DEFAULT '项目筹备',
  progress INTEGER DEFAULT 0,
  cover_url TEXT,
  owner_user_id TEXT,
  owner_id TEXT NOT NULL,
  organization_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS wedding_workflows (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  project_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT '进行中',
  completed_steps_json TEXT DEFAULT '[]',
  notes_json TEXT DEFAULT '{}',
  story_json TEXT DEFAULT '{}',
  image_task_ids_json TEXT DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  type TEXT DEFAULT '',
  type_label TEXT DEFAULT '',
  name TEXT NOT NULL,
  code TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT '待生成',
  prompt TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  filename TEXT DEFAULT '',
  image_url TEXT,
  image_full_url TEXT,
  thumbnail_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS asset_files (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT DEFAULT '原图',
  asset_type TEXT DEFAULT '',
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  preview_path TEXT,
  thumbnail_path TEXT,
  original_url TEXT NOT NULL,
  preview_url TEXT,
  thumbnail_url TEXT,
  checksum TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (owner_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS asset_folders (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS image_tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  project_id TEXT NOT NULL,
  asset_id TEXT,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  ratio TEXT DEFAULT '',
  prompt TEXT NOT NULL,
  negative_prompt TEXT DEFAULT '',
  style TEXT DEFAULT '',
  model_name TEXT DEFAULT '',
  provider TEXT DEFAULT '未配置',
  seed TEXT DEFAULT '',
  generation_cost REAL DEFAULT 0,
  status TEXT DEFAULT '待接入',
  progress INTEGER DEFAULT 0,
  selected_result_id TEXT,
  error_message TEXT DEFAULT '',
  retry_count INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (created_by) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS image_results (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  label TEXT DEFAULT '',
  full_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  provider_metadata TEXT DEFAULT '{}',
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES image_tasks(id)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  ratio TEXT DEFAULT '',
  prompt TEXT NOT NULL,
  negative_prompt TEXT DEFAULT '',
  style TEXT DEFAULT '',
  model_name TEXT DEFAULT '',
  provider TEXT DEFAULT '未配置',
  seed TEXT DEFAULT '',
  generation_cost REAL DEFAULT 0,
  status TEXT DEFAULT '待接入',
  progress INTEGER DEFAULT 0,
  selected_result_id TEXT,
  error_message TEXT DEFAULT '',
  retry_count INTEGER DEFAULT 0,
  batch_count INTEGER DEFAULT 4,
  provider_request_json TEXT DEFAULT '{}',
  provider_response_json TEXT DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (created_by) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS generation_results (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  generation_job_id TEXT NOT NULL,
  label TEXT DEFAULT '',
  full_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  provider_metadata TEXT DEFAULT '{}',
  selected_at TEXT,
  discarded_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id)
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  account_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  model_name TEXT NOT NULL,
  connection_status TEXT DEFAULT '待配置',
  last_error TEXT DEFAULT '',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, provider_key),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS skill_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  asset_type_label TEXT DEFAULT '',
  recommended_ratio TEXT DEFAULT '',
  fields_json TEXT DEFAULT '[]',
  checklist_json TEXT DEFAULT '[]',
  source_content TEXT DEFAULT '',
  source_files_json TEXT DEFAULT '[]',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT '启用',
  scope TEXT DEFAULT '平台',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_specs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  asset_type_label TEXT DEFAULT '',
  content TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  linked_asset_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (template_id) REFERENCES skill_templates(id)
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  number TEXT DEFAULT '',
  scene_name TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  shot_size TEXT DEFAULT '',
  camera TEXT DEFAULT '',
  characters_json TEXT DEFAULT '[]',
  scene_asset TEXT DEFAULT '',
  props_json TEXT DEFAULT '[]',
  action TEXT DEFAULT '',
  dialogue TEXT DEFAULT '',
  still_prompt TEXT DEFAULT '',
  video_prompt TEXT DEFAULT '',
  asset_ids_json TEXT DEFAULT '[]',
  status TEXT DEFAULT '编辑中',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  assigned_by TEXT,
  assigned_to TEXT,
  manager_id TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  assignee_id TEXT NOT NULL,
  assignee_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT DEFAULT '未设置',
  priority TEXT DEFAULT '普通',
  status TEXT DEFAULT '待接受',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (manager_id) REFERENCES accounts(id),
  FOREIGN KEY (assignee_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  actor_account_id TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  project TEXT DEFAULT '',
  status TEXT DEFAULT '已完成',
  before_json TEXT,
  after_json TEXT,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  type TEXT DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('manager','user')),
  department TEXT DEFAULT '未设置',
  parent_id TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0,1)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (parent_id) REFERENCES accounts(id),
  FOREIGN KEY (created_by) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS invitation_uses (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  registered_account TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY (invitation_id) REFERENCES invitations(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_org_created ON invitations(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitation_uses_invitation ON invitation_uses(invitation_id, created_at DESC);
`);

const assetFolderOrgColumn = db.prepare("PRAGMA table_info(asset_folders)").all().find((column) => column.name === "org_id");
if (assetFolderOrgColumn?.notnull) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE asset_folders_v2 (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    INSERT INTO asset_folders_v2 (id,org_id,project_id,name,created_by,created_at,updated_at,deleted_at)
      SELECT id,org_id,project_id,name,created_by,created_at,updated_at,deleted_at FROM asset_folders;
    DROP TABLE asset_folders;
    ALTER TABLE asset_folders_v2 RENAME TO asset_folders;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function ensureColumn(table, column, definition) {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("accounts", "org_id", "TEXT");
ensureColumn("accounts", "approval_status", "TEXT DEFAULT 'approved'");
ensureColumn("accounts", "invited_by", "TEXT");
ensureColumn("accounts", "joined_at", "TEXT");
ensureColumn("organizations", "owner_admin_id", "TEXT");
ensureColumn("projects", "org_id", "TEXT");
ensureColumn("projects", "owner_user_id", "TEXT");
ensureColumn("assets", "org_id", "TEXT");
ensureColumn("assets", "owner_user_id", "TEXT");
ensureColumn("asset_files", "org_id", "TEXT");
ensureColumn("asset_files", "owner_user_id", "TEXT");
ensureColumn("image_tasks", "org_id", "TEXT");
ensureColumn("shots", "org_id", "TEXT");
ensureColumn("assignments", "org_id", "TEXT");
ensureColumn("assignments", "assigned_by", "TEXT");
ensureColumn("assignments", "assigned_to", "TEXT");
ensureColumn("audit_logs", "org_id", "TEXT");
ensureColumn("audit_logs", "actor_account_id", "TEXT");
ensureColumn("notifications", "org_id", "TEXT");

ensureColumn("skill_templates", "org_id", "TEXT");
ensureColumn("skill_templates", "asset_type_label", "TEXT DEFAULT ''");
ensureColumn("skill_templates", "recommended_ratio", "TEXT DEFAULT ''");
ensureColumn("skill_templates", "fields_json", "TEXT DEFAULT '[]'");
ensureColumn("skill_templates", "checklist_json", "TEXT DEFAULT '[]'");
ensureColumn("skill_templates", "source_content", "TEXT DEFAULT ''");
ensureColumn("skill_templates", "source_files_json", "TEXT DEFAULT '[]'");
ensureColumn("skill_templates", "version", "INTEGER DEFAULT 1");
ensureColumn("skill_templates", "status", "TEXT DEFAULT '启用'");
ensureColumn("skill_templates", "scope", "TEXT DEFAULT '平台'");
ensureColumn("skill_templates", "created_by", "TEXT");

ensureColumn("production_specs", "org_id", "TEXT");
ensureColumn("production_specs", "owner_user_id", "TEXT");
ensureColumn("production_specs", "asset_type_label", "TEXT DEFAULT ''");
ensureColumn("production_specs", "notes", "TEXT DEFAULT ''");
ensureColumn("production_specs", "status", "TEXT DEFAULT '草稿'");
ensureColumn("production_specs", "linked_asset_id", "TEXT");
ensureColumn("generation_jobs", "media_kind", "TEXT DEFAULT 'image'");
ensureColumn("generation_jobs", "provider_job_id", "TEXT");
ensureColumn("generation_jobs", "duration_seconds", "REAL");
ensureColumn("generation_jobs", "output_file_path", "TEXT");
ensureColumn("generation_jobs", "completed_at", "TEXT");
ensureColumn("generation_jobs", "batch_count", "INTEGER DEFAULT 4");

db.exec(`
UPDATE accounts SET org_id = organization_id WHERE org_id IS NULL AND organization_id IS NOT NULL;
UPDATE accounts SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = '';
UPDATE accounts SET joined_at = created_at WHERE joined_at IS NULL;
UPDATE projects SET org_id = organization_id WHERE org_id IS NULL AND organization_id IS NOT NULL;
UPDATE projects SET owner_user_id = owner_id WHERE owner_user_id IS NULL AND owner_id IS NOT NULL;
UPDATE assets SET org_id = (SELECT projects.org_id FROM projects WHERE projects.id = assets.project_id) WHERE org_id IS NULL;
UPDATE assets SET owner_user_id = (SELECT projects.owner_user_id FROM projects WHERE projects.id = assets.project_id) WHERE owner_user_id IS NULL;
UPDATE asset_files SET org_id = (SELECT assets.org_id FROM assets WHERE assets.id = asset_files.asset_id) WHERE org_id IS NULL;
UPDATE asset_files SET owner_user_id = owner_id WHERE owner_user_id IS NULL AND owner_id IS NOT NULL;
UPDATE image_tasks SET org_id = (SELECT projects.org_id FROM projects WHERE projects.id = image_tasks.project_id) WHERE org_id IS NULL;
UPDATE shots SET org_id = (SELECT projects.org_id FROM projects WHERE projects.id = shots.project_id) WHERE org_id IS NULL;
UPDATE assignments SET assigned_by = manager_id WHERE assigned_by IS NULL AND manager_id IS NOT NULL;
UPDATE assignments SET assigned_to = assignee_id WHERE assigned_to IS NULL AND assignee_id IS NOT NULL;
UPDATE assignments SET org_id = (SELECT accounts.org_id FROM accounts WHERE accounts.id = assignments.assignee_id) WHERE org_id IS NULL;
UPDATE audit_logs SET actor_account_id = user_id WHERE actor_account_id IS NULL AND user_id IS NOT NULL;
UPDATE audit_logs SET org_id = (SELECT accounts.org_id FROM accounts WHERE accounts.id = audit_logs.user_id) WHERE org_id IS NULL;
UPDATE notifications SET org_id = (SELECT accounts.org_id FROM accounts WHERE accounts.id = notifications.account_id) WHERE org_id IS NULL;
`);

const existingPlatformTemplates = new Set(
  db.prepare("SELECT template_key FROM skill_templates WHERE scope = '平台'").all().map((row) => row.template_key)
);
const nowForTemplates = new Date().toISOString();
const insertTemplate = db.prepare(`INSERT INTO skill_templates
  (id,org_id,template_key,name,type,description,asset_type_label,recommended_ratio,fields_json,checklist_json,source_content,source_files_json,version,status,scope,created_by,created_at,updated_at)
  VALUES (:id,NULL,:templateKey,:name,:type,:description,:assetTypeLabel,:recommendedRatio,:fieldsJson,:checklistJson,:sourceContent,:sourceFilesJson,1,'启用','平台','system',:createdAt,:updatedAt)`);
const updateTemplateSource = db.prepare(`UPDATE skill_templates
  SET source_content = :sourceContent,
      source_files_json = :sourceFilesJson,
      updated_at = :updatedAt
  WHERE scope = '平台' AND template_key = :templateKey`);
for (const template of DEFAULT_SKILL_TEMPLATES) {
  if (existingPlatformTemplates.has(template.key)) {
    updateTemplateSource.run({
      templateKey: template.key,
      sourceContent: template.sourceContent || "",
      sourceFilesJson: JSON.stringify(template.sourceFiles || []),
      updatedAt: nowForTemplates,
    });
    continue;
  }
  insertTemplate.run({
    id: `skill-${template.key}`,
    templateKey: template.key,
    name: template.name,
    type: template.type,
    description: template.description,
    assetTypeLabel: template.assetTypeLabel,
    recommendedRatio: template.recommendedRatio,
    fieldsJson: JSON.stringify(template.fields || [
      { key: "requirement", label: "制作要求", required: true },
      { key: "continuity", label: "一致性要求", required: false },
      { key: "delivery", label: "交付备注", required: false },
    ]),
    checklistJson: JSON.stringify(template.checklist || ["内容来自真实填写", "字段完整", "可追溯到项目"]),
    sourceContent: template.sourceContent || "",
    sourceFilesJson: JSON.stringify(template.sourceFiles || []),
    createdAt: nowForTemplates,
    updatedAt: nowForTemplates,
  });
}

export function one(sql, params = {}) {
  return db.prepare(sql).get(params);
}

export function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

export function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}

export function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
