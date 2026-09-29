import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  Buildings,
  CheckCircle,
  ClipboardText,
  Clock,
  Copy,
  FileText,
  Gear,
  HardDrives,
  House,
  ListChecks,
  LinkSimple,
  MagnifyingGlass,
  Minus,
  Plus,
  Pulse,
  ShieldCheck,
  SignOut,
  SquaresFour,
  TreeStructure,
  UserCircleGear,
  UserPlus,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { STORAGE_KEYS, useStoredState } from "./storage.js";
import { PortalLogin } from "./PortalLogin.jsx";
import { ROLE_LABELS, ROLE_SCOPES, visibleAccountsFor, visibleProjectsFor } from "./roles.js";
import { ProductionWorkspace, WORKSPACE_NAV_ITEMS, workspaceBadgeCounts } from "./ProductionWorkspace.jsx";
import { EmptyState, FormField, Metric, Modal as PortalModal, PageHeader, Progress, Status } from "./ui.jsx";
import {
  clearSession,
  createAccount as apiCreateAccount,
  createAssignment as apiCreateAssignment,
  createSkillTemplate as apiCreateSkillTemplate,
  createOrganization as apiCreateOrganization,
  createInvitation as apiCreateInvitation,
  fetchWorkspace,
  getSession,
  login as apiLogin,
  logout as apiLogout,
  reviewAccountApproval as apiReviewAccountApproval,
  revokeInvitation as apiRevokeInvitation,
  updateSkillTemplate as apiUpdateSkillTemplate,
} from "./api.js";

const WORKSPACE_NAV_GROUP = {
  caption: "我的制作",
  items: WORKSPACE_NAV_ITEMS.map((item) => ({ ...item, id: `ws-${item.id}` })),
};

const PORTALS = {
  user: {
    title: "用户端",
    storageKey: "currentUser",
    sidebarTitle: "资产生产台",
    description: "登录后管理自己的项目、资产、制作规范与图片队列。",
    navGroups: [
      { caption: "制作", items: WORKSPACE_NAV_GROUP.items },
    ],
  },
  manager: {
    title: "经理端",
    storageKey: "currentManager",
    sidebarTitle: "直属团队管理",
    description: "登录后查看直属用户的工作、进度、任务与审核事项，也可以直接制作自己的项目。",
    navGroups: [
      {
        caption: "团队管理",
        items: [
          { id: "overview", label: "经理总览", icon: House },
          { id: "people", label: "我的成员", icon: UsersThree },
          { id: "projects", label: "项目进度", icon: SquaresFour },
          { id: "assignments", label: "任务分配", icon: ClipboardText },
          { id: "reviews", label: "待我审核", icon: ListChecks },
        ],
      },
      WORKSPACE_NAV_GROUP,
    ],
  },
  admin: {
    title: "管理端",
    storageKey: "currentAdmin",
    sidebarTitle: "组织与权限管理",
    description: "登录后管理所属组织的成员、项目与审核，也可以直接制作自己的项目。",
    navGroups: [
      {
        caption: "组织管理",
        items: [
          { id: "overview", label: "管理总览", icon: House },
          { id: "people", label: "组织人员", icon: TreeStructure },
          { id: "invitations", label: "成员邀请", icon: UserPlus },
          { id: "projects", label: "项目监控", icon: SquaresFour },
          { id: "assignments", label: "任务分配", icon: ClipboardText },
          { id: "activity", label: "操作记录", icon: Pulse },
          { id: "reviews", label: "审核中心", icon: ListChecks },
          { id: "skill-templates", label: "规范模板", icon: FileText },
          { id: "connections", label: "接入配置", icon: Gear },
        ],
      },
      WORKSPACE_NAV_GROUP,
    ],
  },
  developer: {
    title: "开发者端",
    storageKey: "currentDeveloper",
    sidebarTitle: "平台运营管理",
    description: "登录后管理组织、管理员、账号配置与服务状态，也可以直接制作自己的项目。",
    navGroups: [
      {
        caption: "平台运营",
        items: [
          { id: "overview", label: "平台总览", icon: House },
          { id: "organizations", label: "组织管理", icon: Buildings },
          { id: "people", label: "全部账号", icon: UserCircleGear },
          { id: "activity", label: "权限审计", icon: ShieldCheck },
          { id: "services", label: "服务状态", icon: HardDrives },
          { id: "skill-templates", label: "规范模板", icon: FileText },
          { id: "settings", label: "系统配置", icon: Gear },
        ],
      },
      WORKSPACE_NAV_GROUP,
    ],
  },
};

function portalNavItems(portal) {
  return portal.navGroups.flatMap((group) => group.items);
}

function roleHierarchy(role) {
  if (role === "manager") return [
    { label: "当前经理", note: "本账号" },
    { label: "直属用户", note: "仅可查看直接下属" },
  ];
  if (role === "admin") return [
    { label: "当前管理员", note: "所属组织" },
    { label: "下属经理", note: "经理负责各自团队" },
    { label: "组织用户", note: "含经理名下用户" },
  ];
  return [
    { label: "全部组织", note: "平台范围" },
    { label: "组织管理员", note: "负责所属组织" },
    { label: "组织经理", note: "负责直属团队" },
    { label: "全部用户", note: "仅处理自己的工作" },
  ];
}

