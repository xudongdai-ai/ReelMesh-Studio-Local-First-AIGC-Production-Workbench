# ReelMesh Studio Platform Data Model Blueprint

版本：v1  
定位：多租户 SaaS 正式系统 schema 基准，不按 `localStorage` 扁平结构迁移。

## 角色与租户边界

- `developer`：平台运营方，不属于客户组织，可跨全部组织查看和配置。
- `organization`：租户边界。除 `developer` 外，所有业务数据必须带 `org_id` 并按 `org_id` 隔离。
- `admin`：组织所有者，管理本组织经理、用户、项目、审核和配置。
- `manager`：团队负责人，只看同组织直属用户和自己负责的工作。
- `user`：创作者，只看自己负责的工作。

v1 决策：账号只属于一个组织，`accounts.org_id` 直接挂组织。以后如果一个账号要服务多个组织，再拆 `account_memberships`。

## 核心表

### organizations

租户表。

关键字段：

- `id`
- `name`
- `owner_admin_id`
- `quota_policy`
- `provider_config`
- `created_at`
- `updated_at`

### accounts

账号表。`developer` 的 `org_id` 为空；其他角色必须有 `org_id`。

关键字段：

- `id`
- `org_id`
- `account`
- `password_hash`
- `role`
- `parent_id`
- `status`
- `disabled_at`

### projects

组织拥有项目，用户只是当前负责人。

关键字段：

- `id`
- `org_id`
- `owner_user_id`
- `name`
- `type`
- `stage`
- `progress`
- `created_at`
- `deleted_at`

### assets

组织拥有资产，资产继承项目租户。

关键字段：

- `id`
- `org_id`
- `project_id`
- `owner_user_id`
- `type`
- `version`
- `status`
- `prompt`
- `locked_at`
- `deleted_at`

### asset_files

真实文件归档。

关键字段：

- `id`
- `org_id`
- `asset_id`
- `project_id`
- `owner_user_id`
- `kind`
- `original_url`
- `preview_url`
- `thumbnail_url`
- `checksum`
- `version`
- `deleted_at`

### shots

分镜表。

关键字段：

- `id`
- `org_id`
- `project_id`
- `owner_user_id`
- `number`
- `still_prompt`
- `video_prompt`
- `status`

### tasks

人工任务表，按 `assigned_by` / `assigned_to` 过滤，不按项目 owner 过滤。

关键字段：

- `id`
- `org_id`
- `assigned_by`
- `assigned_to`
- `title`
- `status`
- `due_at`

### skill_templates

制作规范模板表。平台模板 `org_id` 为空；组织模板必须带 `org_id`。用户端只读取已启用的平台模板和本组织模板。

关键字段：

- `id`
- `org_id`
- `template_key`
- `name`
- `type`
- `description`
- `asset_type_label`
- `recommended_ratio`
- `fields_json`
- `checklist_json`
- `version`
- `status`
- `scope`
- `created_by`
- `created_at`
- `updated_at`

### production_specs

制作规范记录表。它保存用户在项目里真实填写的制作要求，并可绑定到项目资产，不能保存伪生成结果。

关键字段：

- `id`
- `org_id`
- `project_id`
- `template_id`
- `template_key`
- `template_version`
- `owner_user_id`
- `title`
- `type`
- `asset_type_label`
- `content`
- `notes`
- `status`
- `linked_asset_id`
- `created_by`
- `created_at`
- `updated_at`

### generation_jobs

生图任务。数量不写死为 4，服务返回几张就存几条结果。

关键字段：

- `id`
- `org_id`
- `project_id`
- `asset_id`
- `owner_user_id`
- `prompt`
- `negative_prompt`
- `ratio`
- `style`
- `model_name`
- `provider`
- `seed`
- `generation_cost`
- `status`
- `retry_count`
- `selected_result_id`
- `provider_request_json`
- `provider_response_json`

### generation_results

生图结果图。

关键字段：

- `id`
- `org_id`
- `generation_job_id`
- `full_url`
- `thumb_url`
- `provider_metadata`
- `selected_at`
- `discarded_at`

### review_events

正式审核流事件表。每次提交、退回、通过、锁版都写事件。

推荐状态：

- `draft`
- `submitted`
- `manager_review`
- `manager_returned`
- `manager_approved`
- `admin_review`
- `admin_returned`
- `admin_approved`
- `locked`
- `discarded`

关键字段：

- `id`
- `org_id`
- `target_type`
- `target_id`
- `from_status`
- `to_status`
- `actor_account_id`
- `comment`
- `version_before`
- `version_after`
- `created_at`

### audit_logs

操作审计表。所有重要操作都保留前后数据。

关键字段：

- `id`
- `org_id`
- `actor_account_id`
- `action`
- `target_type`
- `target_id`
- `before_json`
- `after_json`
- `ip`
- `user_agent`
- `created_at`

### usage_ledger / org_quotas

如果采用平台统一提供生图服务并向组织计费，需要这两张表。如果每个组织自带 API key，可以先不做计费系统。

## 服务端权限规则

后端从认证身份得到 principal：

- `account_id`
- `role`
- `org_id`
- `parent_id`

统一 scope：

- `developer`：不加租户过滤。
- `admin`：`org_id = principal.org_id`。
- `manager`：`org_id = principal.org_id` 且 owner 在自己或直属用户内。
- `user`：`org_id = principal.org_id` 且 owner 为自己。
- `tasks`：按 `assigned_to` / `assigned_by` 判断可见性。

客户端传来的 `org_id`、`role`、`owner_user_id`、`parent_id` 不能直接信任，只能作为请求意图，落库前必须由服务端根据当前 principal 重新计算或校验。

## v1 到正式生产的技术方向

- 本地原型：Node + SQLite，用于验证流程。
- 正式服务：FastAPI + Postgres。
- 密码：Argon2id。
- 登录：短期 access JWT + 服务端可吊销 refresh session。
- 多租户防线：服务端 scoped query + Postgres RLS。
- UUID：只作为不可预测 ID，不替代授权检查。
