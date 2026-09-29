export const SKILLS = [
  { id: "image_prompt_director", name: "图片提示词导演", type: "image", description: "把人物、场景、道具或海报需求整理成可直接投喂的图片生成指令。" },
  { id: "wedding_image", name: "婚礼影像生图规范", type: "image", description: "把新人真实资料、婚礼场景和分镜要求整理成可批量生成并可复用的婚礼画面指令。" },
  { id: "seedance_video_prompt", name: "视频提示词导演", type: "video", description: "把锁定资产和镜头动作整理成视频生成提示词。" },
  { id: "shotlist_builder", name: "镜头表生成器", type: "shotlist", description: "把剧本或段落拆成镜头表、资产需求和镜头提示词。" },
  { id: "aigc_pipeline", name: "全流程制作梳理", type: "workflow", description: "把项目需求拆成剧本、资产、分镜、视频和交付步骤。" },
  { id: "script_doctor", name: "剧本检查规范", type: "script", description: "统一检查结构、人物动机、节奏与冲突。" },
  { id: "character_asset", name: "人物资产规范", type: "character", description: "记录人物身份、外形与一致性要求。" },
  { id: "costume_asset", name: "服装资产规范", type: "costume", description: "记录人物、场次、年代与服装要求。" },
  { id: "scene_asset", name: "场景资产规范", type: "scene", description: "记录场景空间、材质与光线要求。" },
  { id: "prop_asset", name: "道具资产规范", type: "prop", description: "记录关键道具的材质、年代和状态。" },
  { id: "extras_asset", name: "群演资产规范", type: "extras", description: "记录群演构成、服装和行为分布。" },
  { id: "storyboard_still", name: "分镜静帧规范", type: "storyboard", description: "基于已锁定资产整理镜头静帧要求。" },
  { id: "video_prompt", name: "视频提示词规范", type: "video", description: "记录动作、运镜、时长和连续性要求。" },
  { id: "shotlist", name: "镜头表规范", type: "shotlist", description: "统一拍摄顺序、景别、机位与时长字段。" },
  { id: "image_prompt", name: "生图提示词规范", type: "image", description: "把制作需求整理为统一的生图提示词。" },
];

export const SKILL_GROUPS = [
  {
    id: "script",
    index: "01",
    name: "剧本与策划",
    description: "先把剧本、人物动机和项目目标理清。",
    keys: ["aigc_pipeline", "automation_script", "automation_director", "script_doctor"],
  },
  {
    id: "assets",
    index: "02",
    name: "人物与资产",
    description: "建立人物、服装、场景、道具和群演的统一标准。",
    keys: ["character_asset", "costume_asset", "scene_asset", "prop_asset", "extras_asset"],
  },
  {
    id: "image",
    index: "03",
    name: "图片与婚礼",
    description: "把真实要求整理成图片提示词，再批量送入生图队列。",
    keys: ["image_prompt_director", "image_prompt", "wedding_image"],
  },
  {
    id: "storyboard",
    index: "04",
    name: "分镜与镜头",
    description: "把剧本拆成镜头、资产引用和可执行的镜头表。",
    keys: ["shotlist_builder", "automation_storyboard", "storyboard_still", "shotlist"],
  },
  {
    id: "video",
    index: "05",
    name: "视频生成",
    description: "基于已锁定资产组织动作、运镜、连续性和时长。",
    keys: ["seedance_video_prompt", "seedance_suite", "video_prompt"],
  },
  {
    id: "review",
    index: "06",
    name: "质检与交付",
    description: "检查分镜和交付物，确保问题先暴露再进入下一步。",
    keys: ["automation_review"],
  },
];

const SKILL_GROUP_BY_KEY = new Map(SKILL_GROUPS.flatMap((group) => group.keys.map((key) => [key, group])));

export function skillGroupOf(skill) {
  const key = skill?.templateKey || skill?.key || skill?.id || "";
  if (SKILL_GROUP_BY_KEY.has(key)) return SKILL_GROUP_BY_KEY.get(key);
  if (skill?.type === "script" || skill?.type === "workflow") return SKILL_GROUP_BY_KEY.get("aigc_pipeline");
  if (["character", "costume", "scene", "prop", "extras"].includes(skill?.type)) return SKILL_GROUP_BY_KEY.get("character_asset");
  if (skill?.type === "shotlist" || skill?.type === "storyboard") return SKILL_GROUP_BY_KEY.get("shotlist_builder");
  if (skill?.type === "video") return SKILL_GROUP_BY_KEY.get("video_prompt");
  return SKILL_GROUP_BY_KEY.get("image_prompt_director");
}

export const TYPE_LABELS = {
  character: "人物",
  costume: "服装",
  scene: "场景",
  prop: "道具",
  extras: "群演",
  storyboard: "分镜静帧",
  image: "图片",
  video: "视频提示词",
  shotlist: "镜头表",
  workflow: "制作记录",
  script: "制作记录",
  document: "文档",
};

export const STATUS_TONE = {
  "已通过": "approved",
  "已锁版": "approved",
  "已完成": "approved",
  "待审核": "review",
  "待生成": "muted",
  "排队中": "muted",
  "生成中": "working",
  "高清定稿": "working",
  "失败": "danger",
  "已废弃": "danger",
  "编辑中": "muted",
  "待接受": "review",
  "进行中": "working",
  "已取消": "muted",
};

export const WORKFLOW = [
  { id: 1, name: "剧本与规范", note: "剧本检查、制作规范整理", progress: 0 },
  { id: 2, name: "资产生成", note: "人物、服装、场景、道具", progress: 0 },
  { id: 3, name: "四图审核", note: "草图、审核、高清定稿", progress: 0 },
  { id: 4, name: "分镜锁版", note: "绑定已通过资产", progress: 0 },
  { id: 5, name: "导出交付", note: "提示词、表格、资产包", progress: 0 },
];
