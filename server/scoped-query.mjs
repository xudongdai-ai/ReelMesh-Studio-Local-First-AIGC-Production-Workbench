import { all, one } from "./database.mjs";
import { canAccessProject, canAccessTenantRow, visibleAccounts, visibleProjects } from "./permissions.mjs";

export function activeAccounts() {
  return all("SELECT * FROM accounts WHERE disabled_at IS NULL ORDER BY created_at ASC");
}

export function activeProjects() {
  return all("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC");
}

export function scopedAccounts(viewer) {
  return visibleAccounts(activeAccounts(), viewer);
}

export function scopedProjects(viewer) {
  return visibleProjects(activeProjects(), activeAccounts(), viewer);
}

export function assertScopedProject(projectId, viewer) {
  const project = one("SELECT * FROM projects WHERE id = :id AND deleted_at IS NULL", { id: projectId });
  if (!project || !canAccessProject(project, activeAccounts(), viewer)) {
    const error = new Error("没有权限访问该项目");
    error.status = 403;
    throw error;
  }
  return project;
}

export function scopedTenantRows(rows, viewer, ownerField = "owner_user_id") {
  const accounts = activeAccounts();
  return rows.filter((row) => canAccessTenantRow(row, accounts, viewer, ownerField));
}
