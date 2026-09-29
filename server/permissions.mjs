export const ROLE_LEVELS = {
  user: 1,
  manager: 2,
  admin: 3,
  developer: 4,
};

export function orgIdOf(account) {
  return account?.org_id || account?.organization_id || null;
}

export function isDeveloper(viewer) {
  return viewer?.role === "developer";
}

export function requireRole(viewer, roles) {
  if (!viewer || !roles.includes(viewer.role)) {
    const error = new Error("没有权限执行该操作");
    error.status = 403;
    throw error;
  }
}

export function directUserIds(accounts, viewer) {
  const viewerOrgId = orgIdOf(viewer);
  if (!viewerOrgId) return [];
  return accounts
    .filter((account) => account.role === "user" && orgIdOf(account) === viewerOrgId && (account.parent_id === viewer.id || account.manager_id === viewer.id))
    .map((account) => account.id);
}

export function visibleOwnerIds(accounts, viewer) {
  if (!viewer) return new Set();
  if (isDeveloper(viewer)) return new Set(accounts.map((account) => account.id));
  if (viewer.role === "admin") {
    return new Set(accounts.filter((account) => orgIdOf(account) === orgIdOf(viewer)).map((account) => account.id));
  }
  if (viewer.role === "manager") {
    return new Set([viewer.id, ...directUserIds(accounts, viewer)]);
  }
  return new Set([viewer.id]);
}

export function visibleAccounts(accounts, viewer) {
  if (!viewer) return [];
  if (isDeveloper(viewer)) return accounts;

  const viewerOrgId = orgIdOf(viewer);
  if (!viewerOrgId) return accounts.filter((account) => account.id === viewer.id);

  if (viewer.role === "admin") {
    return accounts.filter((account) => orgIdOf(account) === viewerOrgId);
  }

  if (viewer.role === "manager") {
    return accounts.filter((account) => orgIdOf(account) === viewerOrgId && (account.id === viewer.id || account.parent_id === viewer.id || account.manager_id === viewer.id));
  }

  if (viewer.role === "user") {
    return accounts.filter((account) => orgIdOf(account) === viewerOrgId && account.id === viewer.id);
  }

  return [];
}

export function visibleProjects(projects, accounts, viewer) {
  if (!viewer) return [];
  if (isDeveloper(viewer)) return projects;

  const viewerOrgId = orgIdOf(viewer);
  const ownerIds = visibleOwnerIds(accounts, viewer);
  return projects.filter((project) => {
    const projectOrgId = project.org_id || project.organization_id;
    const ownerUserId = project.owner_user_id || project.owner_id;
    return projectOrgId === viewerOrgId && (viewer.role === "admin" || ownerIds.has(ownerUserId));
  });
}

export function canAccessProject(project, accounts, viewer) {
  return !!visibleProjects([project].filter(Boolean), accounts, viewer).length;
}

export function canAccessTenantRow(row, accounts, viewer, ownerField = "owner_user_id") {
  if (!row || !viewer) return false;
  if (isDeveloper(viewer)) return true;
  if ((row.org_id || row.organization_id) !== orgIdOf(viewer)) return false;
  if (viewer.role === "admin") return true;
  const owner = row[ownerField] || row.owner_id || row.created_by;
  return visibleOwnerIds(accounts, viewer).has(owner);
}

export function canManageAccount(viewer, targetRole) {
  if (viewer.role === "developer") return targetRole === "admin";
  if (viewer.role === "admin") return ["manager", "user"].includes(targetRole);
  return false;
}
