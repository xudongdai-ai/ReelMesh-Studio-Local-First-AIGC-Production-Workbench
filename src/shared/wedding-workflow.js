export const WEDDING_STEPS = [
  { id: 1, title: "故事采集", shortTitle: "故事卡", owner: "新人资料", deliverable: "新人故事、关键事实和待核实问题", note: "先把真实经历收齐，后续文案、画面和声音都以这里为依据。" },
  { id: 2, title: "文案写作包", shortTitle: "文案", owner: "制作方审稿", deliverable: "可修改的婚礼旁白初稿", note: "把故事整理成自然口播的完整文案，保留事实，不套用示例剧情。" },
  { id: 3, title: "新人确认文案", shortTitle: "确认", owner: "新人确认", deliverable: "已确认的旁白版本", note: "确认称呼、经历和不愿公开的内容，未确认的版本不进入后续制作。" },
  { id: 4, title: "配音试听", shortTitle: "音色", owner: "制作方试听", deliverable: "音色、情绪和语速选择", note: "用同一段文案试听多个候选，先定声音方向。" },
  { id: 5, title: "完整旁白", shortTitle: "旁白", owner: "制作方试听", deliverable: "完整旁白和实际时长", note: "从头听完，确认读音、停顿、情绪和最终时长。" },
  { id: 6, title: "分镜设计", shortTitle: "分镜", owner: "制作方确认", deliverable: "按旁白安排的镜头计划", note: "根据真实旁白安排画面节奏、人物参考、首帧和动作。" },
  { id: 7, title: "三个重点分镜", shortTitle: "重点生图", owner: "制作方试图", deliverable: "约三个定调镜头的图片任务", note: "先用少量重点镜头校验人物一致性和整体画风，再铺开全部画面。" },
  { id: 8, title: "剩余分镜生图", shortTitle: "批量生图", owner: "制作方审图", deliverable: "其余镜头图片和选版清单", note: "沿用已确认的人物和画风，图片任务直接进入现有生图队列。" },
  { id: 9, title: "图生视频", shortTitle: "视频", owner: "制作方审片", deliverable: "逐镜首帧、动作词和视频片段", note: "以已经选定的分镜图为首帧，逐镜检查人物、动作和衔接。" },
  { id: 10, title: "音乐试听", shortTitle: "音乐", owner: "制作方试听", deliverable: "音乐风格和候选片段", note: "先按故事情绪试听，再决定整条片子的音乐方向。" },
  { id: 11, title: "旁白加音乐试听", shortTitle: "混合试听", owner: "制作方试听", deliverable: "代表性情绪片段", note: "确认旁白和音乐的音量关系、起伏和转折。" },
  { id: 12, title: "完整混音", shortTitle: "混音", owner: "制作方试听", deliverable: "完整声音和独立音轨", note: "保留旁白、音乐等独立材料，便于后续局部修改。" },
  { id: 13, title: "字幕预览", shortTitle: "预览", owner: "制作方审片", deliverable: "带字幕的完整预览", note: "完整观看，检查画面、旁白、字幕、音乐和镜头切换。" },
  { id: 14, title: "正式交付", shortTitle: "交付", owner: "新人验收", deliverable: "成片、字幕和可修改材料", note: "制作方先核对导出文件，再交给新人验收。" },
];

export const EMPTY_WEDDING_WORKFLOW = {
  id: null,
  projectId: null,
  currentStep: 1,
  status: "进行中",
  completedSteps: [],
  notes: {},
  imageTaskIds: [],
  story: {
    coupleNames: "",
    weddingDate: "",
    relationship: "",
    importantMoments: "",
    familyAndFriends: "",
    preferredStyle: "",
    targetDuration: "",
    mustKeep: "",
    mustAvoid: "",
    photosNote: "",
  },
  updatedAt: null,
};

export function emptyWeddingWorkflow(projectId) {
  return {
    ...EMPTY_WEDDING_WORKFLOW,
    projectId,
    story: { ...EMPTY_WEDDING_WORKFLOW.story },
    notes: {},
    completedSteps: [],
    imageTaskIds: [],
  };
}

export function normalizeWeddingWorkflow(value, projectId) {
  const base = emptyWeddingWorkflow(projectId);
  const source = value || {};
  return {
    ...base,
    ...source,
    projectId: source.projectId || projectId,
    currentStep: Math.min(WEDDING_STEPS.length, Math.max(1, Number(source.currentStep) || 1)),
    completedSteps: Array.isArray(source.completedSteps) ? source.completedSteps.map(Number).filter((id) => id >= 1 && id <= WEDDING_STEPS.length) : [],
    notes: source.notes && typeof source.notes === "object" ? source.notes : {},
    imageTaskIds: Array.isArray(source.imageTaskIds) ? source.imageTaskIds : [],
    story: { ...base.story, ...(source.story && typeof source.story === "object" ? source.story : {}) },
  };
}

export function weddingProgress(workflow) {
  return Math.round((new Set(workflow?.completedSteps || []).size / WEDDING_STEPS.length) * 100);
}

export function weddingStepIsComplete(workflow, stepId) {
  return (workflow?.completedSteps || []).includes(stepId);
}

