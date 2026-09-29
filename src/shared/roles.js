export const ROLE_LABELS = {
  user: "用户",
  manager: "经理",
  admin: "管理员",
  developer: "开发者",
};

export const ROLE_SCOPES = {
  user: "仅查看自己的项目、资产、任务与进度",
  manager: "查看直属用户的项目、任务、进度与审核事项",
  admin: "查看所属组织内的经理及其用户",
  developer: "查看全部组织、账号、项目、日志与服务配置",
};

export const ROLE_LEVELS = {
  user: 1,
  manager: 2,
  admin: 3,
  developer: 4,
};

export function visibleAccountsFor(viewer, accounts) {
  if (!viewer) return [];
  if (viewer.role === "developer") return accounts;
  if (viewer.role === "user") return accounts.filter((account) => account.id === viewer.id);
  if (viewer.role === "manager") {
    return accounts.filter((account) => account.id === viewer.id || account.managerId === viewer.id || account.parentId === viewer.id);
  }
  if (viewer.role === "admin") {
    const managerIds = new Set(accounts
      .filter((account) => account.role === "manager" && (account.adminId === viewer.id || account.parentId === viewer.id))
      .map((account) => account.id));
    return accounts.filter((account) => (
      account.id === viewer.id
      || account.adminId === viewer.id
      || account.parentId === viewer.id
      || managerIds.has(account.managerId)
      || (viewer.organizationId && account.organizationId === viewer.organizationId)
    ));
  }
  return [];
}

export function visibleProjectsFor(viewer, projects, accounts) {
  if (!viewer) return [];
  if (viewer.role === "developer") return projects;
  const visibleAccountIds = new Set(visibleAccountsFor(viewer, accounts).map((account) => account.id));
  visibleAccountIds.add(viewer.id);
  return projects.filter((project) => (
    visibleAccountIds.has(project.ownerId)
    || (viewer.role === "admin" && viewer.organizationId && project.organizationId === viewer.organizationId)
  ));
}
