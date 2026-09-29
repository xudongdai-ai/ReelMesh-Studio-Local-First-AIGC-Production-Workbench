-- ReelMesh Studio production Postgres/RLS blueprint
-- 这是生产迁移参考，不由本地 Node/SQLite 原型直接执行。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_admin_id uuid,
  quota_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  account text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('developer','admin','manager','user')),
  parent_id uuid REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'offline',
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'developer' AND org_id IS NULL) OR (role <> 'developer' AND org_id IS NOT NULL))
);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_owner_admin_fk FOREIGN KEY (owner_admin_id) REFERENCES accounts(id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  owner_user_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  type text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'planning',
  progress integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  owner_user_id uuid NOT NULL REFERENCES accounts(id),
  type text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  prompt text NOT NULL DEFAULT '',
  locked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  owner_user_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL DEFAULT 'original',
  original_url text NOT NULL,
  preview_url text,
  thumbnail_url text,
  checksum text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  assigned_by uuid NOT NULL REFERENCES accounts(id),
  assigned_to uuid NOT NULL REFERENCES accounts(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  template_key text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  description text NOT NULL DEFAULT '',
  asset_type_label text NOT NULL DEFAULT '',
  recommended_ratio text NOT NULL DEFAULT '',
  fields_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT '启用',
  scope text NOT NULL CHECK (scope IN ('平台','组织')),
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = '平台' AND org_id IS NULL) OR (scope = '组织' AND org_id IS NOT NULL))
);

CREATE TABLE production_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  template_id uuid NOT NULL REFERENCES skill_templates(id),
  template_key text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  owner_user_id uuid NOT NULL REFERENCES accounts(id),
  title text NOT NULL,
  type text NOT NULL DEFAULT '',
  asset_type_label text NOT NULL DEFAULT '',
  content text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '待确认',
  linked_asset_id uuid REFERENCES assets(id),
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  asset_id uuid REFERENCES assets(id),
  owner_user_id uuid NOT NULL REFERENCES accounts(id),
  prompt text NOT NULL,
  negative_prompt text NOT NULL DEFAULT '',
  ratio text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  model_name text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  seed text NOT NULL DEFAULT '',
  generation_cost numeric(12,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  retry_count integer NOT NULL DEFAULT 0,
  selected_result_id uuid,
  provider_request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  generation_job_id uuid NOT NULL REFERENCES generation_jobs(id),
  full_url text NOT NULL,
  thumb_url text NOT NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_selected_result_fk FOREIGN KEY (selected_result_id) REFERENCES generation_results(id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id),
  actor_account_id uuid NOT NULL REFERENCES accounts(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_org_owner ON projects(org_id, owner_user_id);
CREATE INDEX idx_assets_org_project ON assets(org_id, project_id);
CREATE INDEX idx_tasks_org_assigned ON tasks(org_id, assigned_to, assigned_by);
CREATE INDEX idx_skill_templates_scope_org ON skill_templates(scope, org_id, status);
CREATE INDEX idx_production_specs_org_project ON production_specs(org_id, project_id, owner_user_id);
CREATE INDEX idx_generation_jobs_org_project ON generation_jobs(org_id, project_id);
CREATE INDEX idx_audit_logs_org_actor ON audit_logs(org_id, actor_account_id, created_at DESC);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.current_role', true)
$$;

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_account_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '')::uuid
$$;

CREATE POLICY tenant_select_projects ON projects
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_assets ON assets
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_asset_files ON asset_files
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_tasks ON tasks
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_skill_templates ON skill_templates
  FOR SELECT USING (
    app_current_role() = 'developer'
    OR (status = '启用' AND (org_id IS NULL OR org_id = app_current_org_id()))
  );

CREATE POLICY tenant_select_production_specs ON production_specs
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_generation_jobs ON generation_jobs
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_generation_results ON generation_results
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

CREATE POLICY tenant_select_audit_logs ON audit_logs
  FOR SELECT USING (app_current_role() = 'developer' OR org_id = app_current_org_id());

-- FastAPI 每个请求事务内设置：
-- SET LOCAL app.current_role = :role;
-- SET LOCAL app.current_org_id = :org_id;
-- SET LOCAL app.current_account_id = :account_id;
