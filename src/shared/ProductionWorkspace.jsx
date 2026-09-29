import { useEffect, useState } from "react";
import {
  Archive,
  ArrowRight,
  ArrowsClockwise,
  CaretDown,
  Check,
  CheckCircle,
  CloudArrowUp,
  CloudCheck,
  ClipboardText,
  Copy,
  DownloadSimple,
  FileText,
  Folder,
  FilmStrip,
  HeartStraight,
  House,
  ImageSquare,
  List,
  ListChecks,
  Microphone,
  MusicNotes,
  LockKey,
  MagnifyingGlass,
  Package,
  Plus,
  SquaresFour,
  Scissors,
  TreeStructure,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { STORAGE_KEYS, useStoredState } from "./storage.js";
import {
  createAsset as apiCreateAsset,
  createAssetFolder as apiCreateAssetFolder,
  deleteAsset as apiDeleteAsset,
  createImageTask as apiCreateImageTask,
  createImageWorkflow as apiCreateImageWorkflow,
  approveImageTask as apiApproveImageTask,
  createH3VideoTask as apiCreateH3VideoTask,
  createProductionSpec as apiCreateProductionSpec,
  createProject as apiCreateProject,
  fileToDataUrl,
  fetchH3Connection as apiFetchH3Connection,
  fetchImageConnection as apiFetchImageConnection,
  loadGenerationVideo as apiLoadGenerationVideo,
  retryImageTask as apiRetryImageTask,
  syncH3VideoTask as apiSyncH3VideoTask,
  updateH3Connection as apiUpdateH3Connection,
  updateImageConnection as apiUpdateImageConnection,
  updateAssignment as apiUpdateAssignment,
  renderSubtitleVideo as apiRenderSubtitleVideo,
  transcribeVideo as apiTranscribeVideo,
  uploadAssetFile as apiUploadAssetFile,
  saveWeddingWorkflow as apiSaveWeddingWorkflow,
} from "./api.js";
import { SKILLS, SKILL_GROUPS, TYPE_LABELS, WORKFLOW, skillGroupOf } from "./production-data.js";
import { EMPTY_WEDDING_WORKFLOW, WEDDING_STEPS, normalizeWeddingWorkflow, weddingProgress, weddingStepIsComplete } from "./wedding-workflow.js";
import { buildAss, cuesFromShots, detectVideoMetadata, downloadPremiereXml, downloadSubtitleSrt, exportPremiereBatchPackage, exportPremierePackage, exportRenderedVideoBatch, exportSubtitleSrtBatch as exportSubtitleSrtBatchPackage, formatSubtitleTime, normalizePremiereSettings, parsePremiereTextStyle, parseSubtitleText, PREMIERE_DEFAULT_SETTINGS, PREMIERE_FONT_FAMILY, PREMIERE_ORIENTATION_PRESETS, PREMIERE_RENDER_FONT_FAMILY, settingsForOrientation, subtitleOutputFilename } from "./premiere.js";
import { matchSubtitleBatch, subtitleStem } from "./subtitle-batch.js";
import { AppButton, CoverThumb, EmptyState, Metric, Modal, FormField as Field, StatusPill, PageHeader } from "./ui.jsx";
import { EditingStudio } from "./EditingStudio.jsx";

export const WORKSPACE_NAV_ITEMS = [
  { id: "quick", label: "快速生成", icon: ImageSquare, section: "开始制作" },
  { id: "dashboard", label: "制作工作台", icon: House, section: "开始制作" },
  { id: "pipeline", label: "制作流程", icon: TreeStructure, section: "开始制作" },
  { id: "wedding", label: "婚礼制作", icon: HeartStraight, section: "开始制作" },
  { id: "projects", label: "我的项目", icon: SquaresFour, section: "素材与计划" },
  { id: "skills", label: "制作规范", icon: FileText, section: "素材与计划" },
  { id: "assets", label: "资产库", icon: Archive, section: "素材与计划" },
  { id: "shots", label: "分镜", icon: FilmStrip, section: "素材与计划" },
  { id: "my-work", label: "我的任务", icon: ClipboardText, section: "生成与交付" },
  { id: "queue", label: "生成队列", icon: ListChecks, section: "生成与交付" },
  { id: "export", label: "导出", icon: DownloadSimple, section: "生成与交付" },
  { id: "premiere", label: "PR 字幕导入", icon: FileText, section: "生成与交付" },
  { id: "video-subtitles", label: "视频自动字幕", icon: Microphone, section: "生成与交付" },
  { id: "editing", label: "剪辑制作", icon: Scissors, section: "生成与交付" },
  { id: "image-service", label: "生图连接", icon: CloudArrowUp, section: "连接服务" },
  { id: "h3", label: "云显卡连接", icon: CloudCheck, section: "连接服务" },
];

export const WORKSPACE_PAGE_IDS = new Set(WORKSPACE_NAV_ITEMS.map((item) => item.id));

export function workspaceBadgeCounts(data, viewer) {
  if (!viewer) return {};
  const myProjectIds = new Set((data.projects || []).filter((project) => project.ownerId === viewer.id).map((project) => project.id));
  return {
    queue: (data.imageTasks || []).filter((task) => myProjectIds.has(task.projectId) && task.status === "待审核").length,
    "my-work": (data.assignments || []).filter((item) => item.assigneeId === viewer.id && item.status !== "已完成").length,
  };
}

const SKILL_PRIORITY = {
  image_prompt_director: 1,
  wedding_image: 2,
  seedance_video_prompt: 3,
  shotlist_builder: 4,
  aigc_pipeline: 5,
  automation_script: 6,
  automation_director: 7,
  automation_storyboard: 8,
  automation_review: 9,
  seedance_suite: 10,
};

const STANDARD_WORKFLOW_FOLDERS = ["00_剧本", "01_人物", "02_服装", "03_场景", "04_道具", "05_群演", "06_静帧", "07_视频", "08_成片", "09_提示词"];

const ARCHIVE_OPTIONS = ["图片", "人物", "服装", "场景", "道具", "群演", "分镜静帧", "视频提示词", "镜头表", "制作记录", "文档"];
const ASPECT_RATIO_OPTIONS = ["16:9", "9:16", "3:4", "4:3", "1:1", "21:9"];
const PROJECT_LEVEL_OPTIONS = ["A", "S", "B"];
const ASSET_TYPE_BY_LABEL = {
  图片: "image",
  人物: "character",
  服装: "costume",
  场景: "scene",
  道具: "prop",
  群演: "extras",
  分镜静帧: "storyboard",
  视频提示词: "video",
  镜头表: "shotlist",
  制作记录: "workflow",
  文档: "document",
};

const PROMPT_CATEGORY_OPTIONS = [
  { id: "character", label: "人物", archive: "人物", group: "assets", description: "脸型、发型、年龄、身份与一致性" },
  { id: "scene", label: "场景", archive: "场景", group: "assets", description: "空间、时间、材质、光线与气氛" },
  { id: "prop", label: "道具", archive: "道具", group: "assets", description: "外形、材质、年代、状态与用途" },
  { id: "costume", label: "服装", archive: "服装", group: "assets", description: "款式、面料、颜色、年代与穿着状态" },
  { id: "extras", label: "群演", archive: "群演", group: "assets", description: "人数、身份、服装、动作与分布" },
  { id: "wedding", label: "婚礼画面", archive: "分镜静帧", group: "image", description: "新人、仪式、场地与隐私边界" },
  { id: "storyboard", label: "分镜静帧", archive: "分镜静帧", group: "storyboard", description: "景别、机位、动作与画面构图" },
  { id: "video", label: "视频提示词", archive: "视频提示词", group: "video", description: "动作、运镜、时长与连续性" },
  { id: "workflow", label: "流程与检查", archive: "制作记录", group: "script", description: "剧本拆解、质检与交付清单" },
];

const PROMPT_SHARED_SKILL_KEYS = new Set(["image_prompt_director", "image_prompt"]);

function promptCategoryOfSkill(skill) {
  const key = skillKeyOf(skill);
  if (key === "wedding_image") return "wedding";
  if (skill?.type === "character" || key === "character_asset") return "character";
  if (skill?.type === "scene" || key === "scene_asset") return "scene";
  if (skill?.type === "prop" || key === "prop_asset") return "prop";
  if (skill?.type === "costume" || key === "costume_asset") return "costume";
  if (skill?.type === "extras" || key === "extras_asset") return "extras";
  if (skill?.type === "storyboard" || key === "storyboard_still") return "storyboard";
  if (skill?.type === "video" || key === "video_prompt" || key.includes("seedance")) return "video";
  if (["workflow", "script", "shotlist"].includes(skill?.type) || ["aigc_pipeline", "script_doctor", "shotlist", "shotlist_builder"].includes(key)) return "workflow";
  return null;
}

function promptCategoryMatches(skill, categoryId) {
  if (PROMPT_SHARED_SKILL_KEYS.has(skillKeyOf(skill))) return ["character", "scene", "prop", "costume", "extras", "wedding", "storyboard"].includes(categoryId);
  return promptCategoryOfSkill(skill) === categoryId;
}

function skillKeyOf(skill) {
  return skill?.templateKey || skill?.key || skill?.id || "";
}

function defaultArchiveLabel(skill) {
  return skill?.assetTypeLabel || TYPE_LABELS[skill?.type] || "制作记录";
}

function sortSkills(skills) {
  return [...skills].sort((a, b) => {
    const aGroup = SKILL_GROUPS.findIndex((group) => group.id === skillGroupOf(a)?.id);
    const bGroup = SKILL_GROUPS.findIndex((group) => group.id === skillGroupOf(b)?.id);
    if (aGroup !== bGroup) return aGroup - bGroup;
    const aRank = SKILL_PRIORITY[skillKeyOf(a)] || 50;
    const bRank = SKILL_PRIORITY[skillKeyOf(b)] || 50;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });
}

function subtitleFileSortKey(file) {
  const name = String(file?.name || file || "").replace(/\.[^.]+$/, "");
  const episode = Number(name.match(/^\s*(\d+)/)?.[1] || Number.MAX_SAFE_INTEGER);
  const numericPart = Number(name.match(/\.(\d+)$/)?.[1] || 0);
  const part = /(?:\.1|上)$/u.test(name) ? 0 : /中$/u.test(name) ? 1 : /(?:\.2|下)$/u.test(name) ? 2 : numericPart || 1;
  return { episode, part, name };
}

function compareSubtitleFiles(a, b) {
  const left = subtitleFileSortKey(a);
  const right = subtitleFileSortKey(b);
  return left.episode - right.episode || left.part - right.part || left.name.localeCompare(right.name, "zh-CN", { numeric: true });
}

function promptFamily(skill) {
  const key = skillKeyOf(skill);
  if (key.includes("seedance") || key.includes("video")) return "video";
  if (key.includes("shotlist")) return "shotlist";
  if (key.includes("pipeline") || key.includes("script")) return "workflow";
  return "image";
}

function detectQuickStages(request, mode) {
  const text = String(request || "").trim();
  const stages = mode === "wedding"
    ? ["婚礼事实校验", "新人与场地提取"]
    : ["内容拆解"];
  if (/人物|角色|主角|演员|新人|新郎|新娘/.test(text)) stages.push("人物资产");
  if (/服装|婚纱|礼服|战袍|发型/.test(text)) stages.push("服装资产");
  if (/场景|室内|室外|雨夜|街道|教堂|宴会厅|海边/.test(text)) stages.push("场景资产");
  if (/道具|戒指|花束|武器|手机|车|酒杯/.test(text)) stages.push("道具资产");
  if (/镜头|分镜|景别|机位|运镜|推拉摇移/.test(text)) stages.push("镜头规划");
  stages.push(mode === "wedding" ? "婚礼画面生成" : "图片生成", "审核与锁版");
  return [...new Set(stages)].slice(0, 6);
}

function buildAssetReferences(approvedAssets) {
  if (!approvedAssets.length) return "暂无已通过资产。若需要保持角色、场景或道具一致，请先上传并审核资产，再把资产名作为引用。";
  return approvedAssets.slice(0, 12).map((asset, index) => {
    const handle = `@资产${String(index + 1).padStart(2, "0")}`;
    return `${handle}｜${asset.typeLabel || asset.type}｜${asset.name}｜${asset.code || asset.id}｜第 ${asset.version || 1} 版｜${asset.notes || "无备注"}`;
  }).join("\n");
}

function buildGptPrompt({ skill, form, request, project, approvedAssets }) {
  const family = promptFamily(skill);
  const archiveCategory = form.archiveCategory || defaultArchiveLabel(skill);
  const aspectRatio = form.aspectRatio || skill?.recommendedRatio || project.aspectRatio || "16:9";
  const assetName = form.assetName?.trim() || `${project.name}-${archiveCategory}`;
  const references = buildAssetReferences(approvedAssets);
  const fullSource = String(skill?.sourceContent || "").trim();
  const sourceLimit = 28000;
  const skillSource = fullSource.length > sourceLimit
    ? `${fullSource.slice(0, sourceLimit)}\n\n[规范原文较长，已在此截取；完整原文需由私有素材库提供。]`
    : fullSource;
  const commonHeader = [
    "你是影视项目资产制作的提示词整理助手。",
    "请只根据我提供的项目资料、已通过资产和本次要求输出，不要补写未提供的剧情、人物关系或示例内容。",
    ...(skillSource ? ["", `【本次使用的制作规范：${skill.name}】`, skillSource] : []),
    "",
    "【项目上下文】",
    `项目名称：${project.name}`,
    `项目类型：${project.type || "未填写"}`,
    `整体风格：${project.style || "未填写"}`,
    `项目画幅：${project.aspectRatio || "未填写"}`,
    `本次归档：${archiveCategory}`,
    `本次名称：${assetName}`,
    `输出画幅：${aspectRatio}`,
    "",
    "【已通过资产引用】",
    references,
    "",
    "【本次真实要求】",
    request.trim(),
  ];

  if (family === "video") {
    return [
      ...commonHeader,
      "",
      "【请输出】",
      `1. 一段中文视频生成提示词，项目等级按 ${form.projectLevel || "A"} 级处理。`,
      "2. 必须写清主体、场景、动作、镜头运动、时长、光线、情绪、连续性要求。",
      "3. 如引用已通过资产，请使用上面的 @资产编号，不要改名。",
      "4. 不要写音乐、字幕、水印、平台标识和无关说明。",
      "5. 控制在 15 秒以内，输出可直接复制到视频生成工具。",
      "",
      "【最终格式】",
      "视频提示词：",
      "负面限制：",
      "引用资产：",
      "归档类别：",
    ].join("\n");
  }

  if (family === "shotlist") {
    return [
      ...commonHeader,
      "",
      "【请输出】",
      "1. 先列出本段需要的人物、场景、道具、服装资产。",
      "2. 再生成镜头表，字段为：镜头号、场景、时长、景别、机位、人物、动作、台词、静帧提示词、视频提示词、绑定资产。",
      "3. 视频提示词必须能被后续视频生成工具理解，镜头之间要保持空间关系和角色连续性。",
      "4. 如果信息不足，在对应字段写“待补充”，不要编造。",
      "",
      "【最终格式】",
      "资产需求清单：",
      "镜头表：",
      "待补充问题：",
    ].join("\n");
  }

  if (family === "workflow") {
    return [
      ...commonHeader,
      "",
      "【请输出】",
      "1. 把需求拆成：剧本检查、资产清单、图片提示词、分镜表、视频提示词、上传归档、审核交付。",
      "2. 每一步都给出可执行字段，不写空泛建议。",
      "3. 明确哪些资产需要先上传回工作台，哪些内容需要经理或管理员确认。",
      "4. 信息不足的位置写“待补充”。",
      "",
      "【最终格式】",
      "制作流程：",
      "资产归档表：",
      "提示词任务：",
      "审核节点：",
      "待补充问题：",
    ].join("\n");
  }

  return [
    ...commonHeader,
    "",
    "【请输出】",
    "1. 一段可直接用于图片生成的中文主提示词。",
    "2. 写清主体、外观、服装、场景、动作、镜头、光线、材质、画幅和风格。",
    "3. 如果是角色或系列资产，要强调一致性和可复用特征。",
    "4. 如引用已通过资产，请使用上面的 @资产编号，不要改名。",
    "5. 单独给出负面提示词，避免错手、错脸、文字、水印、低清、风格跑偏。",
    "",
    "【最终格式】",
    "主提示词：",
    "负面提示词：",
    "引用资产：",
    "归档类别：",
  ].join("\n");
}

export function ProductionWorkspace({
  role,
  viewer,
  data,
  actions,
  refreshWorkspace,
  notify,
  activePage,
  navigate,
  searchOpen,
  setSearchOpen,
}) {
  const { projects, assets, assetFolders = [], imageTasks, shots, weddingWorkflows = [], skillTemplates, productionSpecs, assignments } = data;
  const { setProjects, setAssets, setAssetFiles, setAssetFolders, setImageTasks, setShots, setWeddingWorkflows, setProductionSpecs, setAssignments, setActivityLogs } = actions;
  const [currentProjectId, setCurrentProjectId] = useStoredState(`${STORAGE_KEYS.currentProject}.${role}`, null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [assetFilter, setAssetFilter] = useState("全部");
  const [openFolder, setOpenFolder] = useState(null);
  const [selectedSkillId, setSelectedSkillId] = useState("character_asset");
  const [promptCategoryFilter, setPromptCategoryFilter] = useState("character");
  const [skillGroupFilter, setSkillGroupFilter] = useState("all");
  const [skillSearch, setSkillSearch] = useState("");
  const [skillRequest, setSkillRequest] = useState("");
  const [quickMode, setQuickMode] = useState("image");
  const [quickRequest, setQuickRequest] = useState("");
  const [quickProjectName, setQuickProjectName] = useState("");
  const [quickAssetName, setQuickAssetName] = useState("");
  const [quickCount, setQuickCount] = useState("4");
  const [quickAspectRatio, setQuickAspectRatio] = useState("16:9");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickResult, setQuickResult] = useState(null);
  const [skillResult, setSkillResult] = useState(null);
  const [skillForm, setSkillForm] = useState({
    assetName: "",
    archiveCategory: "人物",
    aspectRatio: "16:9",
    projectLevel: "A",
    batchCount: "4",
  });
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [h3Connection, setH3Connection] = useState({
    endpointUrl: "",
    modelName: "MiniMaxAI/MiniMax-H3",
    status: "待配置",
    lastError: "",
    lastCheckedAt: null,
    hasSessionKey: false,
  });
  const [h3ConnectionBusy, setH3ConnectionBusy] = useState(false);
  const [imageConnection, setImageConnection] = useState({
    endpointUrl: "",
    modelName: "",
    status: "待配置",
    lastError: "",
    lastCheckedAt: null,
    hasSessionKey: false,
  });
  const [imageConnectionBusy, setImageConnectionBusy] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [weddingBusy, setWeddingBusy] = useState(false);
  const [weddingWorkflow, setWeddingWorkflow] = useState(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState("");
  const [premiereSettings, setPremiereSettings] = useStoredState(`${STORAGE_KEYS.premiereSettings}.${role}`, PREMIERE_DEFAULT_SETTINGS);
  const [premiereSubtitle, setPremiereSubtitle] = useStoredState(`${STORAGE_KEYS.premiereSubtitle}.${role}`, { fileName: "", cues: [], sourceProjectId: null, updatedAt: null });
  const [premierePresets, setPremierePresets] = useStoredState(`${STORAGE_KEYS.premierePresets}.${role}`, []);
  const [premiereFontFile, setPremiereFontFile] = useState(null);
  const [premiereTextStyleFile, setPremiereTextStyleFile] = useState(null);
  const [premiereTextStyleMeta, setPremiereTextStyleMeta] = useState(null);
  const [premiereBusy, setPremiereBusy] = useState(false);
  const [subtitleVideoFile, setSubtitleVideoFile] = useState(null);
  const [subtitleVideoUrl, setSubtitleVideoUrl] = useState("");
  const [subtitleVideoFiles, setSubtitleVideoFiles] = useState([]);
  const [subtitleBatchItems, setSubtitleBatchItems] = useState([]);
  const [selectedSubtitleBatchId, setSelectedSubtitleBatchId] = useState(null);
  const [subtitleLanguage, setSubtitleLanguage] = useState("zh");
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const [subtitleRenderBusy, setSubtitleRenderBusy] = useState(false);
  const [subtitleRenderStatus, setSubtitleRenderStatus] = useState("");
  const [subtitleReferenceFiles, setSubtitleReferenceFiles] = useState([]);
  const [subtitleDownload, setSubtitleDownload] = useState(null);
  const [subtitleExportSession, setSubtitleExportSession] = useState(null);
  const [subtitleRenderSummary, setSubtitleRenderSummary] = useState(null);
  const [subtitleImportIssues, setSubtitleImportIssues] = useState([]);

  const canManageScopedProjects = ["developer", "admin"].includes(role);
  const myProjects = viewer ? (canManageScopedProjects ? projects : projects.filter((project) => project.ownerId === viewer.id)) : [];
  const myAssignments = viewer ? assignments.filter((item) => item.assigneeId === viewer.id) : [];
  const currentProject = myProjects.find((project) => project.id === currentProjectId) || myProjects[0] || null;
  const savedWeddingWorkflow = currentProject ? weddingWorkflows.find((item) => item.projectId === currentProject.id) : null;
  const availableSkills = skillTemplates.length ? skillTemplates : SKILLS;
  const visibleSkills = sortSkills(availableSkills);
  const filteredSkills = visibleSkills.filter((skill) => {
    const group = skillGroupOf(skill);
    const matchesGroup = skillGroupFilter === "all" || group.id === skillGroupFilter;
    const matchesPromptCategory = !promptCategoryFilter || promptCategoryMatches(skill, promptCategoryFilter);
    const needle = skillSearch.trim().toLowerCase();
    const matchesSearch = !needle || [skill.name, skill.description, group.name].some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesGroup && matchesPromptCategory && matchesSearch;
  });
  const previewVideoTask = currentProject
    ? imageTasks.find((item) => item.id === selectedTaskId)
      || imageTasks.find((item) => item.projectId === currentProject.id && item.mediaKind === "video")
    : null;

  useEffect(() => {
    setWeddingWorkflow(currentProject ? normalizeWeddingWorkflow(savedWeddingWorkflow, currentProject.id) : null);
  }, [currentProject?.id, savedWeddingWorkflow?.updatedAt]);

  useEffect(() => {
    let active = true;
    apiFetchH3Connection(role)
      .then((payload) => { if (active) setH3Connection(payload.connection); })
      .catch(() => {});
    return () => { active = false; };
  }, [role, viewer?.id]);

  useEffect(() => {
    let active = true;
    apiFetchImageConnection(role)
      .then((payload) => { if (active) setImageConnection(payload.connection); })
      .catch(() => {});
    return () => { active = false; };
  }, [role, viewer?.id]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setVideoObjectUrl("");
    if (previewVideoTask?.mediaKind === "video" && previewVideoTask?.outputUrl) {
      apiLoadGenerationVideo(role, previewVideoTask.id)
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setVideoObjectUrl(objectUrl);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewVideoTask?.id, previewVideoTask?.outputUrl, role]);

  const updateSkillForm = (patch) => setSkillForm((current) => ({ ...current, ...patch }));

  const updatePremiereSettings = (patch) => setPremiereSettings((current) => normalizePremiereSettings({ ...current, ...patch }, currentProject));

  const applyPremiereOrientation = (orientation) => {
    setPremiereSettings((current) => normalizePremiereSettings({
      ...current,
      ...PREMIERE_ORIENTATION_PRESETS[orientation],
      orientation,
    }, currentProject));
  };

  useEffect(() => {
    let active = true;
    const source = String(premiereSettings?.premiereStyleSourceText || "");
    if (!source) {
      setPremiereTextStyleFile(null);
      setPremiereTextStyleMeta(null);
      return () => { active = false; };
    }
    try {
      const fileName = premiereSettings?.premiereStyleSourceFileName || "PR文字样式.prtextstyle";
      const file = new File([source], fileName, { type: "application/xml" });
      const metadata = parsePremiereTextStyle(source, file.name);
      if (active) {
        setPremiereTextStyleFile(file);
        setPremiereTextStyleMeta(metadata);
      }
    } catch {
      if (active) {
        setPremiereTextStyleFile(null);
        setPremiereTextStyleMeta(null);
      }
    }
    return () => { active = false; };
  }, [role, premiereSettings?.premiereStyleSourceText, premiereSettings?.premiereStyleSourceFileName]);

  useEffect(() => {
    const needsFontMigration = premiereSettings && (!premiereSettings.fontWeight || ["PingFang SC", "阿里妈妈方圆体 VF", "Alimama FangYuanTi VF", "Alimama FangYuanTi VF Medium", "AlimamaFangYuanTiVF-Medium", "AlimamaFangYuanTiVF-Medium.ttf"].includes(premiereSettings.fontName));
    const needsReferenceColor = premiereSettings && premiereSettings.textColor === "#000000";
    const needsReferenceStroke = premiereSettings && Number(premiereSettings.strokeWidth) > 0 && Number(premiereSettings.strokeWidth) < 1.8;
    const needsShadowMigration = premiereSettings && (premiereSettings.shadowWidth === undefined || premiereSettings.shadowOpacity === undefined);
    const needsReferenceShadow = premiereSettings && Number(premiereSettings.shadowWidth) === 1.6 && Number(premiereSettings.shadowOpacity) === 75 && String(premiereSettings.shadowColor || "").toUpperCase() === "#000000";
    const isLegacyLandscapeSize = premiereSettings.orientation !== "portrait" && [48, 70].includes(Number(premiereSettings.fontSize));
    const isLegacyPortraitSize = premiereSettings.orientation === "portrait" && Number(premiereSettings.fontSize) === 100;
    const isReferenceLandscapeSize = premiereSettings.orientation !== "portrait" && Number(premiereSettings.fontSize) === 60;
    const isReferencePortraitSize = premiereSettings.orientation === "portrait" && Number(premiereSettings.fontSize) === 90;
    const isLegacyReferenceStyle = premiereSettings && Number(premiereSettings.strokeWidth) === 0.8 && Number(premiereSettings.shadowWidth) === 1 && Number(premiereSettings.shadowOpacity) === 60;
    const needsScaleXMigration = premiereSettings && (premiereSettings.scaleX === undefined || Number(premiereSettings.scaleX) === 92);
    const isLegacyLandscapePosition = premiereSettings.orientation !== "portrait" && Number(premiereSettings.verticalPosition) === 92;
    const isReferenceLandscapePosition = premiereSettings.orientation !== "portrait" && Number(premiereSettings.verticalPosition) === 90;
    const isReferencePortraitPosition = premiereSettings.orientation === "portrait" && Number(premiereSettings.verticalPosition) === 68;
    const orientationPreset = PREMIERE_ORIENTATION_PRESETS[premiereSettings.orientation === "portrait" ? "portrait" : "landscape"];
    const needsOrientationCanvas = premiereSettings && (Number(premiereSettings.width) !== orientationPreset.width || Number(premiereSettings.height) !== orientationPreset.height);
    if (!needsFontMigration && !needsReferenceColor && !needsReferenceStroke && !needsShadowMigration && !needsReferenceShadow && !needsOrientationCanvas && !isLegacyLandscapeSize && !isLegacyPortraitSize && !isReferenceLandscapeSize && !isReferencePortraitSize && !isLegacyLandscapePosition && !isReferenceLandscapePosition && !isReferencePortraitPosition && !isLegacyReferenceStyle && !needsScaleXMigration) return;
    setPremiereSettings((current) => normalizePremiereSettings({
      ...current,
      fontName: PREMIERE_FONT_FAMILY,
      fontWeight: 500,
      textColor: "#ffffff",
      strokeColor: "#000000",
      ...(isLegacyReferenceStyle || needsScaleXMigration ? { scaleX: 98 } : {}),
      ...(needsReferenceStroke ? { strokeWidth: PREMIERE_ORIENTATION_PRESETS[current.orientation === "portrait" ? "portrait" : "landscape"].strokeWidth } : {}),
      ...(isLegacyReferenceStyle || needsShadowMigration || needsReferenceShadow ? { strokeWidth: 1.8, shadowWidth: 2, shadowOpacity: 85, shadowColor: "#000000" } : {}),
      ...(needsOrientationCanvas || isLegacyLandscapeSize || isLegacyPortraitSize ? PREMIERE_ORIENTATION_PRESETS[current.orientation === "portrait" ? "portrait" : "landscape"] : {}),
      ...(isLegacyLandscapePosition ? { verticalPosition: PREMIERE_ORIENTATION_PRESETS.landscape.verticalPosition } : {}),
      ...(isReferenceLandscapeSize ? { fontSize: PREMIERE_ORIENTATION_PRESETS.landscape.fontSize } : {}),
      ...(isReferencePortraitSize ? { fontSize: PREMIERE_ORIENTATION_PRESETS.portrait.fontSize } : {}),
      ...(isReferenceLandscapePosition ? { verticalPosition: PREMIERE_ORIENTATION_PRESETS.landscape.verticalPosition } : {}),
      ...(isReferencePortraitPosition ? { verticalPosition: PREMIERE_ORIENTATION_PRESETS.portrait.verticalPosition } : {}),
    }, currentProject));
  }, [role, premiereSettings?.fontName, premiereSettings?.fontWeight, premiereSettings?.fontSize, premiereSettings?.orientation, premiereSettings?.verticalPosition]);

  useEffect(() => {
    if (premiereSettings?.orientation !== "landscape" || Number(premiereSettings.fontSize) !== 70) return;
    setPremiereSettings((current) => normalizePremiereSettings({ ...current, ...PREMIERE_ORIENTATION_PRESETS.landscape }, currentProject));
  }, [role, premiereSettings?.orientation, premiereSettings?.fontSize]);

  useEffect(() => () => {
    if (subtitleDownload?.url) URL.revokeObjectURL(subtitleDownload.url);
  }, [subtitleDownload?.url]);

  const selectPromptCategory = (categoryId) => {
    const category = PROMPT_CATEGORY_OPTIONS.find((item) => item.id === categoryId) || PROMPT_CATEGORY_OPTIONS[0];
    setPromptCategoryFilter(category.id);
    setSkillGroupFilter("all");
    const categorySkill = visibleSkills.find((skill) => promptCategoryOfSkill(skill) === category.id)
      || visibleSkills.find((skill) => PROMPT_SHARED_SKILL_KEYS.has(skillKeyOf(skill)));
    if (categorySkill) setSelectedSkillId(categorySkill.id || categorySkill.key || categorySkill.templateKey);
    updateSkillForm({ archiveCategory: category.archive, aspectRatio: categorySkill?.recommendedRatio || currentProject?.aspectRatio || "16:9" });
    setSkillResult(null);
  };

  const recordActivity = (action, target, status = "已完成") => {
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    setActivityLogs((items) => [{
      id: `log-${now.getTime()}`,
      userId: viewer?.id || "user-unknown",
      user: viewer?.name || "未登录用户",
      action,
      target,
      project: currentProject?.name || "未选择项目",
      status,
      time,
    }, ...items].slice(0, 120));
  };

  const createProject = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const project = {
      name: form.get("name") || "未命名项目",
      type: form.get("type") || "短剧",
      aspectRatio: form.get("aspectRatio") || "16:9",
      style: form.get("style") || "写实电影感",
      description: form.get("description") || "",
      stage: "项目筹备",
      progress: 0,
      cover: null,
      ownerId: viewer.id,
      organizationId: viewer.organizationId || null,
    };
    try {
      const saved = await apiCreateProject(role, project);
      setProjects((items) => [saved.project, ...items]);
      setCurrentProjectId(saved.project.id);
      setModal(null);
      await refreshWorkspace();
      notify(`项目「${saved.project.name}」已创建`);
    } catch (error) {
      notify(error.message || "项目保存失败");
    }
  };

  const projectModalNode = modal?.type === "project" && (
    <Modal title="新建项目" eyebrow="项目" onClose={() => setModal(null)}>
      <form className="form-grid" onSubmit={createProject}>
        <Field label="项目名称"><input name="name" required placeholder="请输入项目名称" /></Field>
        <Field label="项目类型"><select name="type"><option>婚礼微电影</option><option>婚礼快剪</option><option>短剧</option><option>广告</option><option>音乐短片</option><option>动画</option><option>科幻</option><option>玄幻</option></select></Field>
        <Field label="画幅"><select name="aspectRatio"><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option></select></Field>
        <Field label="项目风格"><input name="style" required placeholder="请输入项目风格" /></Field>
        <Field label="项目备注" full><textarea name="description" placeholder="项目背景与制作要求" /></Field>
        <AppButton variant="primary" className="field-full" type="submit">创建项目 <ArrowRight size={14} /></AppButton>
      </form>
    </Modal>
  );

  const updatePersonalAssignment = async (assignmentId, status) => {
    const assignment = myAssignments.find((item) => item.id === assignmentId);
    try {
      const saved = await apiUpdateAssignment(role, assignmentId, { status });
      setAssignments((items) => items.map((item) => item.id === assignmentId ? saved.assignment : item));
      await refreshWorkspace();
      notify(status === "进行中" ? "任务已接受" : "任务已标记完成");
    } catch (error) {
      notify(error.message || `任务「${assignment?.title || "未命名"}」状态更新失败`);
    }
  };

  const personalAssignmentsNode = (
    <>
      <PageHeader eyebrow="个人待办" title="我的任务" description="查看分配给你的任务，并更新接受和完成状态。"><StatusPill status="待审核">{myAssignments.filter((item) => item.status !== "已完成").length} 项待办</StatusPill></PageHeader>
      <section className="panel personal-task-table">
        <div className="personal-task-head"><span>任务</span><span>分配人</span><span>截止时间</span><span>优先级</span><span>状态</span><span>操作</span></div>
        {myAssignments.length ? myAssignments.map((item) => <div className="personal-task-row" key={item.id}><span><strong>{item.title}</strong><small>{item.description || "无补充说明"}</small></span><span>{item.managerName}</span><span>{item.dueDate}</span><span>{item.priority}</span><StatusPill status={item.status} /><span>{item.status === "待接受" ? <AppButton variant="primary" onClick={() => updatePersonalAssignment(item.id, "进行中")}>接受任务</AppButton> : item.status === "进行中" ? <AppButton variant="primary" onClick={() => updatePersonalAssignment(item.id, "已完成")}>标记完成</AppButton> : <small>已完成</small>}</span></div>) : <div className="collection-empty"><ClipboardText size={24} /><h3>暂无个人任务</h3><p>任务分配后会显示在这里。</p></div>}
      </section>
    </>
  );

  const saveH3Connection = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setH3ConnectionBusy(true);
    try {
      const saved = await apiUpdateH3Connection(role, {
        endpointUrl: form.get("endpointUrl"),
        modelName: form.get("modelName"),
        apiKey: form.get("apiKey"),
        clearKey: form.get("clearKey") === "on",
      });
      setH3Connection(saved.connection);
      notify(saved.ok ? "云显卡连接检测通过" : saved.connection.lastError || "云显卡连接检测失败");
    } catch (error) {
      notify(error.message || "云显卡连接保存失败");
    } finally {
      setH3ConnectionBusy(false);
    }
  };

  const h3ConnectionNode = (
    <>
      <PageHeader eyebrow="视频服务" title="H3 云显卡连接" description="连接已经部署在云显卡上的 SGLang 服务。应用会提交真实视频任务、同步状态，并把完成的有声视频保存到本机。">
        <StatusPill status={h3Connection.status} />
      </PageHeader>
      <section className="h3-connection-layout">
        <form className="panel h3-connection-form" key={`${h3Connection.endpointUrl}-${h3Connection.lastCheckedAt || "new"}`} onSubmit={saveH3Connection}>
          <div className="panel-heading"><div><span className="eyebrow">连接参数</span><h2>SGLang 视频接口</h2></div><div className="feature-icon"><CloudArrowUp size={21} /></div></div>
          <div className="form-grid">
            <Field label="云显卡服务地址" full><input name="endpointUrl" type="url" required defaultValue={h3Connection.endpointUrl} placeholder="例如 https://你的云显卡地址" /></Field>
            <Field label="模型标识" full><input name="modelName" required defaultValue={h3Connection.modelName || "MiniMaxAI/MiniMax-H3"} /></Field>
            <Field label="本次访问密钥" full><input name="apiKey" type="password" autoComplete="off" placeholder={h3Connection.hasSessionKey ? "已在本次运行中保存；留空表示继续使用" : "接口免密时可留空"} /></Field>
            <label className="h3-clear-key field-full"><input name="clearKey" type="checkbox" /><span>清除本次运行中已经保存的访问密钥</span></label>
            <p className="field-help field-full">服务地址和模型标识会保存；访问密钥不会写入数据库，退出应用后自动清除。接口应提供 <code>/health</code> 或 <code>/v1/models</code>，视频任务使用 <code>/v1/videos</code>。</p>
            <AppButton variant="primary" className="field-full" type="submit" disabled={h3ConnectionBusy}>{h3ConnectionBusy ? "正在检测连接" : "保存并检测连接"}</AppButton>
          </div>
        </form>
        <article className="panel h3-connection-status">
          <div className="panel-heading"><div><span className="eyebrow">当前状态</span><h2>{h3Connection.status}</h2></div><StatusPill status={h3Connection.status} /></div>
          <dl>
            <div><dt>服务地址</dt><dd>{h3Connection.endpointUrl || "尚未填写"}</dd></div>
            <div><dt>模型</dt><dd>{h3Connection.modelName || "尚未填写"}</dd></div>
            <div><dt>访问密钥</dt><dd>{h3Connection.hasSessionKey ? "本次运行已保存" : "未填写或接口免密"}</dd></div>
            <div><dt>最近检测</dt><dd>{h3Connection.lastCheckedAt ? new Date(h3Connection.lastCheckedAt).toLocaleString("zh-CN") : "尚未检测"}</dd></div>
          </dl>
          {h3Connection.lastError && <div className="h3-connection-error"><strong>连接信息</strong><p>{h3Connection.lastError}</p></div>}
          <div className="h3-capability-list"><span><Check size={13} /> 文本生成有声视频</span><span><Check size={13} /> 4–15 秒</span><span><Check size={13} /> 768 短边输出</span><span><Check size={13} /> 异步任务与本地成片</span></div>
          <div className="h3-deployment-guide"><div><span className="eyebrow">云端部署建议</span><h3>先租一台 4 卡同机服务器</h3></div><dl><div><dt>稳定生产</dt><dd>4 × H100 80GB</dd></div><div><dt>省预算备选</dt><dd>4 × A100 80GB</dd></div><div><dt>服务方式</dt><dd>SGLang · FL2VA / T2VA · 768p</dd></div><div><dt>连接要求</dt><dd>公网 HTTPS + /v1/videos</dd></div></dl><p>不要租单张 24GB / 48GB 卡直接跑官方 BF16 方案。部署好后，把 HTTPS 地址和模型标识填到左侧；密钥只在本次运行内保存。</p></div>
        </article>
      </section>
    </>
  );

  const saveImageConnection = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setImageConnectionBusy(true);
    try {
      const saved = await apiUpdateImageConnection(role, {
        endpointUrl: form.get("endpointUrl"),
        modelName: form.get("modelName"),
        apiKey: form.get("apiKey"),
        clearKey: form.get("clearKey") === "on",
      });
      setImageConnection(saved.connection);
      notify(saved.ok ? "生图服务连接检测通过" : saved.connection.lastError || "生图服务连接检测失败");
    } catch (error) {
      notify(error.message || "生图服务保存失败");
    } finally {
      setImageConnectionBusy(false);
    }
  };

  const imageConnectionNode = (
    <>
      <PageHeader eyebrow="图片服务" title="生图服务连接" description="接入支持 OpenAI 兼容接口的云端或本地生图服务。应用只保存地址和模型标识，访问密钥仅保存在本次运行内存中。">
        <StatusPill status={imageConnection.status} />
      </PageHeader>
      <section className="h3-connection-layout">
        <form className="panel h3-connection-form" key={`${imageConnection.endpointUrl}-${imageConnection.lastCheckedAt || "new"}`} onSubmit={saveImageConnection}>
          <div className="panel-heading"><div><span className="eyebrow">连接参数</span><h2>图片生成接口</h2></div><div className="feature-icon"><CloudArrowUp size={21} /></div></div>
          <div className="form-grid">
            <Field label="生图服务地址" full><input name="endpointUrl" type="url" required defaultValue={imageConnection.endpointUrl} placeholder="例如 https://你的服务地址" /></Field>
            <Field label="图片模型标识" full><input name="modelName" required defaultValue={imageConnection.modelName} placeholder="例如 gpt-image-2.5-sunburst" /></Field>
            <Field label="本次访问密钥" full><input name="apiKey" type="password" autoComplete="off" placeholder={imageConnection.hasSessionKey ? "已在本次运行中保存；留空表示继续使用" : "接口免密时可留空"} /></Field>
            <label className="h3-clear-key field-full"><input name="clearKey" type="checkbox" /><span>清除本次运行中已经保存的访问密钥</span></label>
            <p className="field-help field-full">OpenAI 直连接口请填写 <code>https://api.openai.com</code>，模型填写 <code>gpt-image-2.5-sunburst</code> 或 <code>gpt-image-2.5-flare</code>；其他服务需要提供 <code>POST /v1/images/generations</code>，返回 `data` 数组中的 `b64_json` 或 `url`。</p>
            <AppButton variant="primary" className="field-full" type="submit" disabled={imageConnectionBusy}>{imageConnectionBusy ? "正在检测连接" : "保存并检测连接"}</AppButton>
          </div>
        </form>
        <article className="panel h3-connection-status">
          <div className="panel-heading"><div><span className="eyebrow">当前状态</span><h2>{imageConnection.status}</h2></div><StatusPill status={imageConnection.status} /></div>
          <dl>
            <div><dt>服务地址</dt><dd>{imageConnection.endpointUrl || "尚未填写"}</dd></div>
            <div><dt>模型</dt><dd>{imageConnection.modelName || "尚未填写"}</dd></div>
            <div><dt>访问密钥</dt><dd>{imageConnection.hasSessionKey ? "本次运行已保存" : "未填写或接口免密"}</dd></div>
            <div><dt>最近检测</dt><dd>{imageConnection.lastCheckedAt ? new Date(imageConnection.lastCheckedAt).toLocaleString("zh-CN") : "尚未检测"}</dd></div>
          </dl>
          {imageConnection.lastError && <div className="h3-connection-error"><strong>连接信息</strong><p>{imageConnection.lastError}</p></div>}
          <div className="h3-capability-list"><span><Check size={13} /> 一次生成最多 8 张</span><span><Check size={13} /> 四图审核与重生</span><span><Check size={13} /> 图片下载到本机</span><span><Check size={13} /> 规范抽取后再生成</span></div>
        </article>
      </section>
    </>
  );

  if (activePage === "my-work") {
    return <>{personalAssignmentsNode}{projectModalNode}</>;
  }

  if (activePage === "h3") return h3ConnectionNode;

  if (activePage === "image-service") return imageConnectionNode;

  if (!currentProject && activePage !== "projects") {
    return (
      <>
        <main className="content-empty-projects">
          <div className="feature-icon"><SquaresFour size={22} /></div>
          <h2>还没有自己的项目</h2>
          <p>创建第一个项目后，即可使用制作工作台、制作规范、资产库、生图队列、分镜和导出。</p>
          <AppButton variant="primary" onClick={() => setModal({ type: "project" })}><Plus size={15} /> 新建项目</AppButton>
        </main>
        {projectModalNode}
      </>
    );
  }

  const projectAssets = currentProject ? assets.filter((asset) => asset.projectId === currentProject.id) : [];
  const projectAssetFolderNames = currentProject ? [...new Set([
    ...assetFolders.filter((folder) => folder.projectId === currentProject.id).map((folder) => folder.name),
    ...projectAssets.map((asset) => asset.typeLabel).filter(Boolean),
  ])] : [];
  const projectTasks = currentProject ? imageTasks.filter((task) => task.projectId === currentProject.id) : [];
  const projectShots = currentProject ? shots.filter((shot) => shot.projectId === currentProject.id) : [];
  const projectSpecs = currentProject ? productionSpecs.filter((spec) => spec.projectId === currentProject.id) : [];
  const approvedAssets = projectAssets.filter((asset) => asset.status === "已通过");
  const selectedTask = projectTasks.find((task) => task.id === selectedTaskId) || projectTasks[0];
  const selectedSkill = visibleSkills.find((skill) => skill.id === selectedSkillId || skill.key === selectedSkillId || skill.templateKey === selectedSkillId) || visibleSkills[0] || SKILLS[0];

  const updateTask = (taskId, updater) => {
    setImageTasks((items) => items.map((item) => item.id === taskId ? updater(item) : item));
  };

  const chooseResult = (taskId, resultId) => {
    updateTask(taskId, (task) => ({ ...task, selectedResultId: resultId }));
  };

  const approveResult = async () => {
    if (!selectedTask?.selectedResultId) return notify("请先从 4 张草图中选择一张");
    const result = selectedTask.results.find((item) => item.id === selectedTask.selectedResultId);
    try {
      const saved = await apiApproveImageTask(role, selectedTask.id, result.id);
      updateTask(selectedTask.id, () => saved.imageTask);
      if (saved.asset) setAssets((items) => items.map((asset) => asset.id === saved.asset.id ? saved.asset : asset));
      await refreshWorkspace();
      recordActivity("通过并锁版", `${selectedTask.name} · ${result.label}`, "已通过");
      notify("草图已通过，资产已锁定");
    } catch (error) {
      notify(error.message || "图片审核保存失败");
    }
  };

  const discardResult = () => {
    if (!selectedTask?.selectedResultId) return notify("请先选择要废弃的草图");
    updateTask(selectedTask.id, (task) => {
      const discarded = Array.from(new Set([...task.discardedResultIds, task.selectedResultId]));
      return { ...task, selectedResultId: null, discardedResultIds: discarded, status: discarded.length === task.results.length ? "已废弃" : "待审核" };
    });
    recordActivity("废弃审核结果", selectedTask.name, "已完成");
    notify("所选草图已废弃，其他结果仍可审核");
  };

  const redoTask = async (taskId = selectedTask?.id) => {
    if (!taskId) return;
    try {
      const saved = await apiRetryImageTask(role, taskId);
      updateTask(taskId, () => saved.imageTask);
      await refreshWorkspace();
      notify(saved.imageTask.status === "待接入" ? "任务已保存，等待生成服务配置" : "任务已重新加入后台队列");
    } catch (error) {
      notify(error.message || "任务重试失败");
    }
  };

  const finalizeHD = () => {
    if (!selectedTask?.selectedResultId) return notify("先选择一张草图，再进行高清定稿");
    const result = selectedTask.results.find((item) => item.id === selectedTask.selectedResultId);
    updateTask(selectedTask.id, (task) => ({ ...task, status: "高清定稿", progress: 100 }));
    recordActivity("提交高清定稿", `${selectedTask.name} · ${result.label}`, "生成中");
    setModal({ type: "hd", result, task: selectedTask });
    window.setTimeout(() => updateTask(selectedTask.id, (task) => ({ ...task, status: "已完成" })), 1200);
  };

  const runSkill = () => {
    if (!skillRequest.trim()) return notify("请先输入本次具体需求");
    const archiveCategory = skillForm.archiveCategory || defaultArchiveLabel(selectedSkill);
    const type = ASSET_TYPE_BY_LABEL[archiveCategory] || selectedSkill.type || "workflow";
    const aspectRatio = skillForm.aspectRatio || selectedSkill.recommendedRatio || currentProject.aspectRatio;
    const assetName = skillForm.assetName.trim() || `${currentProject.name}-${archiveCategory}`;
    const prompt = buildGptPrompt({
      skill: selectedSkill,
      form: { ...skillForm, archiveCategory, aspectRatio, assetName },
      request: skillRequest,
      project: currentProject,
      approvedAssets,
    });
    setSkillResult({
      templateId: selectedSkill.id,
      templateVersion: selectedSkill.version || 1,
      name: assetName,
      skillName: selectedSkill.name,
      type: archiveCategory,
      typeValue: type,
      aspectRatio,
      prompt,
      notes: `制作规范：${selectedSkill.name}；归档类别：${archiveCategory}；所属项目：${currentProject.name}；画幅：${aspectRatio}。`,
      checklist: selectedSkill.checklist?.length ? selectedSkill.checklist : ["可复制到外部生成工具", "生成资产后上传回资产库", "后台可按类别查看"],
    });
    notify("生成工具投喂稿已生成");
  };

  const runImageWorkflow = async () => {
    if (!skillRequest.trim()) return notify("请先输入本次具体需求");
    setWorkflowBusy(true);
    const archiveCategory = skillForm.archiveCategory || defaultArchiveLabel(selectedSkill);
    const aspectRatio = skillForm.aspectRatio || selectedSkill.recommendedRatio || currentProject.aspectRatio;
    const assetName = skillForm.assetName.trim() || `${currentProject.name}-${archiveCategory}`;
    try {
      const saved = await apiCreateImageWorkflow(role, {
        projectId: currentProject.id,
        templateId: selectedSkill.id,
        assetName,
        archiveCategory,
        aspectRatio,
        count: Number(skillForm.batchCount) || 4,
        request: skillRequest,
      });
      const first = saved.workflow.variants[0];
      setSkillResult({
        templateId: selectedSkill.id,
        name: assetName,
        skillName: selectedSkill.name,
        type: archiveCategory,
        typeValue: selectedSkill.type || "image",
        aspectRatio,
        prompt: first.prompt,
        negativePrompt: first.negativePrompt,
        extraction: first.extraction,
        variants: saved.workflow.variants,
        imageTasks: saved.imageTasks,
        checklist: selectedSkill.checklist?.length ? selectedSkill.checklist : ["已从规范抽取结构", "已保存到生图队列", "可在队列中重生"],
      });
      await refreshWorkspace();
      const generated = saved.imageTasks.reduce((total, task) => total + task.results.length, 0);
      notify(generated ? `已生成 ${generated} 张图片，可进入队列审核` : "提示词已抽取，任务已入队；请先配置生图服务或稍后重试");
    } catch (error) {
      notify(error.message || "图片工作流创建失败");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const runQuickGenerate = async (event) => {
    event?.preventDefault();
    if (!quickRequest.trim()) return notify("先粘贴剧本或写一句画面要求");
    setQuickBusy(true);
    const templateKey = quickMode === "wedding" ? "wedding_image" : "image_prompt_director";
    const template = visibleSkills.find((item) => skillKeyOf(item) === templateKey) || visibleSkills[0] || SKILLS[0];
    const projectType = quickMode === "wedding" ? "婚礼微电影" : "短剧";
    const archiveCategory = quickMode === "wedding" ? "分镜静帧" : "图片";
    let project = currentProject;
    try {
      if (!project) {
        const name = quickProjectName.trim() || `${projectType}-${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}`;
        const created = await apiCreateProject(role, {
          name,
          type: projectType,
          aspectRatio: quickAspectRatio,
          style: quickMode === "wedding" ? "温暖电影感" : "写实电影感",
          description: "通过快速生成入口创建的项目",
          stage: "项目筹备",
          progress: 0,
          cover: null,
          ownerId: viewer.id,
          organizationId: viewer.organizationId || null,
        });
        project = created.project;
        setProjects((items) => [project, ...items]);
        setCurrentProjectId(project.id);
      }
      const assetName = quickAssetName.trim() || `${project.name}-${archiveCategory}`;
      const saved = await apiCreateImageWorkflow(role, {
        projectId: project.id,
        templateId: template.id,
        assetName,
        archiveCategory,
        aspectRatio: quickAspectRatio || project.aspectRatio || "16:9",
        count: Number(quickCount) || 4,
        request: quickRequest,
      });
      const first = saved.workflow.variants[0];
      setQuickResult({
        projectName: project.name,
        assetName,
        skillName: template.name,
        extraction: first.extraction,
        prompt: first.prompt,
        imageTasks: saved.imageTasks,
      });
      await refreshWorkspace();
      const generated = saved.imageTasks.reduce((total, task) => total + task.results.length, 0);
      notify(generated ? `已送入队列，当前已返回 ${generated} 张` : "已送入生成队列");
    } catch (error) {
      notify(error.message || "快速生成失败");
    } finally {
      setQuickBusy(false);
    }
  };

  const renderQuick = () => {
    const quickStages = detectQuickStages(quickRequest, quickMode);
    return (
      <>
      <PageHeader eyebrow="快速入口" title="一键生成图片" description="把剧本或一句画面要求放进来，系统自动选择规范、创建任务并送入生图队列。复杂制作再进入高级工作流。">
        <StatusPill status={imageConnection.status}>{imageConnection.status === "已连接" ? "图片服务已连接" : "先配置图片服务"}</StatusPill>
      </PageHeader>
      <section className="quick-generate-layout">
        <form className="panel quick-generate-form" onSubmit={runQuickGenerate}>
          <div className="quick-form-heading"><div><span className="eyebrow">只做三件事</span><h2>输入内容，直接生成</h2><p>{currentProject ? `当前项目：${currentProject.name}` : "还没有项目，第一次生成时会自动创建"}</p></div><div className="feature-icon"><ImageSquare size={22} /></div></div>
          {!currentProject && <Field label="项目名称"><input value={quickProjectName} onChange={(event) => setQuickProjectName(event.target.value)} placeholder="例如：焚决第一集 / 婚礼微电影" /></Field>}
          <div className="quick-mode-switch" role="tablist" aria-label="生成类型">
            <button type="button" className={quickMode === "image" ? "active" : ""} onClick={() => setQuickMode("image")}><strong>普通生图</strong><span>人物、服装、场景、道具</span></button>
            <button type="button" className={quickMode === "wedding" ? "active" : ""} onClick={() => setQuickMode("wedding")}><strong>婚礼生图</strong><span>新人、仪式、婚礼故事</span></button>
          </div>
          <Field label="剧本 / 画面要求" full><textarea autoFocus value={quickRequest} onChange={(event) => setQuickRequest(event.target.value)} placeholder={quickMode === "wedding" ? "直接粘贴新人故事、婚期、婚礼场景和画面要求" : "直接粘贴剧本，或写一句：雨夜巷子里，男主受伤回头，电影感写实"} /></Field>
          <div className="quick-detected-flow"><div><span className="eyebrow">本次会处理</span><p>根据你输入的内容预览生产顺序，实际结果仍以审核后的项目资料为准。</p></div><div className="quick-detected-chips">{quickStages.map((stage, index) => <span key={stage}><b>{String(index + 1).padStart(2, "0")}</b>{stage}</span>)}</div></div>
          <div className="quick-options-grid">
            <Field label="批量数量（每次 1 张）"><select value={quickCount} onChange={(event) => setQuickCount(event.target.value)}>{[1, 2, 4, 6, 8].map((item) => <option value={item} key={item}>{item} 张</option>)}</select></Field>
            <Field label="画幅"><select value={quickAspectRatio} onChange={(event) => setQuickAspectRatio(event.target.value)}>{ASPECT_RATIO_OPTIONS.map((item) => <option value={item} key={item}>{item}</option>)}</select></Field>
            <Field label="本次名称"><input value={quickAssetName} onChange={(event) => setQuickAssetName(event.target.value)} placeholder="可留空自动命名" /></Field>
          </div>
          <details className="quick-advanced"><summary>高级设置</summary><p>系统会自动使用“{quickMode === "wedding" ? "婚礼影像生图规范" : "图片提示词导演"}”，并把结果送入队列。需要查看规范原文、资产引用或视频提示词时，再进入完整制作台。</p><button type="button" onClick={() => navigate("skills")}>打开完整制作规范</button></details>
          <div className="quick-generate-footer"><span>不会自动编造剧本之外的人物和经历</span><AppButton variant="primary" type="submit" disabled={quickBusy}>{quickBusy ? "正在整理并生成…" : `开始生成 ${quickCount} 张`}</AppButton></div>
        </form>
        <aside className="panel quick-generate-side">
          <div className="eyebrow">生成后</div>
          <h2>只需要审核和重做</h2>
          <ol className="quick-steps"><li><b>01</b><span><strong>自动拆解</strong><small>提取人物、服装、场景、动作</small></span></li><li><b>02</b><span><strong>进入队列</strong><small>每次生成一张，批量连续处理</small></span></li><li><b>03</b><span><strong>选图锁版</strong><small>满意就通过，不满意就重做</small></span></li></ol>
          {quickResult ? <div className="quick-result"><StatusPill status="待审核">已送入生成队列</StatusPill><strong>{quickResult.assetName}</strong><span>{quickResult.skillName} · {quickResult.imageTasks.length} 个任务</span>{quickResult.extraction && <details><summary>查看自动提取</summary><p>{Object.entries(quickResult.extraction).map(([label, items]) => `${label}：${items.join("；")}`).join(" ｜ ")}</p></details>}<AppButton variant="secondary" onClick={() => navigate("queue")}>打开生成队列 <ArrowRight size={14} /></AppButton></div> : <div className="quick-side-empty"><ImageSquare size={20} /><p>生成后，这里会显示本次任务和自动提取结果。</p></div>}
        </aside>
      </section>
      </>
    );
  };

  const weddingDraft = currentProject
    ? (weddingWorkflow || normalizeWeddingWorkflow(EMPTY_WEDDING_WORKFLOW, currentProject.id))
    : null;
  const weddingCurrentStep = weddingDraft ? WEDDING_STEPS.find((step) => step.id === weddingDraft.currentStep) || WEDDING_STEPS[0] : WEDDING_STEPS[0];

  const updateWeddingDraft = (patch) => {
    if (!currentProject || !weddingDraft) return;
    setWeddingWorkflow(normalizeWeddingWorkflow({ ...weddingDraft, ...patch }, currentProject.id));
  };

  const saveWeddingDraft = async (nextWorkflow = weddingDraft, message = "婚礼制作资料已保存") => {
    if (!currentProject || !nextWorkflow) return;
    const normalized = normalizeWeddingWorkflow(nextWorkflow, currentProject.id);
    setWeddingWorkflow(normalized);
    setWeddingWorkflows((items) => [normalized, ...items.filter((item) => item.projectId !== currentProject.id)]);
    setWeddingBusy(true);
    try {
      const saved = await apiSaveWeddingWorkflow(role, normalized);
      const savedWorkflow = normalizeWeddingWorkflow(saved.weddingWorkflow, currentProject.id);
      setWeddingWorkflow(savedWorkflow);
      setWeddingWorkflows((items) => [savedWorkflow, ...items.filter((item) => item.projectId !== currentProject.id)]);
      await refreshWorkspace();
      if (message) notify(message);
    } catch (error) {
      notify(error.message || "婚礼制作资料保存失败");
    } finally {
      setWeddingBusy(false);
    }
  };

  const updateWeddingStory = (field, value) => {
    if (!weddingDraft) return;
    updateWeddingDraft({ story: { ...weddingDraft.story, [field]: value } });
  };

  const canConfirmWeddingStep = (stepId) => {
    if (stepId === 1) {
      const story = weddingDraft?.story || {};
      return [story.coupleNames, story.relationship, story.importantMoments].some((value) => String(value || "").trim());
    }
    if ([7, 8].includes(stepId)) return (weddingDraft?.imageTaskIds || []).length > 0 || String(weddingDraft?.notes?.[stepId] || "").trim();
    return true;
  };

  const confirmWeddingStep = async () => {
    if (!weddingDraft) return;
    if (!canConfirmWeddingStep(weddingCurrentStep.id)) return notify(weddingCurrentStep.id === 1 ? "请先填写新人故事的至少一项关键信息" : "请先保存本步材料，或把图片任务送入生图队列");
    const completed = new Set(weddingDraft.completedSteps || []);
    completed.add(weddingCurrentStep.id);
    const nextStep = Math.min(WEDDING_STEPS.length, weddingCurrentStep.id + 1);
    await saveWeddingDraft({
      ...weddingDraft,
      currentStep: nextStep,
      completedSteps: [...completed].sort((a, b) => a - b),
      status: completed.size === WEDDING_STEPS.length ? "已完成" : "进行中",
    }, weddingCurrentStep.id === WEDDING_STEPS.length ? "婚礼制作流程已完成" : `第 ${weddingCurrentStep.id} 步已确认，已进入第 ${nextStep} 步`);
  };

  const buildWeddingImageRequest = () => {
    const story = weddingDraft?.story || {};
    const storyLines = [
      ["新人", story.coupleNames],
      ["婚期", story.weddingDate],
      ["相识与经历", story.relationship],
      ["重要片段", story.importantMoments],
      ["家人与朋友", story.familyAndFriends],
      ["风格方向", story.preferredStyle || currentProject?.style],
      ["目标时长", story.targetDuration],
      ["必须保留", story.mustKeep],
      ["明确避开", story.mustAvoid],
    ].filter(([, value]) => String(value || "").trim()).map(([label, value]) => `${label}：${value}`);
    const stepNote = String(weddingDraft?.notes?.[weddingCurrentStep.id] || "").trim();
    return [
      "【婚礼真实资料】",
      ...storyLines,
      "",
      `【本步镜头要求｜${weddingCurrentStep.title}】`,
      stepNote || "请根据已经确认的婚礼资料，整理本批分镜静帧要求。",
      "",
      "【制作边界】",
      "只使用上面已填写和已确认的事实，不新增未提供的经历、人物关系、地点或道具；人物外观、服装和画面风格要保持跨镜头一致。",
    ].join("\n");
  };

  const runWeddingImageWorkflow = async () => {
    if (!currentProject || !weddingDraft) return;
    const imageSkill = visibleSkills.find((skill) => skillKeyOf(skill) === "wedding_image")
      || visibleSkills.find((skill) => skillKeyOf(skill) === "image_prompt_director")
      || visibleSkills.find((skill) => skill.type === "image");
    if (!imageSkill) return notify("当前没有可用的图片制作规范");
    setWeddingBusy(true);
    try {
      const saved = await apiCreateImageWorkflow(role, {
        projectId: currentProject.id,
        templateId: imageSkill.id,
        assetName: `${currentProject.name}-${weddingCurrentStep.shortTitle}`,
        archiveCategory: "分镜静帧",
        aspectRatio: currentProject.aspectRatio || "16:9",
        count: weddingCurrentStep.id === 7 ? 3 : 4,
        request: buildWeddingImageRequest(),
      });
      const taskIds = saved.imageTasks.map((task) => task.id);
      const next = normalizeWeddingWorkflow({
        ...weddingDraft,
        imageTaskIds: [...new Set([...(weddingDraft.imageTaskIds || []), ...taskIds])],
        notes: { ...weddingDraft.notes, [weddingCurrentStep.id]: `${weddingDraft.notes?.[weddingCurrentStep.id] || ""}\n已送入现有生图队列：${taskIds.join("、")}`.trim() },
      }, currentProject.id);
      await saveWeddingDraft(next, `已把婚礼${weddingCurrentStep.shortTitle}任务送入生图队列`);
      setSelectedTaskId(taskIds[0] || null);
      await refreshWorkspace();
    } catch (error) {
      notify(error.message || "婚礼图片任务创建失败");
    } finally {
      setWeddingBusy(false);
    }
  };

  const saveSkillAsset = async () => {
    if (!skillResult) return;
    try {
      const saved = await apiCreateProductionSpec(role, {
        projectId: currentProject.id,
        templateId: skillResult.templateId,
        title: skillResult.name,
        type: skillResult.typeValue,
        assetTypeLabel: skillResult.type,
        content: skillResult.prompt,
        notes: skillResult.notes,
        status: "待确认",
        createAsset: true,
      });
      if (saved.asset) setAssets((items) => [saved.asset, ...items]);
      setProductionSpecs((items) => [saved.productionSpec, ...items]);
      setSkillResult(null);
      setSkillRequest("");
      setSkillForm((current) => ({ ...current, assetName: "" }));
      await refreshWorkspace();
      notify("投喂稿已入库并保存到资产库");
    } catch (error) {
      notify(error.message || "制作要求保存失败");
    }
  };

  const createAsset = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = form.get("type");
    const asset = {
      projectId: currentProject.id,
      type,
      typeLabel: form.get("folderName") || TYPE_LABELS[type],
      name: form.get("name"),
      code: `资产${String(projectAssets.length + 1).padStart(3, "0")}`,
      version: 1,
      status: "待生成",
      prompt: form.get("prompt"),
      notes: form.get("notes"),
      filename: `${currentProject.name}_${form.get("folderName") || TYPE_LABELS[type]}_${Date.now()}_第1版_待生成.png`,
    };
    try {
      const saved = await apiCreateAsset(role, asset);
      setAssets((items) => [saved.asset, ...items]);
      setModal(null);
      await refreshWorkspace();
      notify("资产已创建，可加入生图队列");
    } catch (error) {
      notify(error.message || "资产保存失败");
    }
  };

  const createFolder = async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    try {
      const saved = await apiCreateAssetFolder(role, { projectId: currentProject.id, name });
      setAssetFolders((items) => items.some((item) => item.id === saved.folder.id) ? items : [...items, saved.folder]);
      setModal(null);
      await refreshWorkspace();
      notify(`文件夹「${name}」已创建`);
    } catch (error) {
      notify(error.message || "文件夹创建失败");
    }
  };

  const initializeWorkflowFolders = async () => {
    const existing = new Set(assetFolders.filter((folder) => folder.projectId === currentProject.id).map((folder) => folder.name));
    const missing = STANDARD_WORKFLOW_FOLDERS.filter((name) => !existing.has(name));
    if (!missing.length) return notify("标准项目目录已经齐全");
    try {
      const created = [];
      for (const name of missing) {
        const saved = await apiCreateAssetFolder(role, { projectId: currentProject.id, name });
        created.push(saved.folder);
      }
      setAssetFolders((items) => {
        const known = new Set(items.map((item) => item.id));
        return [...items, ...created.filter((item) => !known.has(item.id))];
      });
      await refreshWorkspace();
      notify(`已补齐 ${created.length} 个标准项目目录`);
    } catch (error) {
      await refreshWorkspace().catch(() => {});
      notify(error.message || "标准项目目录初始化失败");
    }
  };

  const createImageTask = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const task = {
      projectId: currentProject.id,
      assetId: form.get("assetId") || null,
      name: form.get("name"),
      type: form.get("type"),
      ratio: form.get("ratio"),
      prompt: form.get("prompt"),
      negativePrompt: form.get("negativePrompt") || "",
      style: form.get("style") || currentProject.style,
      modelName: form.get("modelName") || "",
      provider: form.get("provider") || "未配置",
      seed: form.get("seed") || "",
    };
    try {
      const saved = await apiCreateImageTask(role, task);
      setImageTasks((items) => [saved.imageTask, ...items]);
      setSelectedTaskId(saved.imageTask.id);
      setModal(null);
      await refreshWorkspace();
      notify(saved.imageTask.status === "待接入" ? "任务已保存，等待生成服务配置" : "任务已加入生图队列");
    } catch (error) {
      notify(error.message || "生图任务保存失败");
    }
  };

  const createH3VideoTask = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const saved = await apiCreateH3VideoTask(role, {
        projectId: currentProject.id,
        name: form.get("name"),
        prompt: form.get("prompt"),
        ratio: form.get("ratio"),
        durationSeconds: Number(form.get("durationSeconds")),
        seed: form.get("seed") || "",
      });
      setImageTasks((items) => [saved.imageTask, ...items]);
      setSelectedTaskId(saved.imageTask.id);
      setModal(null);
      await refreshWorkspace();
      navigate("queue");
      notify("视频任务已提交到云显卡队列");
    } catch (error) {
      await refreshWorkspace().catch(() => {});
      notify(error.message || "视频任务提交失败");
    }
  };

  const syncH3VideoTask = async (taskId) => {
    try {
      const saved = await apiSyncH3VideoTask(role, taskId);
      updateTask(taskId, () => saved.imageTask);
      await refreshWorkspace();
      notify(saved.imageTask.status === "已完成" ? "成片已保存到本机" : `任务状态：${saved.imageTask.status}`);
    } catch (error) {
      notify(error.message || "视频任务状态同步失败");
    }
  };

  const downloadH3Video = async (task) => {
    try {
      const blob = await apiLoadGenerationVideo(role, task.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${currentProject.name}_${task.name}.mp4`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      notify("成片下载已开始");
    } catch (error) {
      notify(error.message || "成片下载失败");
    }
  };

  const uploadAssetImage = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetId = form.get("assetId");
    const file = form.get("file");
    if (!assetId || !file?.size) return notify("请选择资产和文件");
    try {
      const dataUrl = await fileToDataUrl(file);
      const saved = await apiUploadAssetFile(role, assetId, {
        fileName: file.name,
        mimeType: file.type,
        dataUrl,
        kind: form.get("kind") || "原图",
      });
      setAssets((items) => items.map((item) => item.id === saved.asset.id ? saved.asset : item));
      setAssetFiles((items) => [saved.file, ...items]);
      setModal(null);
      await refreshWorkspace();
      notify(["application/pdf", "text/markdown", "text/plain"].includes(file.type) || /\.md$/i.test(file.name) ? "文档已上传并归档" : "图片已上传并生成预览文件");
    } catch (error) {
      notify(error.message || "文件上传失败");
    }
  };

  const deleteAsset = async (asset) => {
    if (!window.confirm(`确定删除资产「${asset.name}」吗？`)) return;
    try {
      await apiDeleteAsset(role, asset.id);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      setAssetFiles((items) => items.filter((item) => item.assetId !== asset.id));
      await refreshWorkspace();
      notify("资产已删除");
    } catch (error) {
      notify(error.message || "资产删除失败");
    }
  };

  const createShot = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetIds = form.getAll("assetIds").filter(Boolean);
    const boundAssets = approvedAssets.filter((asset) => assetIds.includes(asset.id));
    const sceneAsset = boundAssets.find((asset) => asset.type === "scene")?.name || "未指定";
    const props = boundAssets.filter((asset) => asset.type === "prop").map((asset) => asset.name);
    setShots((items) => [...items, {
      id: `shot-${Date.now()}`,
      projectId: currentProject.id,
      number: form.get("number"),
      sceneName: form.get("sceneName"),
      duration: form.get("duration"),
      shotSize: form.get("shotSize"),
      camera: form.get("camera"),
      characters: [form.get("characters")].filter(Boolean),
      sceneAsset,
      props,
      action: form.get("action"),
      dialogue: form.get("dialogue") || "无",
      stillPrompt: form.get("stillPrompt"),
      videoPrompt: form.get("videoPrompt"),
      assetIds,
      status: "编辑中",
    }]);
    setModal(null);
    recordActivity("新建并绑定分镜", `镜头 ${form.get("number")}`, "编辑中");
    notify(assetIds.length ? `镜头已创建，已绑定 ${assetIds.length} 个资产` : "镜头已创建，暂未绑定资产");
  };

  const importPremiereSubtitle = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const cues = parseSubtitleText(await file.text(), file.name);
      if (!cues.length) throw new Error("没有识别到有效字幕时间轴");
      setPremiereSubtitle({
        fileName: file.name,
        cues,
        sourceProjectId: currentProject?.id || null,
        updatedAt: new Date().toISOString(),
      });
      notify(`已载入 ${cues.length} 条字幕，可直接生成 PR 导入包`);
    } catch (error) {
      notify(error.message || "字幕文件读取失败");
    }
  };

  const importPremiereTextStyle = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const source = await file.text();
      const metadata = parsePremiereTextStyle(source, file.name);
      const patch = {};
      patch.premiereStyleName = metadata.styleName;
      patch.premiereStyleSourceFileName = file.name;
      patch.premiereStyleSourceText = source;
      if (metadata.fontName) patch.fontName = metadata.fontName;
      setPremiereTextStyleFile(file);
      setPremiereTextStyleMeta(metadata);
      if (Object.keys(patch).length) updatePremiereSettings(patch);
      const details = [metadata.fontName]
        .filter(Boolean)
        .join(" · ");
      notify(`已载入 PR 样式「${metadata.styleName}」${details ? `（${details}）` : ""}，画面位置按当前横竖版预设处理`);
    } catch (error) {
      setPremiereTextStyleFile(null);
      setPremiereTextStyleMeta(null);
      notify(error.message || "PR 文字样式读取失败");
    }
  };

  const generatePremiereSubtitleFromShots = () => {
    const cues = cuesFromShots(projectShots, premiereSettings.frameRate);
    if (!cues.length) return notify("当前项目的分镜还没有可用台词");
    setPremiereSubtitle({
      fileName: `${currentProject.name}_分镜台词.srt`,
      cues,
      sourceProjectId: currentProject.id,
      updatedAt: new Date().toISOString(),
    });
    notify(`已从当前分镜整理 ${cues.length} 条台词字幕`);
  };

  const savePremierePreset = () => {
    const name = window.prompt("请输入字幕参数预设名称", "默认字幕样式");
    if (!name?.trim()) return;
    const preset = { id: `premiere-preset-${Date.now()}`, name: name.trim(), settings: normalizePremiereSettings(premiereSettings, currentProject), updatedAt: new Date().toISOString() };
    setPremierePresets((items) => [preset, ...items.filter((item) => item.name !== preset.name)]);
    notify(`参数预设「${preset.name}」已保存`);
  };

  const usePremierePreset = (event) => {
    const preset = premierePresets.find((item) => item.id === event.target.value);
    if (preset) setPremiereSettings(normalizePremiereSettings(preset.settings, currentProject));
  };

  const exportPremiere = async (xmlOnly = false) => {
    if (!premiereSubtitle.cues?.length) return notify("请先上传字幕文件，或从当前分镜生成台词");
    setPremiereBusy(true);
    try {
      const project = currentProject || { id: "video-subtitle", name: premiereSubtitle.fileName?.replace(/\.[^.]+$/, "") || "视频字幕项目" };
      const settings = normalizePremiereSettings(premiereSettings, project);
      const onDownloadReady = (download) => setSubtitleDownload(download);
      if (xmlOnly) downloadPremiereXml(project, premiereSubtitle.cues, settings, { onReady: onDownloadReady });
      else await exportPremierePackage({ project, cues: premiereSubtitle.cues, settings, fontFile: premiereFontFile, textStyleFile: premiereTextStyleFile, textStyleMeta: premiereTextStyleMeta, referenceFiles: subtitleReferenceFiles, onDownloadReady });
      recordActivity(xmlOnly ? "导出 PR 字幕图形 XML" : "生成 PR 字幕导入包", `${project.name} · ${premiereSubtitle.cues.length} 条字幕`, "已完成");
      notify(xmlOnly ? "PR 字幕图形 XML 已生成" : "PR 字幕导入包已生成");
    } catch (error) {
      notify(error.message || "PR 导入包生成失败");
    } finally {
      setPremiereBusy(false);
    }
  };

  const exportSubtitleBatch = async () => {
    const items = subtitleBatchItems.filter((item) => item.cues?.length);
    if (!items.length) return notify("请先批量识别视频");
    setPremiereBusy(true);
    try {
      await exportPremiereBatchPackage({ items, settings: premiereSettings, fontFile: premiereFontFile, textStyleFile: premiereTextStyleFile, textStyleMeta: premiereTextStyleMeta, referenceFiles: subtitleReferenceFiles, onDownloadReady: setSubtitleDownload });
      recordActivity("批量生成 PR 字幕导入包", `${items.length} 个视频 · ${items.reduce((total, item) => total + item.cues.length, 0)} 条字幕`, "已完成");
      notify(`已导出 ${items.length} 个视频的字幕导入包`);
    } catch (error) {
      notify(error.message || "批量导出失败");
    } finally {
      setPremiereBusy(false);
    }
  };

  const exportSubtitleSrtBatch = async () => {
    const items = subtitleBatchItems.filter((item) => item.cues?.length);
    if (!items.length) return notify("请先批量识别视频或导入 SRT");
    setPremiereBusy(true);
    try {
      await exportSubtitleSrtBatchPackage({ items, onDownloadReady: setSubtitleDownload });
      recordActivity("批量导出 SRT 字幕", `${items.length} 个视频`, "已完成");
      notify(`已生成 ${items.length} 个 SRT，已打包下载`);
    } catch (error) {
      notify(error.message || "批量 SRT 导出失败");
    } finally {
      setPremiereBusy(false);
    }
  };

  const exportSubtitleVideos = async () => {
    const videos = subtitleBatchItems.filter((item) => item.videoFile);
    if (!videos.length) return notify("请先选择视频文件");
    const outputNames = videos.map((item) => subtitleOutputFilename(item.videoFile.name).toLowerCase());
    if (new Set(outputNames).size !== outputNames.length) return notify("有视频会生成相同文件名，请先调整重复文件名再导出");
    const missing = videos.filter((item) => !item.cues?.length);
    if (missing.length) {
      setSubtitleRenderSummary({ saved: 0, total: videos.length, failures: missing.map((item) => ({ name: item.fileName, error: "缺少对应字幕" })) });
      return notify(`${missing.length} 个视频缺少对应字幕，请先补齐后再烧录`);
    }
    const continuing = subtitleExportSession && videos.some((item) => item.renderState === "saved")
      && videos.some((item) => item.renderState !== "saved");
    const items = continuing ? videos.filter((item) => item.renderState !== "saved") : videos;
    let destination = continuing ? subtitleExportSession : null;
    try {
      if (!destination && window.hjscDesktop?.chooseSubtitleExportFolder) {
        const selected = await window.hjscDesktop.chooseSubtitleExportFolder();
        if (!selected) return;
        destination = { ...selected, kind: "desktop", label: selected.directory };
      } else if (!destination && window.showDirectoryPicker) {
        const parent = await window.showDirectoryPicker({ mode: "readwrite" });
        const folderName = `批量带字幕成片_${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
        const handle = await parent.getDirectoryHandle(folderName, { create: true });
        destination = { kind: "browser", handle, label: `${parent.name}/${folderName}` };
      }
      if (!destination) throw new Error("当前浏览器无法选择保存文件夹，请在桌面软件中导出");
    } catch (error) {
      if (error?.name === "AbortError") return;
      return notify(error.message || "无法选择保存位置");
    }
    setSubtitleExportSession(destination);
    setSubtitleRenderSummary(null);
    setSubtitleDownload(null);
    setSubtitleRenderBusy(true);
    setSubtitleRenderStatus(items.length === 1 ? "正在烧录字幕，请保持页面打开" : `正在烧录第 1/${items.length} 个视频`);
    try {
      const settings = normalizePremiereSettings(premiereSettings, currentProject);
      const result = await exportRenderedVideoBatch({
        items,
        settings,
        textStyleMeta: premiereTextStyleMeta,
        renderVideo: async (item, normalizedSettings, filename) => {
          const metadata = await detectVideoMetadata(item.videoFile);
          const renderSettings = settingsForOrientation(normalizedSettings, metadata.orientation, currentProject);
          return apiRenderSubtitleVideo(role, item.videoFile, buildAss(item.cues, renderSettings), item.fileName, {
            width: renderSettings.width,
            height: renderSettings.height,
            exportSessionId: destination.kind === "desktop" ? destination.id : "",
            destinationName: filename,
          });
        },
        saveVideo: async (rendered, filename) => {
          if (destination.kind === "desktop") {
            if (rendered?.filename !== filename) throw new Error("保存文件名与任务不一致");
            return;
          }
          const fileHandle = await destination.handle.getFileHandle(filename, { create: true });
          const writer = await fileHandle.createWritable();
          try {
            await writer.write(rendered);
            await writer.close();
          } catch (error) {
            await writer.abort().catch(() => {});
            throw error;
          }
        },
        onProgress: (completed, total, item, error, filename) => {
          setSubtitleBatchItems((current) => current.map((entry) => entry.id === item.id
            ? { ...entry, renderState: error ? "failed" : "saved", renderError: error || "", renderFilename: filename }
            : entry));
          setSubtitleRenderStatus(completed >= total ? "正在核对导出结果" : `正在烧录第 ${completed + 1}/${total} 个视频`);
        },
      });
      const saved = (continuing ? videos.length - items.length : 0) + result.successes.length;
      const failures = result.failures.map(({ item, error }) => ({ name: item.fileName, error }));
      setSubtitleRenderSummary({ saved, total: videos.length, failures, directory: destination.label });
      recordActivity("批量导出带字幕成片", `${saved}/${videos.length} 个视频 · ${destination.label}`, failures.length ? "部分完成" : "已完成");
      notify(failures.length ? `已保存 ${saved}/${videos.length} 集，${failures.length} 集失败；点击“重试未完成”继续` : `全部 ${saved} 集已保存到所选文件夹`);
    } catch (error) {
      notify(error.message || "带字幕成片生成失败");
    } finally {
      setSubtitleRenderBusy(false);
      setSubtitleRenderStatus("");
    }
  };

  const chooseSubtitleVideo = (event) => {
    const files = Array.from(event.currentTarget.files || []).sort(compareSubtitleFiles);
    event.currentTarget.value = "";
    if (!files.length) return;
    const file = files[0];
    if (subtitleVideoUrl) URL.revokeObjectURL(subtitleVideoUrl);
    setSubtitleVideoFile(file);
    setSubtitleVideoFiles(files);
    const { items: batchItems, unmatchedSubtitles } = matchSubtitleBatch(files, subtitleBatchItems);
    setSubtitleBatchItems(batchItems);
    setSubtitleImportIssues(unmatchedSubtitles);
    setSubtitleExportSession(null);
    setSubtitleRenderSummary(null);
    setSelectedSubtitleBatchId(batchItems[0].id);
    setSubtitleVideoUrl(URL.createObjectURL(file));
    setPremiereSubtitle((current) => ({ ...current, fileName: file.name, updatedAt: new Date().toISOString() }));
  };

  const transcribeUploadedVideo = async () => {
    const files = subtitleVideoFiles.length ? subtitleVideoFiles : subtitleVideoFile ? [subtitleVideoFile] : [];
    if (!files.length) return notify("请先选择视频文件");
    setSubtitleExportSession(null);
    setSubtitleRenderSummary(null);
    setSubtitleBusy(true);
    try {
      const batch = [];
      const failed = [];
      for (const [index, file] of files.entries()) {
        setSubtitleBatchItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, status: "识别中" } : item));
        try {
          const result = await apiTranscribeVideo(role, file, subtitleLanguage);
          const item = { id: subtitleBatchItems[index]?.id || `subtitle-${Date.now()}-${index}`, name: file.name.replace(/\.[^.]+$/, ""), fileName: result.fileName || file.name, videoFile: file, subtitleFile: subtitleBatchItems[index]?.subtitleFile || null, cues: result.cues || [], status: "已完成" };
          batch.push(item);
          setSubtitleBatchItems((items) => items.map((current, itemIndex) => itemIndex === index ? item : current));
          if (index === 0 || !selectedSubtitleBatchId) {
            setSelectedSubtitleBatchId(item.id);
            setPremiereSubtitle({ fileName: item.fileName, cues: item.cues, sourceProjectId: currentProject?.id || null, updatedAt: result.recognizedAt || new Date().toISOString() });
          }
        } catch (error) {
          failed.push(`${file.name}：${error.message || "识别失败"}`);
          setSubtitleBatchItems((items) => items.map((current, itemIndex) => itemIndex === index ? { ...current, status: "失败" } : current));
        }
      }
      if (!batch.length) throw new Error(failed[0] || "视频字幕识别失败");
      notify(failed.length ? `已完成 ${batch.length} 个，失败 ${failed.length} 个；失败项可单独重新选择` : `已完成 ${batch.length} 个视频识别，样式会统一应用到全部结果`);
    } catch (error) {
      notify(error.message || "视频字幕识别失败");
    } finally {
      setSubtitleBusy(false);
    }
  };

  const selectSubtitleBatchItem = (item) => {
    setSelectedSubtitleBatchId(item.id);
    setPremiereSubtitle({ fileName: item.fileName, cues: item.cues || [], sourceProjectId: currentProject?.id || null, updatedAt: new Date().toISOString() });
    if (subtitleVideoUrl) URL.revokeObjectURL(subtitleVideoUrl);
    setSubtitleVideoFile(item.videoFile || null);
    setSubtitleVideoUrl(item.videoFile ? URL.createObjectURL(item.videoFile) : "");
  };

  const updateSelectedSubtitleCue = (index, text) => {
    // 手动改字后，原识别词级时间点不再可靠，交给导出逻辑按整条字幕处理。
    setPremiereSubtitle((current) => ({ ...current, cues: current.cues.map((item, itemIndex) => itemIndex === index ? { ...item, text, words: [] } : item) }));
    if (selectedSubtitleBatchId) setSubtitleBatchItems((items) => items.map((item) => item.id === selectedSubtitleBatchId ? { ...item, cues: item.cues.map((cue, cueIndex) => cueIndex === index ? { ...cue, text, words: [] } : cue) } : item));
  };

  const importSubtitleReferenceFiles = (event) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (!files.length) return;
    setSubtitleReferenceFiles((current) => [...files, ...current].slice(0, 8));
    notify(`已加入 ${files.length} 个字幕参考文件`);
  };

  const importSubtitleBatchFiles = async (event) => {
    const files = Array.from(event.currentTarget.files || []).sort(compareSubtitleFiles);
    event.currentTarget.value = "";
    if (!files.length) return;
    const items = [];
    const failed = [];
    for (const [index, file] of files.entries()) {
      try {
        const cues = parseSubtitleText(await file.text(), file.name);
        if (!cues.length) throw new Error("没有有效时间轴");
        items.push({ id: `subtitle-file-${Date.now()}-${index}`, name: subtitleStem(file.name), fileName: file.name, subtitleFile: file, cues, status: "已载入" });
      } catch (error) {
        failed.push(`${file.name}：${error.message || "格式无法读取"}`);
      }
    }
    if (!items.length) return notify(failed[0] || "没有可用字幕文件");
    if (subtitleVideoUrl) URL.revokeObjectURL(subtitleVideoUrl);
    setSubtitleVideoUrl("");
    setSubtitleVideoFile(null);
    const sourceByName = new Map(subtitleBatchItems.filter((item) => item.cues?.length)
      .map((item) => [subtitleStem(item.subtitleFile?.name || item.name), item]));
    for (const item of items) sourceByName.set(item.name, item);
    const existingVideos = subtitleBatchItems.map((item) => item.videoFile).filter(Boolean);
    const matched = existingVideos.length ? matchSubtitleBatch(existingVideos, [...sourceByName.values()]) : null;
    const pairedItems = matched?.items || [...sourceByName.values()];
    const firstVideo = pairedItems.find((item) => item.videoFile)?.videoFile || null;
    setSubtitleVideoFile(firstVideo);
    setSubtitleVideoUrl(firstVideo ? URL.createObjectURL(firstVideo) : "");
    setSubtitleImportIssues(matched?.unmatchedSubtitles || []);
    setSubtitleExportSession(null);
    setSubtitleRenderSummary(null);
    setSubtitleBatchItems(pairedItems);
    setSelectedSubtitleBatchId(pairedItems[0].id);
    setPremiereSubtitle({ fileName: pairedItems[0].fileName, cues: pairedItems[0].cues, sourceProjectId: currentProject?.id || null, updatedAt: new Date().toISOString() });
    const matchedCount = pairedItems.filter((item) => item.videoFile && item.cues?.length).length;
    notify(failed.length ? `已导入 ${items.length} 个字幕，失败 ${failed.length} 个` : existingVideos.length ? `已匹配 ${matchedCount}/${existingVideos.length} 个视频的字幕` : `已导入 ${items.length} 个字幕文件`);
  };

  const copyText = async (text, message = "已复制") => {
    await navigator.clipboard.writeText(text);
    notify(message);
  };

  const renderSubtitleDownloadFallback = () => subtitleDownload ? (
    <section className="panel subtitle-download-fallback">
      <div><span className="eyebrow">下载准备</span><strong>{subtitleDownload.filename}</strong><small>文件已经生成。如果浏览器没有自动开始下载，请点击右侧按钮。</small></div>
      <div className="subtitle-download-actions"><a className="button button-primary" href={subtitleDownload.url} download={subtitleDownload.filename}><DownloadSimple size={15} /> 再次下载</a><AppButton onClick={() => setSubtitleDownload(null)}><X size={15} /> 关闭</AppButton></div>
    </section>
  ) : null;

  const searchResults = (() => {
    const query = search.trim().toLowerCase();
    const all = [
      ...projectAssets.map((item) => ({ title: item.name, meta: `资产 · ${item.status}`, page: "assets" })),
      ...projectTasks.map((item) => ({ title: item.name, meta: `任务 · ${item.status}`, page: "queue", id: item.id })),
      ...projectShots.map((item) => ({ title: `镜头 ${item.number}`, meta: item.sceneName, page: "shots" })),
      ...myAssignments.map((item) => ({ title: item.title, meta: `个人任务 · ${item.status}`, page: "my-work" })),
      ...visibleSkills.map((item) => ({ title: item.name, meta: item.scope ? `制作规范 · ${item.scope}` : "制作规范", page: "skills" })),
    ];
    return (query ? all.filter((item) => item.title.toLowerCase().includes(query) || item.meta.toLowerCase().includes(query)) : all).slice(0, 8);
  })();

  const projectContextBar = currentProject && activePage !== "projects" && (
    <div className="workspace-context-bar">
      <span className="sidebar-caption">当前项目</span>
      <div className="workspace-project-select">
        <button className="project-select" onClick={() => setProjectMenuOpen((open) => !open)}>
          <CoverThumb src={currentProject.cover} alt="" />
          <span><strong>{currentProject.name}</strong><small>{currentProject.stage} · {currentProject.aspectRatio}</small></span>
          <CaretDown size={13} />
        </button>
        {projectMenuOpen && <div className="project-popover">{myProjects.map((project) => <button key={project.id} onClick={() => { setCurrentProjectId(project.id); setProjectMenuOpen(false); }}><span>{project.name}</span>{project.id === currentProject.id && <Check size={13} />}</button>)}<button onClick={() => { setModal({ type: "project" }); setProjectMenuOpen(false); }}><Plus size={13} /> 新建项目</button></div>}
      </div>
      <button className="topbar-search" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={16} /><span>搜索项目内容</span></button>
    </div>
  );

  const renderWedding = () => {
    if (!weddingDraft) return null;
    const progress = weddingProgress(weddingDraft);
    const weddingTasks = projectTasks.filter((task) => weddingDraft.imageTaskIds.includes(task.id));
    const story = weddingDraft.story;
    const stepIcon = (stepId) => {
      if ([4, 5].includes(stepId)) return Microphone;
      if ([10, 11, 12].includes(stepId)) return MusicNotes;
      if ([7, 8].includes(stepId)) return ImageSquare;
      if ([9, 13, 14].includes(stepId)) return FilmStrip;
      return ClipboardText;
    };
    const stepGuidance = {
      9: { label: "进入分镜", action: () => navigate("shots"), icon: FilmStrip },
      13: { label: "查看导出准备", action: () => navigate("export"), icon: DownloadSimple },
      14: { label: "打开项目导出", action: () => navigate("export"), icon: DownloadSimple },
    }[weddingCurrentStep.id];
    return (
      <>
        <PageHeader eyebrow="婚庆生产" title={`${currentProject.name} · 婚礼制作`} description="从新人真实故事到婚礼成片交付的 14 步生产流程；重点分镜和剩余画面直接接入当前图片生成队列。">
          <StatusPill status={weddingDraft.status}>{progress}% 已完成</StatusPill>
          <AppButton onClick={() => saveWeddingDraft()} disabled={weddingBusy}>{weddingBusy ? "正在保存" : "保存当前资料"}</AppButton>
        </PageHeader>
        <section className="wedding-overview panel">
          <div className="wedding-overview-score"><span className="eyebrow">婚礼制作进度</span><strong>{weddingDraft.currentStep}<em>/14</em></strong><p>当前：{weddingCurrentStep.title} · {weddingCurrentStep.owner}</p></div>
          <div className="wedding-overview-progress"><div><i><b style={{ width: `${progress}%` }} /></i><strong>{progress}%</strong></div><small>每一步都保留材料和确认记录，返工只影响对应环节。</small></div>
          <div className="wedding-overview-stats"><span><strong>{weddingTasks.length}</strong> 个图片任务</span><span><strong>{approvedAssets.filter((asset) => weddingDraft.imageTaskIds.includes(asset.id)).length}</strong> 个已通过资产</span></div>
        </section>
        <section className="wedding-layout">
          <aside className="panel wedding-step-list">
            <div className="panel-heading"><div><span className="eyebrow">14 步向导</span><h2>婚礼生产流程</h2></div><span className="soft-label">{weddingDraft.status}</span></div>
            <div className="wedding-step-items">
              {WEDDING_STEPS.map((step) => {
                const Icon = stepIcon(step.id);
                const complete = weddingStepIsComplete(weddingDraft, step.id);
                return <button className={`${step.id === weddingCurrentStep.id ? "active" : ""} ${complete ? "complete" : ""}`} key={step.id} onClick={() => updateWeddingDraft({ currentStep: step.id })}><span className="wedding-step-index">{complete ? <Check size={13} /> : String(step.id).padStart(2, "0")}</span><span><strong>{step.shortTitle}</strong><small>{step.title}</small></span><Icon size={15} /></button>;
              })}
            </div>
          </aside>
          <article className="panel wedding-step-detail">
            <div className="wedding-detail-head"><div><div className="inline-status"><StatusPill status={weddingStepIsComplete(weddingDraft, weddingCurrentStep.id) ? "已完成" : "进行中"} /><span>第 {weddingCurrentStep.id} / 14 步</span></div><h2>{weddingCurrentStep.title}</h2><p>{weddingCurrentStep.note}</p></div><div className="wedding-detail-deliverable"><span>本步交付</span><strong>{weddingCurrentStep.deliverable}</strong><small>确认人：{weddingCurrentStep.owner}</small></div></div>
            {weddingCurrentStep.id === 1 && <section className="wedding-story-card"><div className="wedding-section-heading"><div><span className="eyebrow">故事采集卡</span><h3>只填写真实经历</h3></div><span className="soft-label">不收集手机号</span></div><p className="wedding-help">这张卡是整条婚礼片子的事实底稿。先写清楚，再进入文案、声音和画面；照片可以随后从资产库上传。</p><div className="wedding-story-grid"><Field label="新人称呼"><input value={story.coupleNames} onChange={(event) => updateWeddingStory("coupleNames", event.target.value)} placeholder="例如：新郎与新娘的称呼" /></Field><Field label="婚期"><input value={story.weddingDate} onChange={(event) => updateWeddingStory("weddingDate", event.target.value)} placeholder="例如：2026 年 10 月" /></Field><Field label="相识与经历" full><textarea value={story.relationship} onChange={(event) => updateWeddingStory("relationship", event.target.value)} placeholder="怎么认识、相处中印象深刻的片段" /></Field><Field label="重要片段" full><textarea value={story.importantMoments} onChange={(event) => updateWeddingStory("importantMoments", event.target.value)} placeholder="希望一定出现在片子里的真实事件" /></Field><Field label="家人与朋友" full><textarea value={story.familyAndFriends} onChange={(event) => updateWeddingStory("familyAndFriends", event.target.value)} placeholder="希望出现的家人、朋友或祝福信息" /></Field><Field label="风格方向"><input value={story.preferredStyle} onChange={(event) => updateWeddingStory("preferredStyle", event.target.value)} placeholder="例如：克制、温暖、电影感" /></Field><Field label="目标时长"><input value={story.targetDuration} onChange={(event) => updateWeddingStory("targetDuration", event.target.value)} placeholder="例如：3–5 分钟" /></Field><Field label="必须保留" full><textarea value={story.mustKeep} onChange={(event) => updateWeddingStory("mustKeep", event.target.value)} placeholder="称呼、地点、物件、台词等不可遗漏的信息" /></Field><Field label="明确避开" full><textarea value={story.mustAvoid} onChange={(event) => updateWeddingStory("mustAvoid", event.target.value)} placeholder="不希望公开、出现或演绎的内容" /></Field><Field label="照片说明" full><textarea value={story.photosNote} onChange={(event) => updateWeddingStory("photosNote", event.target.value)} placeholder="人物参考照片、婚礼现场照片或版权说明" /></Field></div><div className="wedding-inline-actions"><AppButton onClick={() => navigate("assets")}><UploadSimple size={15} /> 去资产库上传照片</AppButton><span>建议先保存故事卡，再进入下一步。</span></div></section>}
            {[7, 8].includes(weddingCurrentStep.id) && <section className="wedding-image-bridge"><div className="wedding-image-bridge-head"><div className="feature-icon"><ImageSquare size={22} /></div><div><span className="eyebrow">接入现有生图</span><h3>{weddingCurrentStep.id === 7 ? "先做三个重点分镜" : "继续完成剩余分镜"}</h3><p>本步会调用“婚礼影像生图规范”，抽取新人、场地、服装、道具和隐私边界；第 7 步生成 3 张定调图，第 8 步生成 4 张批量结果，全部进入图片审核队列。</p></div></div><div className="wedding-image-bridge-stats"><div><span>本单图片任务</span><strong>{weddingTasks.length}</strong></div><div><span>待审核结果</span><strong>{weddingTasks.filter((task) => task.status === "待审核").length}</strong></div><div><span>已通过资产</span><strong>{approvedAssets.filter((asset) => weddingDraft.imageTaskIds.includes(asset.id)).length}</strong></div></div><div className="wedding-bridge-actions"><AppButton variant="primary" onClick={runWeddingImageWorkflow} disabled={weddingBusy}><ImageSquare size={15} /> {weddingBusy ? "正在创建任务" : "整理并送入生图队列"}</AppButton><AppButton onClick={() => navigate("queue")}><ListChecks size={15} /> 查看图片审核</AppButton></div></section>}
            {[2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14].includes(weddingCurrentStep.id) && <section className="wedding-material-card"><div className="wedding-section-heading"><div><span className="eyebrow">制作材料</span><h3>{weddingCurrentStep.deliverable}</h3></div><span className="soft-label">可粘贴外部工具结果</span></div><p className="wedding-help">本软件只保存你实际填写或回传的材料，不自动补写新人经历，也不把“文件生成成功”当作满意确认。</p></section>}
            <Field label="本步材料 / 确认记录" full><textarea className="wedding-notes-input" value={weddingDraft.notes?.[weddingCurrentStep.id] || ""} onChange={(event) => updateWeddingDraft({ notes: { ...weddingDraft.notes, [weddingCurrentStep.id]: event.target.value } })} placeholder={`填写第 ${weddingCurrentStep.id} 步的实际材料、回传内容或确认依据`} /></Field>
            {stepGuidance && <div className="wedding-guidance"><span><stepGuidance.icon size={16} /> 下一处工作台</span><AppButton onClick={stepGuidance.action}>{stepGuidance.label} <ArrowRight size={14} /></AppButton></div>}
            <div className="wedding-step-footer"><AppButton onClick={() => updateWeddingDraft({ currentStep: Math.max(1, weddingCurrentStep.id - 1) })} disabled={weddingCurrentStep.id === 1}>上一步</AppButton><span>{weddingStepIsComplete(weddingDraft, weddingCurrentStep.id) ? "本步已确认，可继续返工或查看后续步骤" : "完成本步材料后确认，进入下一步"}</span><AppButton variant="primary" onClick={confirmWeddingStep} disabled={weddingBusy}>{weddingCurrentStep.id === WEDDING_STEPS.length ? "确认交付" : "确认本步并继续"} <ArrowRight size={14} /></AppButton></div>
          </article>
        </section>
      </>
    );
  };

  const renderDashboard = () => (
    <>
      <PageHeader eyebrow="总览" title={`${currentProject.name} · 制作工作台`} description="先锁资产，再做分镜；先锁分镜，再做视频。">
        <AppButton onClick={() => navigate("queue")}><ListChecks size={15} /> 查看队列</AppButton>
        <AppButton variant="primary" onClick={() => setModal({ type: "asset" })}><Plus size={15} /> 新建资产</AppButton>
      </PageHeader>
      <section className="admin-metric-grid">
        <Metric icon={Archive} label="项目资产" value={projectAssets.length} note={`${approvedAssets.length} 个已通过`} />
        <Metric icon={ImageSquare} label="生成任务" value={projectTasks.length} note={`${projectTasks.filter((item) => item.status === "待审核").length} 个待审核`} />
        <Metric icon={FilmStrip} label="分镜镜头" value={projectShots.length} note={`${projectShots.filter((item) => item.status === "已锁版").length} 个已锁版`} />
        <Metric icon={FileText} label="制作规范" value={availableSkills.length} note={`${productionSpecs.filter((item) => item.projectId === currentProject.id).length} 条已入库`} />
      </section>
      <section className="dashboard-grid">
        <article className="panel workflow-panel">
          <div className="panel-heading"><div><span className="eyebrow">流程</span><h2>内部标准流程</h2></div><span className="soft-label">当前阶段：{currentProject.stage}</span></div>
          <div className="workflow-steps">
            {WORKFLOW.map((step) => <button key={step.id} onClick={() => navigate(["skills", "assets", "queue", "shots", "export"][step.id - 1])}>
              <span className="step-number">{step.id}</span>
              <span className="step-copy"><strong>{step.name}</strong><small>{step.note}</small></span>
              <span className="step-progress"><i><b style={{ width: `${step.progress}%` }} /></i><em>{step.progress}%</em></span>
              <ArrowRight size={14} />
            </button>)}
          </div>
        </article>
        <aside className="panel dashboard-side">
          <div className="panel-heading"><div><span className="eyebrow">下一步</span><h2>当前待办</h2></div></div>
          {projectTasks.some((task) => task.status === "待审核") ? (
            <div className="next-task-card"><StatusPill status="待审核" /><h3>{projectTasks.find((task) => task.status === "待审核")?.name}</h3><p>草图已完成，需要选择、通过或重做。</p><AppButton variant="primary" onClick={() => navigate("queue")}>进入四图审核 <ArrowRight size={14} /></AppButton></div>
          ) : (
            <div className="next-task-card"><StatusPill status="待生成" /><h3>暂无待审核任务</h3><p>新建生图任务后，将在这里提示下一步操作。</p><AppButton onClick={() => navigate("queue")}>前往生图队列 <ArrowRight size={14} /></AppButton></div>
          )}
          <div className="approval-list">
            <div><span>已通过资产</span><strong>{approvedAssets.length}</strong></div>
            <div><span>待审核任务</span><strong>{projectTasks.filter((item) => item.status === "待审核").length}</strong></div>
            <div><span>已锁版镜头</span><strong>{projectShots.filter((item) => item.status === "已锁版").length}</strong></div>
          </div>
        </aside>
      </section>
    </>
  );

  const renderPipeline = () => {
    const folderCount = STANDARD_WORKFLOW_FOLDERS.filter((name) => projectAssetFolderNames.includes(name)).length;
    const readyTaskCount = projectTasks.filter((item) => ["已通过", "已完成", "高清定稿"].includes(item.status)).length;
    const lockedShotCount = projectShots.filter((item) => item.status === "已锁版").length;
    const stages = [
      { id: 1, title: "剧本与制作规范", detail: `${projectSpecs.length} 条项目规范`, ready: projectSpecs.length > 0, page: "skills", action: "整理制作要求" },
      { id: 2, title: "资产制作与审核", detail: `${approvedAssets.length} / ${projectAssets.length} 个资产已通过`, ready: approvedAssets.length > 0, page: "assets", action: "进入资产库" },
      { id: 3, title: "生成任务与选图", detail: `${readyTaskCount} / ${projectTasks.length} 个任务已完成`, ready: readyTaskCount > 0, page: "queue", action: "查看生成队列" },
      { id: 4, title: "分镜与资产绑定", detail: `${lockedShotCount} / ${projectShots.length} 个镜头已锁版`, ready: lockedShotCount > 0, page: "shots", action: "进入分镜" },
      { id: 5, title: "后期与交付", detail: "五种项目文件可导出", ready: projectShots.length > 0 && approvedAssets.length > 0, page: "export", action: "前往导出" },
    ];
    const completed = stages.filter((stage) => stage.ready).length;
    const lanes = ["人物", "服装", "场景", "道具", "群演"].map((label) => {
      const laneAssets = projectAssets.filter((asset) => asset.typeLabel === label);
      return { label, total: laneAssets.length, approved: laneAssets.filter((asset) => asset.status === "已通过").length };
    });
    return (
      <>
        <PageHeader eyebrow="项目流程" title={`${currentProject.name} · 自动工作流`} description="按真实项目数据推进剧本、资产、生成、分镜和交付；未配置生成服务时只创建可检查的任务，不模拟结果。">
          <AppButton onClick={initializeWorkflowFolders}><Folder size={15} /> 初始化标准目录</AppButton>
          <AppButton variant="primary" onClick={() => navigate("skills")}><FileText size={15} /> 开始制作</AppButton>
        </PageHeader>
        <section className="pipeline-overview panel">
          <div className="pipeline-score"><span className="eyebrow">流程进度</span><strong>{completed}<em>/5</em></strong><p>系统根据已经保存的规范、已通过资产、生成任务和分镜状态自动判断，不手工填写进度。</p></div>
          <div className="pipeline-progress"><i><b style={{ width: `${completed * 20}%` }} /></i><span>{completed * 20}%</span></div>
          <div className="pipeline-folder-state"><Folder size={18} /><span><strong>标准项目目录</strong><small>{folderCount} / {STANDARD_WORKFLOW_FOLDERS.length} 个已就绪</small></span></div>
        </section>
        <section className="pipeline-stage-grid">
          {stages.map((stage) => <article className={`pipeline-stage panel ${stage.ready ? "ready" : ""}`} key={stage.id}>
            <div className="pipeline-stage-number">{stage.ready ? <Check size={16} /> : stage.id}</div>
            <div><span>{stage.ready ? "已形成有效数据" : "等待项目数据"}</span><h2>{stage.title}</h2><p>{stage.detail}</p></div>
            <AppButton variant={stage.ready ? "secondary" : "primary"} onClick={() => navigate(stage.page)}>{stage.action} <ArrowRight size={14} /></AppButton>
          </article>)}
        </section>
        <section className="pipeline-bottom-grid">
          <article className="panel pipeline-lanes">
            <div className="panel-heading"><div><span className="eyebrow">并行制作</span><h2>五条资产线</h2></div><small>资产名称从剧本清单到分镜保持一致</small></div>
            <div>{lanes.map((lane) => <button key={lane.label} onClick={() => { setOpenFolder(lane.label); navigate("assets"); }}><span><strong>{lane.label}</strong><small>{lane.approved} 个已通过</small></span><em>{lane.total}</em><ArrowRight size={14} /></button>)}</div>
          </article>
          <article className="panel pipeline-sources">
            <div className="panel-heading"><div><span className="eyebrow">规范素材</span><h2>按授权添加来源内容</h2></div></div>
            <ul>
              <li><CheckCircle size={16} /><span><strong>项目制作规范</strong><small>上传或录入已获授权的要求，关联到真实项目。</small></span></li>
              <li><CheckCircle size={16} /><span><strong>本地规范源文件</strong><small>私有部署可放入 server/skill-sources/，由模板配置读取。</small></span></li>
              <li><CheckCircle size={16} /><span><strong>原始文件下载</strong><small>授权后的 Skill 和资料可放入 public/skill-files/。</small></span></li>
            </ul>
            <AppButton onClick={() => navigate("skills")}>查看制作规范 <ArrowRight size={14} /></AppButton>
          </article>
        </section>
      </>
    );
  };

  const renderProjects = () => (
    <>
      <PageHeader eyebrow="项目" title="我的项目" description="项目资料是制作规范、资产和分镜的统一上下文。"><AppButton variant="primary" onClick={() => setModal({ type: "project" })}><Plus size={15} /> 新建项目</AppButton></PageHeader>
      {myProjects.length ? <section className="project-list">
        {myProjects.map((project) => <article className={`project-card ${project.id === currentProject?.id ? "selected" : ""}`} key={project.id} onClick={() => { setCurrentProjectId(project.id); setOpenFolder(null); navigate("assets"); }}>
          <CoverThumb src={project.cover} alt={`${project.name} 项目封面`} />
          <div className="project-card-body"><div><StatusPill status={project.id === currentProject?.id ? "已通过" : "待生成"}>{project.id === currentProject?.id ? "当前项目" : "未打开"}</StatusPill><span className="ratio-chip">{project.aspectRatio}</span></div><h2>{project.name}</h2><p>{project.description || "暂无项目描述"}</p><dl><div><dt>类型</dt><dd>{project.type}</dd></div><div><dt>风格</dt><dd>{project.style}</dd></div><div><dt>阶段</dt><dd>{project.stage}</dd></div></dl><div className="project-card-footer"><span><i><b style={{ width: `${project.progress}%` }} /></i>{project.progress}%</span><AppButton onClick={(event) => { event.stopPropagation(); setCurrentProjectId(project.id); setOpenFolder(null); navigate("assets"); }}>进入资产</AppButton></div></div>
        </article>)}
      </section> : <section className="panel"><EmptyState icon={SquaresFour} title="还没有自己的项目" description="点击右上角新建项目，创建后即可进入制作工作台。" /></section>}
    </>
  );

  const renderSkills = () => {
    const selectedKey = skillKeyOf(selectedSkill);
    const referenceAssets = approvedAssets.slice(0, 8);
    const selectedPromptCategory = PROMPT_CATEGORY_OPTIONS.find((item) => item.id === promptCategoryFilter) || PROMPT_CATEGORY_OPTIONS[0];
    const archiveCategory = skillForm.archiveCategory || selectedPromptCategory.archive || defaultArchiveLabel(selectedSkill);
    const selectedGroup = skillGroupOf(selectedSkill);
    const groupCount = (group) => filteredSkills.filter((skill) => skillGroupOf(skill)?.id === group.id).length;
    return (
      <>
        <PageHeader eyebrow="制作台" title="制作规范生产台" description="把真实制作要求整理成可复制到外部生成工具的结构化投喂稿；生成资产后再上传回资产库。">
          <StatusPill status="已通过">{visibleSkills.length} 项规范</StatusPill>
        </PageHeader>
        <section className="prompt-category-panel panel">
          <div className="prompt-category-heading"><div><span className="eyebrow">提示词分类</span><h2>先选你要生成的资产类型</h2><p>选中后，左侧只保留这一类相关规范；生成结果也会按这个类别归档。</p></div><span className="prompt-category-current">当前：{selectedPromptCategory.label}</span></div>
          <div className="prompt-category-grid">{PROMPT_CATEGORY_OPTIONS.map((category) => <button type="button" className={promptCategoryFilter === category.id ? "active" : ""} key={category.id} onClick={() => selectPromptCategory(category.id)}><strong>{category.label}</strong><small>{category.description}</small><em>{visibleSkills.filter((skill) => promptCategoryMatches(skill, category.id)).length} 项规范</em></button>)}</div>
        </section>
        <section className="skill-flow-map panel">
          <div className="skill-flow-heading">
            <div><span className="eyebrow">全流程导航</span><h2>从剧本到成片，按阶段选择规范</h2><p>先选你现在要解决的阶段，右侧只显示相关规范；婚礼规范在“图片与婚礼”里。</p></div>
            <span className="skill-flow-total">共 {visibleSkills.length} 项</span>
          </div>
          <div className="skill-flow-groups">
            <button className={skillGroupFilter === "all" ? "active" : ""} onClick={() => setSkillGroupFilter("all")}>
              <em>ALL</em><span><strong>全部规范</strong><small>查看全部内置内容</small></span><b>{visibleSkills.length}</b>
            </button>
            {SKILL_GROUPS.map((group) => <button className={skillGroupFilter === group.id ? "active" : ""} key={group.id} onClick={() => setSkillGroupFilter(group.id)}>
              <em>{group.index}</em><span><strong>{group.name}</strong><small>{group.description}</small></span><b>{groupCount(group)}</b>
            </button>)}
          </div>
        </section>
        <section className="skill-page">
          <aside className="skill-list">
            <div className="skill-list-tools"><span className="eyebrow">规范清单</span><label><MagnifyingGlass size={13} /><input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="搜索规范" /></label></div>
            {SKILL_GROUPS.map((group) => {
              const groupSkills = filteredSkills.filter((skill) => skillGroupOf(skill)?.id === group.id);
              if (!groupSkills.length) return null;
              return <section className="skill-group" key={group.id}>
                <div className="skill-group-heading"><span><em>{group.index}</em><strong>{group.name}</strong></span><small>{groupSkills.length} 项</small></div>
                {groupSkills.map((skill, index) => {
                  const key = skillKeyOf(skill);
                  return <button className={key === selectedKey ? "active" : ""} key={skill.id || skill.key} onClick={() => {
                    setSelectedSkillId(skill.id || skill.key || skill.templateKey);
                    setSkillResult(null);
                    const skillCategory = promptCategoryOfSkill(skill);
                    const category = PROMPT_CATEGORY_OPTIONS.find((item) => item.id === skillCategory) || PROMPT_CATEGORY_OPTIONS.find((item) => item.id === promptCategoryFilter) || PROMPT_CATEGORY_OPTIONS[0];
                    if (skillCategory) setPromptCategoryFilter(skillCategory);
                    updateSkillForm({ archiveCategory: category.archive || defaultArchiveLabel(skill), aspectRatio: skill.recommendedRatio || currentProject.aspectRatio || "16:9" });
                  }}>
                    <em>{String(index + 1).padStart(2, "0")}</em>
                    <span><strong>{skill.name}</strong><small>{skill.description || `${skill.scope || "平台"} · 第 ${skill.version || 1} 版`}</small></span>
                    <ArrowRight size={13} />
                  </button>;
                })}
              </section>;
            })}
            {!filteredSkills.length && <div className="skill-list-empty"><MagnifyingGlass size={18} /><strong>没有找到规范</strong><small>换个关键词，或点击“全部规范”。</small></div>}
          </aside>

          <article className="skill-workspace panel">
            <div className="skill-title">
              <div className="feature-icon"><FileText size={22} /></div>
              <div><span className="eyebrow">{selectedGroup?.index} · {selectedGroup?.name} · 当前规范</span><h2>{selectedSkill.name}</h2><p>{selectedSkill.description}</p></div>
            </div>
            <div className="context-strip">
              <div><span>项目</span><strong>{currentProject.name}</strong></div>
              <div><span>项目画幅</span><strong>{currentProject.aspectRatio}</strong></div>
              <div><span>风格</span><strong>{currentProject.style}</strong></div>
              <div><span>已通过资产</span><strong>{approvedAssets.length}</strong></div>
            </div>
            {selectedSkill.sourceContent && <details className="skill-source-panel">
              <summary><span>查看当前规范原文</span><small>{selectedSkill.sourceFiles?.length || 1} 个来源文件</small></summary>
              {!!selectedSkill.sourceFiles?.length && <div className="source-file-list">{selectedSkill.sourceFiles.slice(0, 16).map((item) => <em key={item.path}>{item.path}</em>)}</div>}
              <pre>{selectedSkill.sourceContent}</pre>
            </details>}
            <section className="original-skill-library">
              <div className="original-skill-heading"><div><span className="eyebrow">原文件库</span><h3>接入已获授权的规范素材</h3></div><small>原始 Skill 与客户资料未随公开源码分发。</small></div>
              <p className="field-help">私有部署可将授权后的规范文件放入 <code>server/skill-sources/</code>，并将可下载原文件放入 <code>public/skill-files/</code>。系统会按配置读取；本公开源码不提供客户或第三方原始内容。</p>
            </section>
            <div className="skill-control-grid">
              <Field label="本次名称"><input value={skillForm.assetName} onChange={(event) => updateSkillForm({ assetName: event.target.value })} placeholder="例：主角焚决形象 / 第一场镜头表" /></Field>
              <Field label="提示词类别"><div className="prompt-category-value"><strong>{selectedPromptCategory.label}</strong><small>生成后归档为“{archiveCategory}”，如需更换请先在上方选择分类。</small></div></Field>
              <Field label="输出画幅"><select value={skillForm.aspectRatio} onChange={(event) => updateSkillForm({ aspectRatio: event.target.value })}>{ASPECT_RATIO_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="项目等级"><select value={skillForm.projectLevel} onChange={(event) => updateSkillForm({ projectLevel: event.target.value })}>{PROJECT_LEVEL_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="批量数量（每次生成 1 张）"><select value={skillForm.batchCount} onChange={(event) => updateSkillForm({ batchCount: event.target.value })}>{[1, 2, 4, 6, 8].map((item) => <option value={item} key={item}>{item} 张</option>)}</select></Field>
            </div>
            <Field label="本次要求 / 剧本 / 镜头内容" full><textarea className="skill-request-input" value={skillRequest} onChange={(event) => setSkillRequest(event.target.value)} placeholder="直接写你要做的内容、人物设定、场景、动作、镜头、风格限制或客户要求。" /></Field>
            <div className="reference-assets">
              <span><LockKey size={13} /> 已通过资产引用</span>
              {referenceAssets.length ? referenceAssets.map((asset, index) => <em key={asset.id}>@资产{String(index + 1).padStart(2, "0")} · {asset.typeLabel} · {asset.name}</em>) : <em>暂无已通过资产</em>}
            </div>
            <div className="skill-footer">
              <span><FileText size={14} /> 只整理你输入的内容，不伪造生成结果</span>
              <div className="skill-footer-actions"><AppButton onClick={runSkill}><ListChecks size={15} /> 只生成提示词</AppButton><AppButton variant="primary" onClick={runImageWorkflow} disabled={workflowBusy}><ImageSquare size={15} /> {workflowBusy ? "正在生成" : `抽取并生成 ${skillForm.batchCount} 张`}</AppButton></div>
            </div>
          </article>

          <article className="skill-output panel">
            <div className="result-head">
              <div><span className="eyebrow">输出</span><h3>{skillResult ? skillResult.name : "等待生成"}</h3></div>
              {skillResult && <button onClick={() => copyText(skillResult.prompt, "生成工具投喂稿已复制")}><Copy size={14} /> 复制</button>}
            </div>
            {skillResult ? (
              <>
                <div className="skill-result-fields">
                  <div><span>归档类别</span><strong>{skillResult.type}</strong></div>
                  <div><span>输出画幅</span><strong>{skillResult.aspectRatio}</strong></div>
                  <div className="field-wide"><span>使用规范</span><p>{skillResult.skillName}</p></div>
                  {skillResult.extraction && <div className="field-wide"><span>已抽取内容</span><p>{Object.entries(skillResult.extraction).map(([label, items]) => `${label}：${items.join("；")}`).join(" ｜ ")}</p></div>}
                </div>
                <pre className="prompt-code">{skillResult.prompt}</pre>
                {skillResult.negativePrompt && <div className="skill-negative"><span>负面限制</span><p>{skillResult.negativePrompt}</p></div>}
                {skillResult.imageTasks?.length ? <div className="skill-generated-summary">已创建 {skillResult.imageTasks.length} 个任务，共返回 {skillResult.imageTasks.reduce((total, task) => total + task.results.length, 0)} 张图片。<button onClick={() => navigate("queue")}>前往队列审核 <ArrowRight size={13} /></button></div> : null}
                <div className="checklist-row">
                  {skillResult.checklist.map((item) => <span key={item}><Check size={12} />{item}</span>)}
                </div>
                <div className="skill-result-actions">
                  <AppButton onClick={() => copyText(`${skillResult.prompt}\n\n负面限制：${skillResult.negativePrompt || ""}`, "生成工具投喂稿已复制")}><Copy size={15} /> 复制投喂稿</AppButton>
                  <AppButton variant="primary" onClick={saveSkillAsset}><Archive size={15} /> 保存到资产库</AppButton>
                </div>
              </>
            ) : (
              <div className="skill-empty-output">
                <FileText size={24} />
                <h3>先生成投喂稿</h3>
                <p>生成后复制到外部生成工具，拿到图片或视频资产后回到资产库上传归档，后台也能按项目和类别查看。</p>
              </div>
            )}
          </article>
        </section>
      </>
    );
  };

  const renderAssets = () => {
    const filters = ["全部", "图片", "人物", "服装", "场景", "道具", "群演", "分镜静帧", "视频提示词", "镜头表", "制作记录", "文档"];
    const folderNames = projectAssetFolderNames;
    const filtered = projectAssets.filter((asset) => (!openFolder || asset.typeLabel === openFolder) && (assetFilter === "全部" || asset.typeLabel === assetFilter));
    return <>
      <PageHeader eyebrow="资产库" title={openFolder || "统一资产库"} description={openFolder ? `${currentProject.name} / ${openFolder}` : "先按文件夹归类，再进入查看和上传具体资产。"}>{openFolder && <AppButton onClick={() => setOpenFolder(null)}>返回文件夹</AppButton>}<AppButton onClick={() => setModal({ type: "folder" })}><Folder size={15} /> 新建文件夹</AppButton><AppButton onClick={() => setModal({ type: "upload" })}><UploadSimple size={15} /> 上传文件</AppButton><AppButton variant="primary" onClick={() => setModal({ type: "asset" })}><Plus size={15} /> 新建资产</AppButton></PageHeader>
      {!openFolder && <section className="asset-folder-grid">{folderNames.map((name) => <button key={name} onClick={() => { setOpenFolder(name); setAssetFilter("全部"); }}><Folder size={34} weight="fill" /><span><strong>{name}</strong><small>{projectAssets.filter((asset) => asset.typeLabel === name).length} 个资产</small></span><ArrowRight size={18} /></button>)}</section>}
      {openFolder && <div className="filter-row"><button className="active">{openFolder}</button><span>{filtered.length} 个资产</span></div>}
      {openFolder && <section className="asset-grid">
        {filtered.length ? filtered.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-image"><CoverThumb src={asset.image} alt={asset.name} /><span>{asset.code}</span></div><div className="asset-card-top"><StatusPill status={asset.status} /><span>第 {asset.version} 版</span></div><h3>{asset.name}</h3><p>{asset.typeLabel} · {asset.notes}</p><div className="asset-prompt"><span>提示词</span><p>{asset.prompt}</p></div><div className="asset-footer"><small>{asset.filename}</small><button title="复制提示词" onClick={() => copyText(asset.prompt, "资产提示词已复制")}><Copy size={14} /></button><button className="danger-link" title="删除资产" onClick={() => deleteAsset(asset)}><Trash size={14} /></button></div></article>) : <div className="collection-empty"><Archive size={24} /><h3>资产库为空</h3><p>请录入你们自己的首个项目资产。</p><AppButton variant="primary" onClick={() => setModal({ type: "asset" })}><Plus size={15} /> 新建资产</AppButton></div>}
      </section>}
    </>;
  };

  const renderQueue = () => (
    <>
      <PageHeader eyebrow="生成队列" title="图片与视频任务" description="图片任务保留四图审核；从制作规范直接抽取人物、场景、道具和镜头，再进入真实生图服务。"><AppButton onClick={() => navigate("image-service")}><CloudArrowUp size={15} /> {imageConnection.status}</AppButton><AppButton onClick={() => navigate("h3")}><CloudCheck size={15} /> 云显卡连接</AppButton><AppButton variant="primary" onClick={() => setModal({ type: "task" })}><Plus size={15} /> 加入生图队列</AppButton></PageHeader>
      <section className="queue-layout">
        <aside className="task-list panel"><div className="panel-heading"><div><span className="eyebrow">任务</span><h2>任务列表</h2></div><span className="soft-label">{projectTasks.length}</span></div>{projectTasks.map((task) => <button className={task.id === selectedTask?.id ? "active" : ""} key={task.id} onClick={() => setSelectedTaskId(task.id)}><div><strong>{task.name}</strong><small>{task.id} · {task.type} · {task.ratio}</small></div><StatusPill status={task.status} /></button>)}</aside>
        {selectedTask ? <article className="queue-detail panel">
          <div className="queue-detail-head"><div><div className="inline-status"><StatusPill status={selectedTask.status} /><span>{selectedTask.id}</span></div><h2>{selectedTask.name}</h2><p>{selectedTask.prompt}</p></div><button className="copy-button" onClick={() => copyText(selectedTask.prompt, "任务提示词已复制")}><Copy size={14} /> 复制提示词</button></div>
          <div className="task-meta"><div><span>项目</span><strong>{currentProject.name}</strong></div><div><span>类型</span><strong>{selectedTask.type}</strong></div><div><span>画幅</span><strong>{selectedTask.ratio}</strong></div><div><span>{selectedTask.mediaKind === "video" ? "时长" : "结果"}</span><strong>{selectedTask.mediaKind === "video" ? `${selectedTask.durationSeconds || 5} 秒` : selectedTask.results.length || "等待生成"}</strong></div></div>
          {selectedTask.mediaKind === "video" ? <div className="h3-video-result">
            {videoObjectUrl ? <video controls preload="metadata" src={videoObjectUrl} /> : <div className="queue-empty"><div className="feature-icon"><FilmStrip size={22} /></div><h3>{selectedTask.status === "已完成" ? "正在读取本地成片" : selectedTask.status === "失败" ? "视频任务失败" : "云显卡正在生成有声视频"}</h3><p>{selectedTask.errorMessage || `云端任务号：${selectedTask.providerJobId || "正在提交"}`}</p><div className="queue-progress"><i><b style={{ width: `${selectedTask.progress}%` }} /></i><span>{selectedTask.progress}%</span></div></div>}
            <div className="queue-actions"><div><span>云端任务号</span><strong>{selectedTask.providerJobId || "等待返回"}</strong></div><AppButton onClick={() => navigate("h3")}><CloudCheck size={15} /> 查看连接</AppButton><AppButton onClick={() => syncH3VideoTask(selectedTask.id)}><ArrowsClockwise size={15} /> 同步状态</AppButton>{selectedTask.outputUrl && <AppButton variant="primary" onClick={() => downloadH3Video(selectedTask)}><DownloadSimple size={15} /> 下载成片</AppButton>}</div>
          </div> : selectedTask.results.length > 0 ? <>
            <div className="result-toolbar"><div><span className="eyebrow">结果</span><h3>结果图：{selectedTask.results.length} 张</h3></div><p>点击图片选择审核结果</p></div>
            <div className="result-grid">{selectedTask.results.map((result, index) => {
              const selected = selectedTask.selectedResultId === result.id;
              const discarded = selectedTask.discardedResultIds.includes(result.id);
              return <button className={`${selected ? "selected" : ""} ${discarded ? "discarded" : ""}`} key={result.id} onClick={() => !discarded && chooseResult(selectedTask.id, result.id)}><img src={result.thumb} alt={`${selectedTask.name} ${result.label}`} /><span className="result-index">{String(index + 1).padStart(2, "0")}</span><span className="result-label">{discarded ? "已废弃" : result.label}</span>{selected && <span className="selected-check"><Check size={14} weight="bold" /></span>}</button>;
            })}</div>
            <div className="queue-actions"><div><span>已选择</span><strong>{selectedTask.selectedResultId ? selectedTask.results.find((item) => item.id === selectedTask.selectedResultId)?.label : "未选择"}</strong></div><AppButton onClick={discardResult}><X size={15} /> 废弃</AppButton><AppButton onClick={() => redoTask()}><ArrowsClockwise size={15} /> 重做</AppButton><AppButton onClick={finalizeHD}><ImageSquare size={15} /> 高清定稿</AppButton><AppButton variant="primary" onClick={approveResult}><CheckCircle size={15} /> 通过并锁版</AppButton></div>
          </> : <div className="queue-empty"><div className="feature-icon"><ImageSquare size={22} /></div><h3>{selectedTask.status === "失败" ? "任务生成失败" : "任务正在后台队列中"}</h3><p>{selectedTask.errorMessage || "你可以继续处理其他工作，完成后会进入待审核。"}</p>{selectedTask.status === "失败" && <AppButton variant="primary" onClick={() => redoTask(selectedTask.id)}><ArrowsClockwise size={15} /> 立即重试</AppButton>}<div className="queue-progress"><i><b style={{ width: `${selectedTask.progress}%` }} /></i><span>{selectedTask.progress}%</span></div></div>}
        </article> : <article className="queue-detail panel"><div className="queue-empty"><div className="feature-icon"><ImageSquare size={22} /></div><h3>暂无生成任务</h3><p>图片任务从本页创建；视频任务从分镜页提交。</p></div></article>}
      </section>
    </>
  );

  const renderShots = () => (
    <>
      <PageHeader eyebrow="分镜" title="分镜与视频提示词" description="每个镜头必须绑定已通过资产；完成视频提示词后可直接提交到 H3 云显卡。"><div className="approved-gate"><LockKey size={14} /> {approvedAssets.length} 个已通过资产可绑定</div><AppButton onClick={() => navigate("h3")}><CloudCheck size={15} /> {h3Connection.status}</AppButton><AppButton variant="primary" onClick={() => setModal({ type: "shot" })}><Plus size={15} /> 新建镜头</AppButton></PageHeader>
      <section className="shot-list">{projectShots.length ? projectShots.map((shot) => <article className="shot-card panel" key={shot.id}><div className="shot-number"><span>镜头</span><strong>{shot.number}</strong><StatusPill status={shot.status} /></div><div className="shot-content"><div className="shot-title"><div><h2>{shot.sceneName}</h2><p>{shot.duration} · {shot.shotSize} · {shot.camera}</p></div><div className="shot-actions"><AppButton onClick={() => copyText(`${shot.stillPrompt}\n\n${shot.videoPrompt}`, "镜头提示词已复制")}><Copy size={14} /> 复制提示词</AppButton><AppButton variant="primary" onClick={() => setModal({ type: "h3-video", shot })}><CloudArrowUp size={14} /> 提交有声视频</AppButton></div></div><div className="shot-fields"><div><span>人物</span><strong>{shot.characters.join("、") || "无"}</strong></div><div><span>场景</span><strong>{shot.sceneAsset}</strong></div><div><span>道具</span><strong>{shot.props.join("、") || "无"}</strong></div><div className="field-wide"><span>动作</span><strong>{shot.action}</strong></div><div className="field-wide"><span>台词</span><strong>{shot.dialogue}</strong></div></div><div className="prompt-pair"><div><span>静帧提示词</span><p>{shot.stillPrompt}</p></div><div><span>视频提示词</span><p>{shot.videoPrompt}</p></div></div><div className="bound-assets"><span><LockKey size={13} /> 绑定资产</span>{shot.assetIds.map((id) => { const asset = assets.find((item) => item.id === id); return asset ? <em key={id}>{asset.filename}</em> : null; })}</div></div></article>) : <div className="collection-empty panel"><FilmStrip size={24} /><h3>还没有分镜</h3><p>新建镜头时，只选择本镜头需要的已通过资产。</p><AppButton variant="primary" onClick={() => setModal({ type: "shot" })}><Plus size={15} /> 新建镜头</AppButton></div>}</section>
    </>
  );

  const renderPremiere = () => {
    const settings = normalizePremiereSettings(premiereSettings, currentProject);
    const cues = Array.isArray(premiereSubtitle.cues) ? premiereSubtitle.cues : [];
    const previewCue = cues[0];
    return (
      <>
        <PageHeader eyebrow="Premiere Pro" title="一键导入字幕与字体参数" description="上传字幕时间轴，调整字体和样式参数，生成可直接导入 Premiere 的字幕图形 XML 与完整导入包。">
          <StatusPill status={cues.length ? "已通过" : "待配置"}>{cues.length ? `${cues.length} 条字幕` : "等待字幕文件"}</StatusPill>
        </PageHeader>
        <section className="premiere-layout">
          <article className="panel premiere-source-card">
            <div className="panel-heading"><div><span className="eyebrow">字幕时间轴</span><h2>上传字幕文件</h2></div><div className="feature-icon"><UploadSimple size={21} /></div></div>
            <label className="premiere-dropzone">
              <UploadSimple size={25} />
              <strong>{premiereSubtitle.fileName || "选择字幕文件"}</strong>
              <small>支持 SRT、VTT、ASS；文件只在本机解析，不上传到服务端。</small>
              <input type="file" accept=".srt,.vtt,.ass,text/plain,text/vtt" onChange={importPremiereSubtitle} />
            </label>
            <div className="premiere-source-actions">
              <AppButton onClick={generatePremiereSubtitleFromShots} disabled={!projectShots.length}><FilmStrip size={15} /> 从当前分镜台词生成</AppButton>
              <span>{cues.length ? `已识别 ${cues.length} 条，首条从 ${formatSubtitleTime(cues[0].startMs)} 开始` : "也可以直接使用当前项目分镜中的台词"}</span>
            </div>
            {cues.length ? <div className="premiere-cue-list">
              <div className="premiere-cue-head"><span>时间</span><span>字幕内容</span></div>
              {cues.slice(0, 6).map((cue, index) => <div className="premiere-cue-row" key={cue.id || `${cue.startMs}-${index}`}><span>{formatSubtitleTime(cue.startMs)}<br />{formatSubtitleTime(cue.endMs)}</span><strong>{cue.text}</strong></div>)}
              {cues.length > 6 && <small>仅预览前 6 条，导出时会包含全部字幕。</small>}
            </div> : <div className="premiere-empty"><FileText size={22} /><strong>还没有字幕时间轴</strong><span>上传文件或从分镜台词生成后，这里会显示字幕预览。</span></div>}
          </article>
          <article className="panel premiere-settings-card">
            <div className="panel-heading"><div><span className="eyebrow">样式预设</span><h2>字体与导入参数</h2></div><span className="soft-label">可随时调整</span></div>
            <Field label="加载已保存预设" full><select defaultValue="" onChange={usePremierePreset}><option value="">选择参数预设</option>{premierePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field>
            <div className="form-grid">
              <Field label="序列名称"><input value={settings.sequenceName} onChange={(event) => updatePremiereSettings({ sequenceName: event.target.value })} placeholder={currentProject.name} /></Field>
              <Field label="帧率"><select value={settings.frameRate} onChange={(event) => updatePremiereSettings({ frameRate: Number(event.target.value) })}>{[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((item) => <option value={item} key={item}>{item} fps</option>)}</select></Field>
              <Field label="画面宽度"><input type="number" min="320" value={settings.width} onChange={(event) => updatePremiereSettings({ width: Number(event.target.value) })} /></Field>
              <Field label="画面高度"><input type="number" min="240" value={settings.height} onChange={(event) => updatePremiereSettings({ height: Number(event.target.value) })} /></Field>
              <Field label="字幕画幅"><div className="segmented-control"><button type="button" className={settings.orientation === "landscape" ? "active" : ""} onClick={() => applyPremiereOrientation("landscape")}>横版 16:9</button><button type="button" className={settings.orientation === "portrait" ? "active" : ""} onClick={() => applyPremiereOrientation("portrait")}>竖版 9:16</button></div></Field>
              <Field label="字体名称"><input value={settings.fontName} onChange={(event) => updatePremiereSettings({ fontName: event.target.value })} placeholder="例如：阿里妈妈方圆体 VF" /></Field>
              <Field label="字重"><select value={settings.fontWeight} onChange={(event) => updatePremiereSettings({ fontWeight: Number(event.target.value) })}><option value="300">Light</option><option value="400">Regular</option><option value="500">Medium</option><option value="600">SemiBold</option><option value="700">Bold</option></select></Field>
              <Field label="字号"><input type="number" min="8" max="300" value={settings.fontSize} onChange={(event) => updatePremiereSettings({ fontSize: Number(event.target.value) })} /></Field>
              <Field label="文字颜色"><input type="color" value={settings.textColor} onChange={(event) => updatePremiereSettings({ textColor: event.target.value })} /></Field>
              <Field label="描边颜色"><input type="color" value={settings.strokeColor} onChange={(event) => updatePremiereSettings({ strokeColor: event.target.value })} /></Field>
              <Field label="描边宽度"><input type="number" min="0" max="20" step="0.1" value={settings.strokeWidth} onChange={(event) => updatePremiereSettings({ strokeWidth: Number(event.target.value) })} /></Field>
              <Field label="阴影距离"><input type="number" min="0" max="20" step="0.1" value={settings.shadowWidth} onChange={(event) => updatePremiereSettings({ shadowWidth: Number(event.target.value) })} /></Field>
              <Field label="阴影透明度"><input type="number" min="0" max="100" value={settings.shadowOpacity} onChange={(event) => updatePremiereSettings({ shadowOpacity: Number(event.target.value) })} /></Field>
              <Field label="水平位置"><input type="number" min="0" max="100" value={settings.horizontalPosition} onChange={(event) => updatePremiereSettings({ horizontalPosition: Number(event.target.value) })} /></Field>
              <Field label="垂直位置"><input type="number" min="0" max="100" value={settings.verticalPosition} onChange={(event) => updatePremiereSettings({ verticalPosition: Number(event.target.value) })} /></Field>
              <Field label="对齐方式"><select value={settings.alignment} onChange={(event) => updatePremiereSettings({ alignment: event.target.value })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></Field>
              <Field label="背景透明度"><input type="number" min="0" max="100" value={settings.backgroundOpacity} onChange={(event) => updatePremiereSettings({ backgroundOpacity: Number(event.target.value) })} /></Field>
              <Field label="背景颜色"><input type="color" value={settings.backgroundColor} onChange={(event) => updatePremiereSettings({ backgroundColor: event.target.value })} /></Field>
              <Field label="PR 文字样式文件" full><input type="file" accept=".prtextstyle,.xml,application/xml,text/xml" onChange={importPremiereTextStyle} /><small className="field-inline-note">公开源码不内置客户样式文件。上传你有权使用的 PR 样式后，系统读取可识别参数并在导出包中保留原文件。</small></Field>
              {premiereTextStyleMeta && <div className="premiere-style-summary field-full"><strong>{premiereTextStyleMeta.styleName}</strong><span>{premiereTextStyleMeta.fontName || "字体字段未识别"}</span><small>{premiereTextStyleMeta.recognizedFields.join("、")}{premiereTextStyleMeta.legacyCanvas ? ` · 原样式画布 ${premiereTextStyleMeta.legacyCanvas.width} × ${premiereTextStyleMeta.legacyCanvas.height}` : ""}</small></div>}
              <Field label="字幕字体文件（PR 导出自动附带）" full><input type="file" accept=".ttf,.otf,.ttc,font/ttf,font/otf" onChange={(event) => setPremiereFontFile(event.currentTarget.files?.[0] || null)} /><small className="field-inline-note">公开源码不内置客户字体。上传你有权使用的字体后，可随 PR 导入包附带；视频烧录环境还需安装或配置对应字体。</small></Field>
            </div>
            <div className="premiere-preset-actions"><span>{premiereTextStyleFile ? `已载入样式：${premiereTextStyleFile.name}` : premiereFontFile ? `已附带字体：${premiereFontFile.name}` : "未载入 PR 样式文件"}</span><AppButton onClick={savePremierePreset}><Check size={15} /> 保存当前参数</AppButton></div>
          </article>
        </section>
        <section className="premiere-preview-layout">
          <article className="panel premiere-preview-card">
            <div className="panel-heading"><div><span className="eyebrow">实时预览</span><h2>当前字幕样式</h2></div><span className="soft-label">{settings.width} × {settings.height}</span></div>
            <div className="premiere-preview-screen" style={{ aspectRatio: `${settings.width} / ${settings.height}` }}><span style={{ color: settings.textColor, fontFamily: PREMIERE_RENDER_FONT_FAMILY, fontWeight: settings.fontName === PREMIERE_FONT_FAMILY ? 600 : settings.fontWeight, fontSize: `${Math.max(16, Math.min(72, settings.fontSize / 1.5))}px`, textAlign: settings.alignment, left: `${settings.horizontalPosition}%`, top: `${settings.verticalPosition}%`, WebkitTextStroke: `${Math.min(5, settings.strokeWidth / 1.5)}px ${settings.strokeColor}`, textShadow: `${Math.min(5, settings.shadowWidth / 1.5)}px ${Math.min(5, settings.shadowWidth / 1.5)}px 0 ${settings.shadowColor}${Math.round((settings.shadowOpacity / 100) * 255).toString(16).padStart(2, "0")}`, backgroundColor: settings.backgroundOpacity ? `${settings.backgroundColor}${Math.round(settings.backgroundOpacity * 2.55).toString(16).padStart(2, "0")}` : "transparent" }}>{previewCue?.text || "上传字幕后显示预览"}</span></div>
          </article>
          <aside className="panel premiere-export-card"><span className="eyebrow">交付文件</span><h2>一次生成，直接导入</h2><p>导出包包含 XML 字幕图形、原始 SRT、带样式参数的 ASS 和参数 JSON。上传的 PR 样式和字体文件会一并附带。</p><div className="premiere-export-stats"><span><strong>{cues.length}</strong> 条字幕</span><span><strong>{settings.fontName}</strong> 字体</span><span><strong>{settings.frameRate}</strong> 帧率</span></div><AppButton variant="primary" onClick={() => exportPremiere(false)} disabled={!cues.length || premiereBusy}><Package size={15} /> {premiereBusy ? "正在生成" : "一键生成 PR 导入包"}</AppButton><AppButton onClick={() => exportPremiere(true)} disabled={!cues.length || premiereBusy}><DownloadSimple size={15} /> 只下载 XML</AppButton><p className="field-help">导入主文件：<code>01_导入文件/字幕图形.xml</code>。上传的原始样式在 <code>02_参数/原始样式/</code>，字体在 <code>02_字体/</code>。</p></aside>
        </section>
        {renderSubtitleDownloadFallback()}
      </>
    );
  };

  const renderVideoSubtitles = () => {
    const cues = Array.isArray(premiereSubtitle.cues) ? premiereSubtitle.cues : [];
    return <>
          <PageHeader eyebrow="视频处理" title="视频自动字幕" description="SRT 只负责提供文字和基础时间轴；字幕外观统一使用甲方 PR 样式，识别结果按词级时间轴对齐口型后再生成成片。">
        <StatusPill status={subtitleBusy || subtitleRenderBusy ? "处理中" : cues.length ? "已识别" : "待上传"}>{subtitleRenderBusy ? (subtitleRenderStatus || "正在生成成片") : subtitleBusy ? "正在识别" : cues.length ? `${cues.length} 条字幕` : "等待文件"}</StatusPill>
      </PageHeader>
      <section className="video-subtitle-layout">
        <article className="panel video-subtitle-upload">
          <div className="panel-heading"><div><span className="eyebrow">第一步</span><h2>上传视频</h2></div><Microphone size={24} /></div>
          <label className="video-dropzone">
            <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" onChange={chooseSubtitleVideo} />
            <strong>{subtitleVideoFiles.length ? `已选择 ${subtitleVideoFiles.length} 个视频` : "批量选择 MP4 / MOV 视频"}</strong>
            <span>{subtitleVideoFiles.length ? "横版与竖版按视频画幅自动套用参数，字幕一次性导出" : "可以一次选择多个视频，按顺序自动识别"}</span>
          </label>
          <label className="subtitle-file-dropzone">
            <input type="file" multiple accept=".srt,.vtt,.ass,text/vtt,text/plain" onChange={importSubtitleBatchFiles} />
            <strong>已有剪映字幕？批量导入 SRT</strong>
            <span>先选视频，再选同名 SRT，自动匹配后直接生成成片</span>
          </label>
          {subtitleVideoUrl && <video className="video-subtitle-preview" controls src={subtitleVideoUrl} />}
          {!!subtitleBatchItems.length && <div className="video-subtitle-batch-count">视频 {subtitleBatchItems.filter((item) => item.videoFile).length} 个 · 已匹配字幕 {subtitleBatchItems.filter((item) => item.videoFile && item.cues?.length).length} 个 · 待补字幕 {subtitleBatchItems.filter((item) => item.videoFile && !item.cues?.length).length} 个 · 成片沿用视频原名</div>}
          {!!subtitleBatchItems.length && <div className="video-subtitle-batch-list">{subtitleBatchItems.map((item) => <button className={item.id === selectedSubtitleBatchId ? "active" : ""} key={item.id} onClick={() => selectSubtitleBatchItem(item)}><span>{item.fileName}</span><small>{item.renderState === "saved" ? "成片已保存" : item.renderState === "failed" ? `烧录失败：${item.renderError}` : item.status}{item.cues?.length ? ` · ${item.cues.length} 条` : ""}</small></button>)}</div>}
          {!!subtitleImportIssues.length && <p className="field-help subtitle-batch-warning">未找到对应视频的字幕：{subtitleImportIssues.join("、")}</p>}
          <div className="video-subtitle-controls"><Field label="语言"><select value={subtitleLanguage} onChange={(event) => setSubtitleLanguage(event.target.value)}><option value="zh">中文</option><option value="auto">自动识别</option><option value="en">English</option></select></Field><AppButton variant="primary" onClick={transcribeUploadedVideo} disabled={!subtitleVideoFiles.length || subtitleBusy}><Microphone size={15} /> {subtitleBusy ? "批量识别中" : "批量识别并生成字幕"}</AppButton></div>
          <p className="field-help">识别在当前配置的本地服务中完成，并保留词级时间点；未配置语音识别模型时，页面会提示配置，不会生成虚假字幕。</p>
        </article>
        <article className="panel video-subtitle-style">
          <div className="panel-heading"><div><span className="eyebrow">第二步</span><h2>字幕样式</h2></div><FileText size={24} /></div>
          <div className="video-style-default"><strong>{premiereTextStyleMeta?.styleName || "当前字幕参数"}</strong><span>{premiereTextStyleMeta?.fontName || premiereSettings.fontName}</span><small>批量导出自动识别方向并锁定画布：横版 1882×1080、竖版 1080×1882；横版 {PREMIERE_ORIENTATION_PRESETS.landscape.fontSize} 号、竖版 {PREMIERE_ORIENTATION_PRESETS.portrait.fontSize} 号 · 高码率 H.264 · 长句保持单行并按时间连续显示</small></div>
          <Field label="更换 PR 样式文件"><input type="file" accept=".prtextstyle,.xml,application/xml,text/xml" onChange={importPremiereTextStyle} /><small className="field-inline-note">可上传截图中的 `prtextstyle` 文件；软件已内置 pr字幕样式。</small></Field>
          <Field label="附加参考文件"><input type="file" multiple accept=".preset,image/png,image/jpeg,.jpg,.png" onChange={importSubtitleReferenceFiles} /><small className="field-inline-note">`.preset` 和参考 PNG 会随本次字幕配置保留，便于后续继续套用。</small></Field>
          {!!subtitleReferenceFiles.length && <div className="video-reference-list">{subtitleReferenceFiles.map((file) => <span key={`${file.name}-${file.lastModified}`}>{file.name}</span>)}</div>}
          <AppButton onClick={() => navigate("premiere")}><FileText size={15} /> 打开字幕参数</AppButton>
        </article>
      </section>
      <section className="panel video-subtitle-result">
          <div className="panel-heading"><div><span className="eyebrow">第三步</span><h2>校对并导出成片</h2></div><div className="premiere-source-actions"><AppButton onClick={() => downloadSubtitleSrt(currentProject || { name: premiereSubtitle.fileName?.replace(/\.[^.]+$/, "") || "视频字幕" }, cues, { onReady: setSubtitleDownload })} disabled={!cues.length || premiereBusy}><DownloadSimple size={15} /> 当前 SRT</AppButton><AppButton onClick={exportSubtitleSrtBatch} disabled={!subtitleBatchItems.some((item) => item.cues?.length) || premiereBusy || subtitleRenderBusy}><Package size={15} /> 批量下载 SRT</AppButton><AppButton onClick={exportSubtitleBatch} disabled={!subtitleBatchItems.some((item) => item.cues?.length) || premiereBusy || subtitleRenderBusy}><Package size={15} /> 导出 PR 包（含字体）</AppButton><AppButton variant="primary" onClick={exportSubtitleVideos} disabled={premiereBusy || subtitleRenderBusy}><FilmStrip size={15} /> {subtitleRenderBusy ? "正在生成成片" : subtitleExportSession && subtitleBatchItems.some((item) => item.renderState === "saved") && subtitleBatchItems.some((item) => item.renderState === "failed") ? "重试未完成" : "选择位置并导出成片"}</AppButton></div></div>
        {subtitleRenderStatus && <p className="video-subtitle-progress" role="status">{subtitleRenderStatus}</p>}
        {subtitleRenderSummary && <div className="video-subtitle-summary" role="status"><strong>已保存 {subtitleRenderSummary.saved}/{subtitleRenderSummary.total} 集</strong>{subtitleRenderSummary.directory && <span>保存位置：{subtitleRenderSummary.directory}</span>}{subtitleRenderSummary.failures?.length > 0 && <span>待处理：{subtitleRenderSummary.failures.map((item) => `${item.name}（${item.error}）`).join("、")}</span>}{subtitleExportSession?.kind === "desktop" && <AppButton onClick={async () => { try { await window.hjscDesktop.openSubtitleExportFolder(subtitleExportSession.id); } catch (error) { notify(error.message || "无法打开文件夹"); } }}><Folder size={15} /> 打开保存文件夹</AppButton>}</div>}
        {cues.length ? <div className="video-subtitle-cue-editor">{cues.map((cue, index) => <label key={cue.id || index}><span>{formatSubtitleTime(cue.startMs)}<br />{formatSubtitleTime(cue.endMs)}</span><textarea value={cue.text} onChange={(event) => updateSelectedSubtitleCue(index, event.target.value)} /></label>)}</div> : <div className="premiere-empty"><Microphone size={22} /><strong>识别结果会显示在这里</strong><span>批量识别完成后，点击左侧视频可切换并逐条校对。</span></div>}
      </section>
      {renderSubtitleDownloadFallback()}
    </>;
  };

  const doExport = async (type) => {
    const {
      exportAssetPackage,
      exportAssetsExcel,
      exportPrompts,
      exportShotlist,
      exportShotsExcel,
    } = await import("./downloads.js");
    if (type === "prompts") exportPrompts(currentProject, projectAssets, projectShots);
    if (type === "assets") exportAssetsExcel(currentProject, projectAssets);
    if (type === "shots") exportShotsExcel(currentProject, projectShots);
    if (type === "shotlist") exportShotlist(currentProject, projectShots);
    if (type === "zip") await exportAssetPackage(currentProject, projectAssets, projectShots, projectTasks);
    recordActivity("导出项目文件", currentProject.name, "已完成");
    notify("导出文件已生成");
  };

  const renderExport = () => {
    const exports = [
      { id: "prompts", title: "全部提示词", format: "文本文件", note: "资产提示词、静帧提示词和视频提示词。", icon: FileText },
      { id: "assets", title: "资产清单", format: "表格文件", note: "资产类型、版本、状态、文件名和使用备注。", icon: Archive },
      { id: "shots", title: "镜头表", format: "表格文件", note: "完整镜头字段、绑定资产和提示词。", icon: List },
      { id: "shotlist", title: "镜头表网页", format: "网页文件", note: "可直接在浏览器打开或发送给制作团队。", icon: FilmStrip },
      { id: "zip", title: "项目资产包", format: "压缩文件", note: "一次打包项目说明、表格、提示词和审核结果。", icon: Package },
      { id: "premiere", title: "PR 字幕导入包", format: "ZIP + XML", note: "字幕、字体和样式参数一次整理，直接导入 Premiere。", icon: FileText },
    ];
    return <><PageHeader eyebrow="导出" title="项目导出" description="项目文件和 Premiere 字幕导入都从这里进入。"><StatusPill status="已通过">项目数据已就绪</StatusPill></PageHeader><section className="export-grid">{exports.map((item) => { const Icon = item.icon; const premiere = item.id === "premiere"; return <article className="export-card panel" key={item.id}><div className="export-icon"><Icon size={22} /></div><div><span className="format-label">{item.format}</span><h2>{item.title}</h2><p>{item.note}</p></div><AppButton variant={item.id === "zip" || premiere ? "primary" : "secondary"} onClick={() => premiere ? navigate("premiere") : doExport(item.id)}><DownloadSimple size={15} /> {premiere ? "打开配置" : `导出 ${item.format}`}</AppButton></article>; })}</section><section className="export-summary panel"><div><span className="eyebrow">导出摘要</span><h2>{currentProject.name} · 本次导出范围</h2></div><div><strong>{projectAssets.length}</strong><span>资产</span></div><div><strong>{projectShots.length}</strong><span>镜头</span></div><div><strong>{projectTasks.filter((item) => item.status === "已通过" || item.status === "已完成").length}</strong><span>已选结果</span></div></section></>;
  };

  const renderPage = () => {
    if (activePage === "quick") return renderQuick();
    if (activePage === "dashboard") return renderDashboard();
    if (activePage === "pipeline") return renderPipeline();
    if (activePage === "wedding") return renderWedding();
    if (activePage === "projects") return renderProjects();
    if (activePage === "skills") return renderSkills();
    if (activePage === "assets") return renderAssets();
    if (activePage === "queue") return renderQueue();
    if (activePage === "shots") return renderShots();
    if (activePage === "export") return renderExport();
    if (activePage === "premiere") return renderPremiere();
    if (activePage === "video-subtitles") return renderVideoSubtitles();
    if (activePage === "editing") return <EditingStudio currentProject={currentProject} notify={notify} recordActivity={recordActivity} />;
    return renderDashboard();
  };

  return (
    <>
      {projectContextBar}
      {renderPage()}

      {searchOpen && <div className="overlay" onMouseDown={() => setSearchOpen(false)}><section className="search-modal" onMouseDown={(event) => event.stopPropagation()}><div className="search-box"><MagnifyingGlass size={18} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索资产、任务、镜头或制作规范…" /><button onClick={() => setSearchOpen(false)}>关闭</button></div><div className="search-results"><span className="eyebrow">结果</span>{searchResults.map((result) => <button key={`${result.title}-${result.meta}`} onClick={() => { if (result.id) setSelectedTaskId(result.id); navigate(result.page); setSearchOpen(false); }}><span><strong>{result.title}</strong><small>{result.meta}</small></span><ArrowRight size={14} /></button>)}</div></section></div>}

      {projectModalNode}
      {modal?.type === "asset" && <Modal title="新建资产" eyebrow="资产" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createAsset}><Field label="资产名称"><input name="name" required placeholder="请输入资产名称" /></Field><Field label="资产类型"><select name="type"><option value="image">图片</option><option value="character">人物</option><option value="costume">服装</option><option value="scene">场景</option><option value="prop">道具</option><option value="extras">群演</option><option value="storyboard">分镜静帧</option><option value="video">视频提示词</option><option value="shotlist">镜头表</option><option value="workflow">制作记录</option><option value="document">文档</option></select></Field><Field label="保存到文件夹" full><select name="folderName" defaultValue={openFolder || ""}><option value="">按资产类型自动归类</option>{projectAssetFolderNames.map((name) => <option key={name}>{name}</option>)}</select></Field><Field label="提示词" full><textarea name="prompt" placeholder="可选：填写实际提示词或制作要求" /></Field><Field label="备注" full><input name="notes" placeholder="填写使用范围与一致性要求" /></Field><AppButton variant="primary" className="field-full" type="submit">保存资产</AppButton></form></Modal>}
      {modal?.type === "folder" && <Modal title="新建资产文件夹" eyebrow="资产分类" onClose={() => setModal(null)}><form className="form-grid" onSubmit={createFolder}><Field label="文件夹名称" full><input name="name" required placeholder="例如：人物资产、剧本、场景资产" /></Field><AppButton variant="primary" className="field-full" type="submit">创建文件夹</AppButton></form></Modal>}
      {modal?.type === "upload" && <Modal title="上传文件资产" eyebrow="文件资产" onClose={() => setModal(null)}><form className="form-grid" onSubmit={uploadAssetImage}><Field label="关联资产"><select name="assetId" required><option value="">请选择资产</option>{projectAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.typeLabel}</option>)}</select></Field><Field label="文件类型"><select name="kind"><option>原图</option><option>高清图</option><option>预览图</option><option>PDF文档</option><option>规范文档</option></select></Field><Field label="上传文件" full><input name="file" required type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/markdown,text/plain,.pdf,.md" /></Field><p className="field-help field-full">支持图片、PDF 和 MD 原文件。文件会直接保存到服务器并同步给有权限的管理员和平台运营端。</p><AppButton variant="primary" className="field-full" type="submit">上传并归档</AppButton></form></Modal>}
      {modal?.type === "task" && <Modal title="加入生图队列" eyebrow="生图任务" wide onClose={() => setModal(null)}><form className="form-grid" onSubmit={createImageTask}><Field label="任务名称"><input name="name" required placeholder="请输入任务名称" /></Field><Field label="关联资产"><select name="assetId"><option value="">暂不关联</option>{projectAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></Field><Field label="类型"><select name="type"><option>人物</option><option>服装</option><option>场景</option><option>道具</option><option>群演</option><option>分镜静帧</option></select></Field><Field label="画幅"><select name="ratio"><option>3:4</option><option>16:9</option><option>9:16</option><option>1:1</option></select></Field><Field label="生成平台"><input name="provider" placeholder="等待配置" /></Field><Field label="模型名称"><input name="modelName" placeholder="等待配置" /></Field><Field label="风格"><input name="style" defaultValue={currentProject?.style} placeholder="请输入风格" /></Field><Field label="随机种子"><input name="seed" placeholder="可留空" /></Field><Field label="提示词" full><textarea name="prompt" required placeholder="输入本次生图使用的实际提示词" /></Field><Field label="负面提示词" full><textarea name="negativePrompt" placeholder="输入不希望出现的内容，可留空" /></Field><p className="field-help field-full">任务会进入后端队列；真实生成服务未配置前，不会伪造结果图。</p><AppButton variant="primary" className="field-full" type="submit">加入队列</AppButton></form></Modal>}
      {modal?.type === "shot" && <Modal title="新建镜头" eyebrow="分镜" wide onClose={() => setModal(null)}><form className="form-grid" onSubmit={createShot}><Field label="镜头编号"><input name="number" required placeholder="请输入镜头编号" /></Field><Field label="所属场景"><input name="sceneName" required placeholder="请输入所属场景" /></Field><Field label="时长"><input name="duration" required placeholder="请输入镜头时长" /></Field><Field label="景别"><input name="shotSize" required placeholder="请输入景别" /></Field><Field label="机位"><input name="camera" required placeholder="请输入机位与运镜" /></Field><Field label="人物"><input name="characters" placeholder="填写镜头人物" /></Field><div className="asset-bind-picker field-full"><div className="asset-bind-picker-heading"><span>绑定本镜头需要的已通过资产</span><small>只选本镜头会出现的资产，不再自动绑定整个项目。</small></div>{approvedAssets.length ? <div className="asset-bind-picker-list">{approvedAssets.map((asset) => <label key={asset.id}><input name="assetIds" type="checkbox" value={asset.id} /><span><strong>{asset.name}</strong><small>{asset.typeLabel || asset.type} · 第 {asset.version || 1} 版 · 已通过</small></span></label>)}</div> : <p className="field-help">当前还没有已通过资产，镜头可以先创建，之后再补齐资产。</p>}</div><Field label="动作" full><textarea name="action" required /></Field><Field label="台词" full><input name="dialogue" placeholder="无" /></Field><Field label="静帧提示词" full><textarea name="stillPrompt" required /></Field><Field label="视频提示词" full><textarea name="videoPrompt" required /></Field><AppButton variant="primary" className="field-full" type="submit">创建镜头</AppButton></form></Modal>}
      {modal?.type === "h3-video" && <Modal title="提交 H3 有声视频" eyebrow={`镜头 ${modal.shot.number}`} wide onClose={() => setModal(null)}><form className="form-grid" onSubmit={createH3VideoTask}><Field label="任务名称" full><input name="name" required defaultValue={`镜头 ${modal.shot.number} · ${modal.shot.sceneName}`} /></Field><Field label="画幅"><select name="ratio" defaultValue={currentProject.aspectRatio || "16:9"}>{ASPECT_RATIO_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="时长"><select name="durationSeconds" defaultValue={Math.max(4, Math.min(15, Number(String(modal.shot.duration || "5").match(/[\d.]+/)?.[0]) || 5))}>{Array.from({ length: 12 }, (_, index) => index + 4).map((seconds) => <option value={seconds} key={seconds}>{seconds} 秒</option>)}</select></Field><Field label="随机种子" full><input name="seed" inputMode="numeric" placeholder="可留空" /></Field><Field label="视频提示词" full><textarea name="prompt" required defaultValue={modal.shot.videoPrompt} /></Field><p className="field-help field-full">当前连接：{h3Connection.status}。提交后会进入真实云端队列，完成的 MP4 含画面与同步立体声，并自动保存到本机。</p>{h3Connection.status !== "已连接" && <AppButton className="field-full" type="button" onClick={() => { setModal(null); navigate("h3"); }}><CloudCheck size={15} /> 先配置云显卡连接</AppButton>}<AppButton variant="primary" className="field-full" type="submit" disabled={h3Connection.status !== "已连接"}><CloudArrowUp size={15} /> 提交到云显卡</AppButton></form></Modal>}
      {modal?.type === "hd" && <Modal title="高清定稿" eyebrow="定稿" wide onClose={() => setModal(null)}><div className="hd-preview"><img src={modal.result.full} alt="高清定稿预览" /><div><StatusPill status="高清定稿" /><h3>{modal.task.name}</h3><p>将所选草图作为母版输出高清版本。通过后不会覆盖旧版本，只会新增文件。</p><dl><div><dt>文件名</dt><dd>{modal.task.name}_定稿图.png</dd></div><div><dt>原图</dt><dd>高清图片</dd></div><div><dt>缩略图</dt><dd>宽度 512 像素</dd></div></dl><AppButton variant="primary" onClick={() => { setModal(null); notify("高清定稿任务已完成"); }}>确认定稿</AppButton></div></div></Modal>}
    </>
  );
}