export function OversightPortal({ role }) {
  const portal = PORTALS[role];
  const [viewer, setViewer] = useStoredState(STORAGE_KEYS[portal.storageKey], null);
  const [accounts, setAccounts] = useStoredState(STORAGE_KEYS.accounts, []);
  const [organizations, setOrganizations] = useStoredState(STORAGE_KEYS.organizations, []);
  const [assignments, setAssignments] = useStoredState(STORAGE_KEYS.assignments, []);
  const [invitations, setInvitations] = useStoredState(STORAGE_KEYS.invitations, []);
  const [projects, setProjects] = useStoredState(STORAGE_KEYS.projects, []);
  const [assets, setAssets] = useStoredState(STORAGE_KEYS.assets, []);
  const [assetFiles, setAssetFiles] = useStoredState(STORAGE_KEYS.assetFiles, []);
  const [assetFolders, setAssetFolders] = useState([]);
  const [imageTasks, setImageTasks] = useStoredState(STORAGE_KEYS.imageTasks, []);
  const [shots, setShots] = useStoredState(STORAGE_KEYS.shots, []);
  const [weddingWorkflows, setWeddingWorkflows] = useStoredState(STORAGE_KEYS.weddingWorkflows, []);
  const [activityLogs, setActivityLogs] = useStoredState(STORAGE_KEYS.activityLogs, []);
  const [skillTemplates, setSkillTemplates] = useStoredState(STORAGE_KEYS.skillTemplates, []);
  const [productionSpecs, setProductionSpecs] = useStoredState(STORAGE_KEYS.productionSpecs, []);
  const [activePage, setActivePage] = useState(["user", "developer"].includes(role) ? "ws-quick" : "overview");
  const [workspaceScale, setWorkspaceScale] = useStoredState(STORAGE_KEYS.workspaceScale, 1.1);
  const [wsSearchOpen, setWsSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("全部");
  const [invitationRole, setInvitationRole] = useState("user");
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const applyWorkspace = (workspace) => {
    setViewer(workspace.viewer);
    setAccounts(workspace.accounts || []);
    setOrganizations(workspace.organizations || []);
    setAssignments(workspace.assignments || []);
    setInvitations(workspace.invitations || []);
    setProjects(workspace.projects || []);
    setAssets(workspace.assets || []);
    setAssetFiles(workspace.files || []);
    setAssetFolders(workspace.assetFolders || []);
    setImageTasks(workspace.imageTasks || []);
    setShots(workspace.shots || []);
    setWeddingWorkflows(workspace.weddingWorkflows || []);
    setActivityLogs(workspace.activityLogs || []);
    setSkillTemplates(workspace.skillTemplates || []);
    setProductionSpecs(workspace.productionSpecs || []);
  };

  const refreshWorkspace = async () => {
    const workspace = await fetchWorkspace(role);
    applyWorkspace(workspace);
    return workspace;
  };

  useEffect(() => {
    let cancelled = false;
    async function verifySession() {
      const session = getSession(role);
      if (!session?.token && !session?.account) {
        if (!cancelled) setViewer(null);
        setSessionReady(true);
        return;
      }
      try {
        const workspace = await fetchWorkspace(role);
        if (!cancelled) {
          applyWorkspace(workspace);
          setSessionError("");
        }
      } catch (error) {
        clearSession(role);
        if (!cancelled) {
          setViewer(null);
          setSessionError(error.message || "登录状态已失效，请重新登录当前入口");
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }
    verifySession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (account, password) => {
    const payload = await apiLogin(role, account, password);
    applyWorkspace(payload.workspace);
    setSessionError("");
    setActivePage(role === "user" ? "ws-dashboard" : "overview");
  };

  const notify = (message) => {
    setNotice(message);
    window.clearTimeout(window.__hjscPortalNotice);
    window.__hjscPortalNotice = window.setTimeout(() => setNotice(""), 2600);
  };

  const logout = async () => {
    await apiLogout(role).catch(() => clearSession(role));
    setViewer(null);
    setActivePage(role === "user" ? "ws-dashboard" : "overview");
  };

  const updateWorkspaceScale = (nextValue) => {
    const value = typeof nextValue === "function" ? nextValue(workspaceScale) : nextValue;
    const normalized = Math.min(1.25, Math.max(0.85, Number(value.toFixed(2))));
    setWorkspaceScale(normalized);
  };

  if (!sessionReady) {
    return <main className="auth-shell"><section className="login-card portal-login-card"><h1>正在校验登录状态</h1><p>正在连接服务器确认账号权限。</p></section></main>;
  }

  if (!viewer) {
    return <PortalLogin role={role} title={portal.title} description={portal.description} onLogin={login} initialError={sessionError} />;
  }

  const scopedAccounts = visibleAccountsFor(viewer, accounts);
  const supervisedAccounts = role === "developer" ? scopedAccounts : scopedAccounts.filter((account) => account.id !== viewer.id);
  const scopedProjects = visibleProjectsFor(viewer, projects, accounts);
  const scopedProjectIds = new Set(scopedProjects.map((project) => project.id));
  const managerCount = supervisedAccounts.filter((account) => account.role === "manager").length;
  const adminCount = supervisedAccounts.filter((account) => account.role === "admin").length;
  const userCount = supervisedAccounts.filter((account) => account.role === "user").length;
  const pendingAccountCount = supervisedAccounts.filter((account) => account.approvalStatus === "pending").length;
  const usableInvitationCount = invitations.filter((item) => !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now() && item.useCount < item.maxUses).length;
  const pendingReviews = [
    ...assets.filter((item) => scopedProjectIds.has(item.projectId) && item.status === "待审核"),
    ...imageTasks.filter((item) => scopedProjectIds.has(item.projectId) && item.status === "待审核"),
    ...shots.filter((item) => scopedProjectIds.has(item.projectId) && item.status === "待审核"),
  ];
  const averageProgress = scopedProjects.length ? Math.round(scopedProjects.reduce((sum, item) => sum + (item.progress || 0), 0) / scopedProjects.length) : 0;
  const visibleNames = new Set(scopedAccounts.map((account) => account.name));
  const scopedLogs = role === "developer" ? activityLogs : activityLogs.filter((item) => visibleNames.has(item.user));
  const wsBadges = workspaceBadgeCounts({ projects, imageTasks, assignments }, viewer);
  const filteredAccounts = supervisedAccounts.filter((account) => {
    const needle = search.trim().toLowerCase();
    const matchesRole = roleFilter === "全部" || ROLE_LABELS[account.role] === roleFilter;
    const haystack = `${account.name || ""} ${account.account || ""} ${account.department || ""}`.toLowerCase();
    return matchesRole && (!needle || haystack.includes(needle));
  });

  const recordAudit = (action, target, status = "已完成") => {
    const now = new Date();
    setActivityLogs((items) => [{
      id: `记录-${now.getTime()}`,
      userId: viewer.id,
      user: viewer.name,
      action,
      target,
      project: "账号与组织",
      status,
      time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    }, ...items].slice(0, 200));
  };

  const createOrganization = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get("name")?.trim();
    const adminName = form.get("adminName")?.trim();
    const adminAccount = form.get("adminAccount")?.trim();
    const adminPassword = form.get("adminPassword")?.trim();
    if (!name) return;
    if (!adminName || !adminAccount || !adminPassword) return notify("请填写组织管理员姓名、账号和初始密码");
    const organization = {
      name,
      description: form.get("description")?.trim() || "",
    };
    try {
      const saved = await apiCreateOrganization(role, organization);
      const admin = await apiCreateAccount(role, {
        role: "admin",
        name: adminName,
        account: adminAccount,
        password: adminPassword,
        organizationId: saved.organization.id,
        department: "组织管理",
      });
      setOrganizations((items) => [saved.organization, ...items]);
      setAccounts((items) => [admin.account, ...items]);
      setModal(null);
      setActivePage("organizations");
      await refreshWorkspace();
      notify("组织和管理员已创建");
    } catch (error) {
      notify(error.message || "组织创建失败");
    }
  };

  const createAccount = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const account = form.get("account")?.trim();
    const name = form.get("name")?.trim();
    const accountRole = form.get("role");
    const password = form.get("password")?.trim();
    if (!account || !name || !accountRole || !password) return notify("请填写姓名、账号、身份和初始密码");
    const organizationId = form.get("organizationId") || null;
    if (role === "developer" && accountRole !== "admin") return notify("开发者端只创建管理员账号");
    if (role === "developer" && !organizationId) return notify("请选择管理员所属组织");
    const accountPayload = {
      account,
      name,
      role: accountRole,
      department: form.get("department")?.trim() || "未设置",
      organizationId,
      parentId: form.get("parentId") || null,
      password,
    };
    try {
      const saved = await apiCreateAccount(role, accountPayload);
      setAccounts((items) => [saved.account, ...items]);
      setModal(null);
      setActivePage("people");
      await refreshWorkspace();
      notify("账号已创建并设置归属");
    } catch (error) {
      notify(error.message || "账号创建失败");
    }
  };

  const createInvitation = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const saved = await apiCreateInvitation(role, {
        role: form.get("role"),
        department: form.get("department")?.trim() || "未设置",
        parentId: form.get("parentId") || viewer.id,
        expiresInHours: Number(form.get("expiresInHours")) || 72,
        maxUses: Number(form.get("maxUses")) || 1,
        requiresApproval: form.get("requiresApproval") === "on",
      });
      await refreshWorkspace();
      setModal({ type: "invitation-result", invitation: saved.invitation, invitationToken: saved.invitationToken });
      notify("邀请已生成");
    } catch (error) {
      notify(error.message || "邀请创建失败");
    }
  };

  const revokeInvitation = async (invitation) => {
    if (!window.confirm("确认撤销这条邀请？撤销后链接立即失效。")) return;
    try {
      await apiRevokeInvitation(role, invitation.id);
      await refreshWorkspace();
      notify("邀请已撤销");
    } catch (error) {
      notify(error.message || "邀请撤销失败");
    }
  };

  const reviewAccount = async (account, approvalStatus) => {
    try {
      const saved = await apiReviewAccountApproval(role, account.id, approvalStatus);
      setAccounts((items) => items.map((item) => item.id === saved.account.id ? saved.account : item));
      await refreshWorkspace();
      notify(approvalStatus === "approved" ? "成员已确认，可以登录" : "加入申请已拒绝");
    } catch (error) {
      notify(error.message || "账号确认失败");
    }
  };

  const invitationRoot = window.location.origin === "null"
    ? "https://www.zhiyinstudio.cn/"
    : `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
  const invitationLink = modal?.type === "invitation-result"
    ? `${invitationRoot}#invite=${encodeURIComponent(modal.invitationToken)}`
    : "";

  const copyInvitationLink = async () => {
    try {
      await navigator.clipboard.writeText(invitationLink);
      notify("邀请链接已复制");
    } catch {
      notify("复制失败，请选中链接后手动复制");
    }
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assignee = supervisedAccounts.find((item) => item.id === form.get("assigneeId") && item.role === "user");
    const title = form.get("title")?.trim();
    if (!assignee || !title) return notify("请先选择直属用户并填写任务");
    const assignment = {
      assigneeId: assignee.id,
      title,
      description: form.get("description")?.trim() || "",
      dueDate: form.get("dueDate") || "未设置",
      priority: form.get("priority") || "普通",
    };
    try {
      const saved = await apiCreateAssignment(role, assignment);
      setAssignments((items) => [saved.assignment, ...items]);
      setModal(null);
      setActivePage("assignments");
      await refreshWorkspace();
      notify("任务已分配给直属用户");
    } catch (error) {
      notify(error.message || "任务分配失败");
    }
  };

  const createSkillTemplate = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      scope: form.get("scope") || "组织",
      organizationId: form.get("organizationId") || null,
      name: form.get("name")?.trim(),
      type: form.get("type"),
      assetTypeLabel: form.get("assetTypeLabel")?.trim() || "制作记录",
      recommendedRatio: form.get("recommendedRatio")?.trim() || "",
      description: form.get("description")?.trim() || "",
      fields: [{ key: "requirement", label: "制作要求", required: true }],
      checklist: ["内容来自真实填写", "字段完整", "可追溯到项目"],
    };
    if (!payload.name) return notify("请填写模板名称");
    try {
      const saved = await apiCreateSkillTemplate(role, payload);
      setSkillTemplates((items) => [saved.skillTemplate, ...items]);
      setModal(null);
      setActivePage("skill-templates");
      await refreshWorkspace();
      notify("规范模板已创建");
    } catch (error) {
      notify(error.message || "规范模板创建失败");
    }
  };

  const toggleSkillTemplate = async (template) => {
    const nextStatus = template.status === "启用" ? "停用" : "启用";
    try {
      const saved = await apiUpdateSkillTemplate(role, template.id, { status: nextStatus });
      setSkillTemplates((items) => items.map((item) => item.id === saved.skillTemplate.id ? saved.skillTemplate : item));
      await refreshWorkspace();
      notify(nextStatus === "启用" ? "模板已启用" : "模板已停用");
    } catch (error) {
      notify(error.message || "模板状态更新失败");
    }
  };

  const overview = () => (
    <>
      <PageHeader eyebrow={portal.navGroups[0].items[0].label} title={portal.sidebarTitle} description={ROLE_SCOPES[role]}>
        <span className="admin-local-badge"><span /> 在线服务已连接</span>
      </PageHeader>
      <section className="admin-metric-grid">
        {role === "developer" ? <>
          <Metric icon={Buildings} label="全部组织" value={organizations.length} note="平台内所有组织" />
          <Metric icon={ShieldCheck} label="全部管理员" value={adminCount} note="组织管理账号" />
          <Metric icon={UsersThree} label="全部经理" value={managerCount} note="直属团队负责人" />
          <Metric icon={UserCircleGear} label="全部用户" value={userCount} note="平台生产账号" />
        </> : <>
          {role === "admin" && <Metric icon={UsersThree} label="下属经理" value={managerCount} note="当前组织范围" />}
          <Metric icon={UserCircleGear} label={role === "manager" ? "直属用户" : "可见用户"} value={userCount} note="当前组织关系" />
          <Metric icon={SquaresFour} label="可见项目" value={scopedProjects.length} note={`平均进度 ${averageProgress}%`} />
          <Metric icon={ListChecks} label="待处理审核" value={pendingReviews.length} note="资产、图片与分镜" attention={pendingReviews.length > 0} />
          {role === "manager" && <Metric icon={ClipboardText} label="已分配任务" value={assignments.filter((item) => item.managerId === viewer.id).length} note="直属用户任务" />}
        </>}
      </section>
      <section className="admin-overview-grid">
        <article className="panel admin-team-panel">
          <div className="panel-heading"><div><span className="eyebrow">权限层级</span><h2>当前账号可见范围</h2></div><button className="admin-link" onClick={() => setActivePage(role === "developer" ? "organizations" : "people")}>查看明细 <ArrowRight size={13} /></button></div>
          <div className="hierarchy-flow">{roleHierarchy(role).map((item, index) => <div key={item.label}><span>{index + 1}</span><div><strong>{item.label}</strong><small>{item.note}</small></div>{index < roleHierarchy(role).length - 1 && <i />}</div>)}</div>
        </article>
        <aside className="panel admin-health-panel">
          <div className="panel-heading"><div><span className="eyebrow">数据状态</span><h2>接入准备</h2></div></div>
          <div className="admin-health-score"><strong>在线服务</strong><span>四端账号与权限范围</span></div>
          <div className="admin-health-list"><div><span><CheckCircle size={14} /> 四端入口</span><Status value="正常" /></div><div><span><ShieldCheck size={14} /> 权限范围</span><Status value="正常" /></div><div><span><HardDrives size={14} /> 服务器数据</span><Status value="正常" /></div><div><span><Clock size={14} /> 操作记录</span><Status value="正常" /></div></div>
        </aside>
      </section>
      <section className="panel admin-project-strip">
        <div className="panel-heading"><div><span className="eyebrow">团队进度</span><h2>可见项目</h2></div><button className="admin-link" onClick={() => setActivePage("projects")}>项目明细 <ArrowRight size={13} /></button></div>
        {scopedProjects.length ? scopedProjects.slice(0, 5).map((project) => <div className="admin-project-row" key={project.id}><div><strong>{project.name}</strong><small>{project.type || "未填写类型"} · {project.stage || "未填写阶段"}</small></div><Progress value={project.progress} /><span>{assets.filter((item) => item.projectId === project.id).length} 项资产</span><span>{shots.filter((item) => item.projectId === project.id).length} 个镜头</span><Status value="制作中" /></div>) : <EmptyState icon={SquaresFour} title="暂无可见项目" description="创建项目并建立负责人关系后，这里显示当前范围内的真实项目。" />}
      </section>
    </>
  );

  const people = () => (
    <>
      <PageHeader eyebrow="账号与层级" title={role === "manager" ? "我的成员" : role === "admin" ? "组织人员" : "全部账号"} description={ROLE_SCOPES[role]}><Status value={pendingAccountCount ? "待确认" : "正常"}>{pendingAccountCount ? `${pendingAccountCount} 个待确认` : `${supervisedAccounts.length} 个可见账号`}</Status>{role === "admin" && <button className="button" onClick={() => setModal({ type: "invitation" })}><LinkSimple size={15} /> 邀请成员</button>}{role !== "manager" && <button className="button button-primary" onClick={() => setModal({ type: "account" })}><UserPlus size={15} /> {role === "developer" ? "新增管理员" : "直接创建账号"}</button>}</PageHeader>
      <div className="admin-activity-tools"><label><MagnifyingGlass size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名、账号或部门" /></label><div>{["全部", "开发者", "管理员", "经理", "用户"].filter((item) => role === "developer" || !["开发者", "管理员"].includes(item)).map((item) => <button key={item} className={roleFilter === item ? "active" : ""} onClick={() => setRoleFilter(item)}>{item}</button>)}</div></div>
      <section className="panel hierarchy-table">
        <div className="hierarchy-table-head people-table-grid"><span>姓名 / 账号</span><span>身份</span><span>部门</span><span>直属上级</span><span>项目</span><span>状态</span><span>操作</span></div>
        {filteredAccounts.length ? filteredAccounts.map((account) => <div className="hierarchy-table-row people-table-grid" key={account.id}><span><strong>{account.name}</strong><small>{account.account}</small></span><span>{ROLE_LABELS[account.role] || "未设置"}</span><span>{account.department || "未设置"}</span><span>{account.parentName || "未设置"}</span><span>{projects.filter((project) => project.ownerId === account.id).length}</span><Status value={account.approvalStatus === "pending" ? "待确认" : account.approvalStatus === "rejected" ? "已拒绝" : account.status || "离线"} /><span className="row-actions">{role === "admin" && account.approvalStatus === "pending" ? <><button className="admin-link" onClick={() => reviewAccount(account, "approved")}>确认</button><button className="admin-link danger-link" onClick={() => reviewAccount(account, "rejected")}>拒绝</button></> : <small>—</small>}</span></div>) : <EmptyState icon={UsersThree} title="暂无下属账号" description={role === "manager" ? "管理员设置直属用户后，将在这里显示。" : "管理员可以生成邀请，也可以直接创建内部账号。"} />}
      </section>
    </>
  );

  const projectPage = () => (
    <>
      <PageHeader eyebrow="项目范围" title="项目进度" description="只显示当前账号权限范围内的项目、负责人和制作状态。" />
      <section className="admin-monitor-table panel">
        <div className="admin-table-head"><span>项目</span><span>负责人</span><span>当前阶段</span><span>整体进度</span><span>资产</span><span>图片任务</span><span>分镜</span><span>状态</span></div>
        {scopedProjects.length ? scopedProjects.map((project) => <div className="admin-table-row" key={project.id}><span><strong>{project.name}</strong><small>{project.type || "未填写类型"} · {project.aspectRatio || "未填写画幅"}</small></span><span>{accounts.find((account) => account.id === project.ownerId)?.name || "未设置"}</span><span>{project.stage || "未设置"}</span><Progress value={project.progress} /><span><strong>{assets.filter((item) => item.projectId === project.id).length}</strong></span><span><strong>{imageTasks.filter((item) => item.projectId === project.id).length}</strong></span><span><strong>{shots.filter((item) => item.projectId === project.id).length}</strong></span><Status value="制作中" /></div>) : <EmptyState icon={SquaresFour} title="暂无项目数据" description="当前可见范围内还没有项目。" />}
      </section>
    </>
  );

  const activityPage = () => (
    <>
      <PageHeader eyebrow={role === "developer" ? "全平台审计" : "组织审计"} title={role === "developer" ? "权限与操作审计" : "操作记录"} description="记录账号登录、权限调整、项目操作、审核和异常。" />
      <section className="admin-activity-table panel"><div className="admin-activity-head"><span>时间</span><span>成员</span><span>操作</span><span>对象</span><span>项目</span><span>结果</span></div>{scopedLogs.length ? scopedLogs.map((item) => <div className="admin-activity-row" key={item.id}><time>{item.time}</time><span>{item.user}</span><strong>{item.action}</strong><span>{item.target}</span><span>{item.project}</span><Status value={item.status} /></div>) : <EmptyState icon={Pulse} title="暂无操作记录" description="真实账号开始工作后，关键操作会在这里留痕。" />}</section>
    </>
  );

  const assignmentsPage = () => {
    const ownAssignments = assignments.filter((item) => item.managerId === viewer.id);
    const directUsers = supervisedAccounts.filter((item) => item.role === "user");
    return <><PageHeader eyebrow="直属团队" title="任务分配" description="把工作分配给直属用户，并查看接受、进行和完成状态。"><Status value="正常">{ownAssignments.length} 项任务</Status><button className="button button-primary" disabled={directUsers.length === 0} onClick={() => setModal({ type: "assignment" })}><Plus size={15} /> {directUsers.length ? "新建任务" : "暂无直属用户"}</button></PageHeader><section className="panel assignment-table"><div className="assignment-table-head"><span>任务</span><span>负责人</span><span>截止时间</span><span>优先级</span><span>状态</span></div>{ownAssignments.length ? ownAssignments.map((item) => <div className="assignment-table-row" key={item.id}><span><strong>{item.title}</strong><small>{item.description || "无补充说明"}</small></span><span>{item.assigneeName}</span><span>{item.dueDate}</span><span>{item.priority}</span><Status value={item.status} /></div>) : <EmptyState icon={ClipboardText} title="暂无分配任务" description={directUsers.length ? "点击右上角新建任务，并分配给直属用户。" : "管理员设置直属用户后，即可开始分配任务。"} />}</section></>;
  };

  const reviewsPage = () => (
    <><PageHeader eyebrow="审核范围" title={role === "manager" ? "待我审核" : "审核中心"} description="仅显示当前权限范围内的资产、图片结果和分镜审核。"><Status value="待审核">{pendingReviews.length} 项待处理</Status></PageHeader><section className="panel oversight-list">{pendingReviews.length ? pendingReviews.map((item) => <div key={`${item.id}-${item.projectId}`}><strong>{item.name || item.number || "未命名内容"}</strong><span>{scopedProjects.find((project) => project.id === item.projectId)?.name || "未关联项目"}</span><Status value="待审核" /></div>) : <EmptyState icon={ListChecks} title="暂无待审核事项" description="当前权限范围内没有需要处理的内容。" />}</section></>
  );

  const invitationStatus = (item) => {
    if (item.revokedAt) return "已撤销";
    if (new Date(item.expiresAt).getTime() <= Date.now()) return "已过期";
    if (item.useCount >= item.maxUses) return "已用完";
    return "可使用";
  };

  const invitationsPage = () => (
    <>
      <PageHeader eyebrow="受控加入" title="成员邀请" description="组织编号只用于识别组织；新成员必须通过有效邀请注册。"><Status value={usableInvitationCount ? "可使用" : "正常"}>{usableInvitationCount} 条可用邀请</Status><button className="button button-primary" onClick={() => setModal({ type: "invitation" })}><LinkSimple size={15} /> 生成邀请</button></PageHeader>
      <section className="panel invitation-table">
        <div className="invitation-table-head"><span>邀请身份</span><span>部门</span><span>直属上级</span><span>有效期</span><span>使用情况</span><span>加入确认</span><span>状态 / 操作</span></div>
        {invitations.length ? invitations.map((item) => { const state = invitationStatus(item); return <div className="invitation-table-row" key={item.id}><span><strong>{ROLE_LABELS[item.role]}</strong><small>{item.id}</small></span><span>{item.department || "未设置"}</span><span>{item.parentName || "未设置"}</span><span>{new Date(item.expiresAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span><span>{item.useCount} / {item.maxUses}</span><span>{item.requiresApproval ? "需管理员确认" : "注册后直接加入"}</span><span className="row-actions"><Status value={state} />{state === "可使用" && <button className="admin-link danger-link" onClick={() => revokeInvitation(item)}>撤销</button>}</span></div>; }) : <EmptyState icon={LinkSimple} title="暂无成员邀请" description="生成邀请后，将链接单独发送给需要加入组织的成员。" />}
      </section>
    </>
  );

  const organizationsPage = () => (
    <><PageHeader eyebrow="平台组织" title="组织管理" description="创建组织并指定该组织的管理员账号。"><Status value="正常">{organizations.length} 个组织</Status><button className="button button-primary" onClick={() => setModal({ type: "organization" })}><Plus size={15} /> 新增组织</button></PageHeader><section className="organization-grid">{organizations.length ? organizations.map((item) => <article className="panel organization-card" key={item.id}><div className="feature-icon"><Buildings size={20} /></div><h2>{item.name}</h2><p>{item.description || "暂无组织说明"}</p><dl><div><dt>管理员</dt><dd>{accounts.filter((account) => account.organizationId === item.id && account.role === "admin").length}</dd></div><div><dt>经理</dt><dd>{accounts.filter((account) => account.organizationId === item.id && account.role === "manager").length}</dd></div><div><dt>用户</dt><dd>{accounts.filter((account) => account.organizationId === item.id && account.role === "user").length}</dd></div></dl></article>) : <article className="panel"><EmptyState icon={Buildings} title="暂无组织" description="点击右上角新增组织，并为组织指定管理员。" /></article>}</section></>
  );

  const skillTemplatesPage = () => {
    const scopedTemplates = role === "developer" ? skillTemplates : skillTemplates.filter((item) => !item.orgId || item.orgId === viewer.organizationId || item.orgId === viewer.orgId);
    return <><PageHeader eyebrow="模板库" title="规范模板" description="配置组织可用的制作规范字段、版本和启停状态。"><Status value="正常">{scopedTemplates.length} 项模板</Status><button className="button button-primary" onClick={() => setModal({ type: "skill-template" })}><Plus size={15} /> 新增模板</button></PageHeader><section className="panel hierarchy-table"><div className="hierarchy-table-head"><span>模板</span><span>类型</span><span>范围</span><span>版本</span><span>状态</span><span>操作</span></div>{scopedTemplates.length ? scopedTemplates.map((template) => <div className="hierarchy-table-row" key={template.id}><span><strong>{template.name}</strong><small>{template.description || "暂无说明"}</small></span><span>{template.assetTypeLabel || template.type}</span><span>{template.scope || (template.orgId ? "组织" : "平台")}</span><span>第 {template.version || 1} 版</span><Status value={template.status || "启用"} /><span>{role === "developer" || template.orgId ? <button className="admin-link" onClick={() => toggleSkillTemplate(template)}>{template.status === "启用" ? "停用" : "启用"}</button> : <small>平台模板</small>}</span></div>) : <EmptyState icon={FileText} title="暂无规范模板" description="新增模板后，用户端制作规范会按模板入库。" />}</section></>;
  };

  const connectionCards = [
    { icon: ShieldCheck, title: "账号验证服务", note: "登录、会话与账号状态", state: "正常" },
    { icon: HardDrives, title: "服务器数据服务", note: "组织、人员、项目与资产", state: "正常" },
    { icon: Pulse, title: "操作记录服务", note: "进度、操作记录与任务通知", state: "正常" },
  ];

  const servicesPage = (developer = false) => (
    <><PageHeader eyebrow={developer ? "平台服务" : "服务配置"} title={developer ? "服务状态" : "接入配置"} description="当前入口连接服务器后端，账号、组织和项目数据按权限读取。"><Status value="正常">运行中</Status></PageHeader><section className="admin-connection-grid">{connectionCards.map((item) => { const Icon = item.icon; return <article className="panel admin-connection-card" key={item.title}><div className="admin-connection-icon"><Icon size={22} /></div><div><span className="eyebrow">已启用</span><h2>{item.title}</h2><p>{item.note}</p><code>服务器后端</code></div><Status value={item.state} /></article>; })}</section><section className="panel admin-access-flow"><div className="panel-heading"><div><span className="eyebrow">账号流程</span><h2>正式使用流程</h2></div></div><div>{["开发者创建组织", "指定管理员", "管理员创建成员", "成员进入对应端"].map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, "0")}</b><strong>{item}</strong><small>{["创建组织并命名管理员", "管理员从管理端登录", "经理和用户由管理员创建", "账号身份决定可进入的界面"][index]}</small></span>)}</div></section></>
  );

  const settingsPage = () => (
    <><PageHeader eyebrow="平台配置" title="系统配置" description="配置平台组织、管理员账号、权限模板和安全策略。"><Status value="正常" /></PageHeader><section className="permission-matrix panel"><div className="permission-matrix-head"><span>身份</span><span>人员范围</span><span>项目范围</span><span>审核范围</span><span>系统配置</span></div>{[
      ["开发者", "全部账号", "全部项目", "全部审核", "可配置"],
      ["管理员", "所属经理与用户", "所属组织", "所属组织", "不可配置"],
      ["经理", "直属用户", "直属团队", "直属团队", "不可配置"],
      ["用户", "仅自己", "仅自己", "仅自己提交", "不可配置"],
    ].map((row) => <div className="permission-matrix-row" key={row[0]}>{row.map((cell, index) => <span key={`${cell}-${index}`}>{cell}</span>)}</div>)}</section></>
  );

  const renderPage = () => {
    if (activePage.startsWith("ws-")) {
      return (
        <ProductionWorkspace
          role={role}
          viewer={viewer}
          data={{ projects, assets, assetFiles, assetFolders, imageTasks, shots, weddingWorkflows, skillTemplates, productionSpecs, assignments }}
          actions={{ setProjects, setAssets, setAssetFiles, setAssetFolders, setImageTasks, setShots, setWeddingWorkflows, setProductionSpecs, setAssignments, setActivityLogs }}
          refreshWorkspace={refreshWorkspace}
          notify={notify}
          activePage={activePage.slice(3)}
          navigate={(page) => setActivePage(`ws-${page}`)}
          searchOpen={wsSearchOpen}
          setSearchOpen={setWsSearchOpen}
        />
      );
    }
    if (activePage === "people") return people();
    if (activePage === "projects") return projectPage();
    if (activePage === "activity") return activityPage();
    if (activePage === "assignments") return assignmentsPage();
    if (activePage === "reviews") return reviewsPage();
    if (activePage === "organizations") return organizationsPage();
    if (activePage === "invitations") return invitationsPage();
    if (activePage === "skill-templates") return skillTemplatesPage();
    if (activePage === "services") return servicesPage(true);
    if (activePage === "connections") return servicesPage(false);
    if (activePage === "settings") return settingsPage();
    return overview();
  };

  return (
    <div className="app-shell admin-shell">
      <aside className="sidebar admin-sidebar">
        <div className="brand"><div className="brand-mark"><div className="brand-mark-letter" aria-hidden="true">R</div></div><div><strong>ReelMesh Studio</strong><span>{portal.title}</span></div></div>
        <div className="admin-side-label"><span className="sidebar-caption">{ROLE_LABELS[role]}账号</span><strong>{portal.sidebarTitle}</strong><small>{role === "developer" ? "平台运营入口" : role === "admin" ? "组织管理入口" : role === "manager" ? "团队管理入口" : "个人制作入口"}</small></div>
        <nav>{portal.navGroups.map((group) => {
          const sections = group.items.reduce((result, item) => {
            const section = item.section || "";
            result[section] = result[section] || [];
            result[section].push(item);
            return result;
          }, {});
          return <div className="nav-group" key={group.caption}>
            {portal.navGroups.length > 1 && <span className="sidebar-caption nav-group-caption">{group.caption}</span>}
            {Object.entries(sections).map(([section, items]) => <div className="nav-subgroup" key={section || "default"}>
              {section && <span className="nav-subgroup-caption">{section}</span>}
              {items.map((item) => {
                const Icon = item.icon;
                const badge = item.id === "reviews" ? pendingReviews.length
                  : item.id === "invitations" ? pendingAccountCount
                  : wsBadges[item.id.startsWith("ws-") ? item.id.slice(3) : ""] || 0;
                return <button className={activePage === item.id ? "active" : ""} key={item.id} onClick={() => setActivePage(item.id)}><Icon size={17} weight={activePage === item.id ? "fill" : "regular"} /><span>{item.label}</span>{badge ? <em>{badge}</em> : null}</button>;
              })}
            </div>)}
          </div>;
        })}</nav>
        <div className="sidebar-bottom">
          <div className="user-card"><span>{viewer.name.slice(0, 1)}</span><div><strong>{viewer.name}</strong><small>{ROLE_LABELS[role]}账号</small></div><button className="icon-button" aria-label="退出登录" onClick={logout}><SignOut size={16} /></button></div>
          <div className="creator-credit" aria-label="创作者和联系信息">
            <strong>创作者 · Murphy</strong>
            <span>邮箱 shuaishuaidai2@gmail.com</span>
          </div>
        </div>
      </aside>
      <section className="app-main">
        <header className="topbar"><div className="breadcrumb"><span>{portal.title}</span><i>/</i><strong>{portalNavItems(portal).find((item) => item.id === activePage)?.label}</strong></div><div className="topbar-right"><div className="zoom-control"><button aria-label="缩小工作台" onClick={() => updateWorkspaceScale((value) => value - 0.1)}><Minus size={13} /></button><button aria-label="还原工作台比例" onClick={() => updateWorkspaceScale(1.1)}>{Math.round(workspaceScale * 100)}%</button><button aria-label="放大工作台" onClick={() => updateWorkspaceScale((value) => value + 0.1)}><Plus size={13} /></button></div><span className="admin-sync-state"><i /> 在线服务</span><button className="icon-button" aria-label="查看待办" onClick={() => setActivePage(role === "manager" ? "assignments" : role === "admin" ? "reviews" : role === "developer" ? "activity" : "ws-my-work")}><Bell size={17} /></button><button className="admin-account-button">{viewer.name} <span>{viewer.name.slice(0, 1)}</span></button></div></header>
        <main className="content admin-content"><div className="workspace-scale" style={{ "--workspace-scale": workspaceScale }}>{renderPage()}</div></main>
      </section>
      {modal?.type === "organization" && (
        <PortalModal title="新增组织" eyebrow="组织管理" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={createOrganization}>
            <FormField label="组织名称"><input name="name" required placeholder="请输入组织名称" /></FormField>
            <FormField label="组织说明" full><textarea name="description" placeholder="填写组织职责或业务范围" /></FormField>
            <FormField label="管理员姓名"><input name="adminName" required placeholder="请输入管理员姓名" /></FormField>
            <FormField label="管理员账号"><input name="adminAccount" required placeholder="请输入管理员登录账号" /></FormField>
            <FormField label="管理员初始密码"><input name="adminPassword" required type="password" placeholder="请输入初始密码" /></FormField>
            <p className="field-help field-full">组织创建后，管理员会进入管理端继续创建经理和用户账号。</p>
            <button className="button button-primary field-full" type="submit">创建组织和管理员</button>
          </form>
        </PortalModal>
      )}
      {modal?.type === "account" && (
        <PortalModal title={role === "developer" ? "新增管理员" : "新增账号"} eyebrow="账号与层级" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={createAccount}>
            <FormField label="姓名"><input name="name" required placeholder="请输入姓名" /></FormField>
            <FormField label="登录账号"><input name="account" required placeholder="请输入登录账号" /></FormField>
            <FormField label="初始密码"><input name="password" required type="password" placeholder="请输入初始密码" /></FormField>
            <FormField label="身份"><select name="role">{(role === "developer" ? ["admin"] : ["manager", "user"]).map((item) => <option value={item} key={item}>{ROLE_LABELS[item]}</option>)}</select></FormField>
            <FormField label="部门"><input name="department" placeholder="请输入部门" /></FormField>
            {role === "developer" && <FormField label="所属组织"><select name="organizationId" required><option value="">请选择组织</option>{organizations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></FormField>}
            {role !== "developer" && <FormField label="直属上级"><select name="parentId"><option value="">{role === "admin" ? `直属当前管理员：${viewer.name}` : "暂不设置"}</option>{supervisedAccounts.filter((item) => ["admin", "manager"].includes(item.role) && item.id !== viewer.id).map((item) => <option value={item.id} key={item.id}>{item.name} · {ROLE_LABELS[item.role]}</option>)}</select></FormField>}
            <p className="field-help field-full">{role === "developer" ? "管理员账号创建后，只能从管理端登录；经理和用户由管理员在管理端创建。" : "初始密码只提交到后端哈希保存，前端不保存明文。"}</p>
            <button className="button button-primary field-full" type="submit">{role === "developer" ? "创建管理员" : "创建并设置归属"}</button>
          </form>
        </PortalModal>
      )}
      {modal?.type === "invitation" && role === "admin" && (
        <PortalModal title="生成成员邀请" eyebrow="受控加入" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={createInvitation}>
            <FormField label="邀请身份"><select name="role" value={invitationRole} onChange={(event) => setInvitationRole(event.target.value)}><option value="user">用户</option><option value="manager">经理</option></select></FormField>
            <FormField label="直属上级"><select name="parentId" required>{invitationRole === "manager" ? <option value={viewer.id}>{viewer.name} · 管理员</option> : <><option value={viewer.id}>{viewer.name} · 管理员</option>{supervisedAccounts.filter((item) => item.role === "manager" && item.approvalStatus !== "pending").map((item) => <option value={item.id} key={item.id}>{item.name} · 经理</option>)}</>}</select></FormField>
            <FormField label="部门"><input name="department" placeholder="例如 分镜组、资产组" /></FormField>
            <FormField label="有效期"><select name="expiresInHours" defaultValue="72"><option value="24">24 小时</option><option value="72">3 天</option><option value="168">7 天</option><option value="720">30 天</option></select></FormField>
            <FormField label="可使用次数"><input name="maxUses" type="number" min="1" max="100" defaultValue="1" /></FormField>
            <label className="approval-check"><input name="requiresApproval" type="checkbox" defaultChecked /><span><strong>注册后需管理员确认</strong><small>确认前账号不能登录工作台</small></span></label>
            <p className="field-help field-full">邀请链接包含一次性凭证。组织编号不会写进链接，也不能单独用于注册。</p>
            <button className="button button-primary field-full" type="submit"><LinkSimple size={15} /> 生成邀请链接</button>
          </form>
        </PortalModal>
      )}
      {modal?.type === "invitation-result" && (
        <PortalModal title="邀请链接已生成" eyebrow="仅显示一次" onClose={() => setModal(null)}>
          <div className="invitation-result">
            <div className="invitation-result-summary"><Status value="可使用" /><strong>{ROLE_LABELS[modal.invitation.role]}邀请</strong><span>{modal.invitation.remainingUses} 次可用 · {modal.invitation.requiresApproval ? "需要管理员确认" : "注册后直接加入"}</span></div>
            <label className="form-field"><span>邀请链接</span><textarea readOnly value={invitationLink} onFocus={(event) => event.currentTarget.select()} /></label>
            <p className="field-help">为安全起见，服务端只保存凭证哈希。关闭窗口后无法再次查看原链接，需要时请重新生成。</p>
            <button className="button button-primary" type="button" onClick={copyInvitationLink}><Copy size={15} /> 复制邀请链接</button>
          </div>
        </PortalModal>
      )}
      {modal?.type === "skill-template" && <PortalModal title="新增规范模板" eyebrow="模板库" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createSkillTemplate}>{role === "developer" && <FormField label="模板范围"><select name="scope"><option>平台</option><option>组织</option></select></FormField>}{role === "developer" && <FormField label="所属组织"><select name="organizationId"><option value="">平台模板或暂不分配</option>{organizations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></FormField>}<FormField label="模板名称"><input name="name" required placeholder="请输入模板名称" /></FormField><FormField label="模板类型"><select name="type"><option value="character">人物</option><option value="costume">服装</option><option value="scene">场景</option><option value="prop">道具</option><option value="extras">群演</option><option value="storyboard">分镜静帧</option><option value="video">视频提示词</option><option value="shotlist">镜头表</option><option value="image">生图提示词</option><option value="script">剧本</option></select></FormField><FormField label="资产标签"><input name="assetTypeLabel" placeholder="例如 人物、场景、制作记录" /></FormField><FormField label="建议画幅"><input name="recommendedRatio" placeholder="例如 3:4、16:9" /></FormField><FormField label="模板说明" full><textarea name="description" placeholder="填写模板适用范围和字段要求" /></FormField><p className="field-help field-full">当前版本先固定基础字段；后续会接字段编辑器、版本发布和审核标准模板。</p><button className="button button-primary field-full" type="submit">创建模板</button></form></PortalModal>}
      {modal?.type === "assignment" && <PortalModal title="新建任务" eyebrow="直属团队" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createAssignment}><FormField label="任务名称"><input name="title" required placeholder="请输入任务名称" /></FormField><FormField label="负责人"><select name="assigneeId" required>{supervisedAccounts.filter((item) => item.role === "user").map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></FormField><FormField label="截止时间"><input name="dueDate" type="date" /></FormField><FormField label="优先级"><select name="priority"><option>普通</option><option>重要</option><option>紧急</option></select></FormField><FormField label="任务说明" full><textarea name="description" placeholder="填写交付要求与注意事项" /></FormField><button className="button button-primary field-full" type="submit">确认分配</button></form></PortalModal>}
      {notice && <div className="toast"><CheckCircle size={17} weight="fill" />{notice}</div>}
    </div>
  );
}
