import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "skill-sources");
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".skill"]);

function extensionOf(filePath) {
  const match = String(filePath).match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

function collectFiles(targetPath) {
  if (!existsSync(targetPath)) return [];
  if (basename(targetPath).startsWith("._")) return [];
  const stat = statSync(targetPath);
  if (stat.isFile()) return [targetPath];
  return readdirSync(targetPath)
    .flatMap((entry) => collectFiles(join(targetPath, entry)))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sourceBundle(targetPath) {
  const files = collectFiles(join(sourceDir, targetPath));
  const manifest = files.map((filePath) => ({
    path: relative(sourceDir, filePath),
    size: statSync(filePath).size,
  }));
  const content = files
    .filter((filePath) => TEXT_EXTENSIONS.has(extensionOf(filePath)))
    .map((filePath) => {
      const path = relative(sourceDir, filePath);
      return `# 文件：${path}\n\n${readFileSync(filePath, "utf8")}`;
    })
    .join("\n\n---\n\n");
  return { sourceContent: content, sourceFiles: manifest };
}

function withSource(template, targetPath) {
  return { ...template, ...sourceBundle(targetPath) };
}

export const DEFAULT_SKILL_TEMPLATES = [
  withSource({
    key: "image_prompt_director",
    name: "图片提示词导演",
    type: "image",
    description: "把人物、场景、道具或海报需求整理成可直接投喂的图片生成指令。",
    assetTypeLabel: "图片",
    recommendedRatio: "16:9",
    checklist: ["项目上下文完整", "主体与画幅明确", "输出格式可直接复制"],
  }, "image-prompt-director-single-file.md"),
  withSource({
    key: "wedding_image",
    name: "婚礼影像生图规范",
    type: "image",
    description: "把新人真实资料、婚礼场景和分镜要求整理成可批量生成并可复用的婚礼画面指令。",
    assetTypeLabel: "分镜静帧",
    recommendedRatio: "16:9",
    checklist: ["新人事实与隐私边界明确", "人物、服装和场地可连续复用", "重点分镜先定调，再批量生图"],
  }, "wedding-image-prompt.md"),
  withSource({
    key: "seedance_video_prompt",
    name: "视频提示词导演",
    type: "video",
    description: "把锁定资产和镜头动作整理成视频生成提示词。",
    assetTypeLabel: "视频提示词",
    recommendedRatio: "16:9",
    checklist: ["引用资产清晰", "时长与运镜明确", "不包含字幕水印要求"],
  }, "seedance-suite/SKILL.md"),
  withSource({
    key: "shotlist_builder",
    name: "镜头表生成器",
    type: "shotlist",
    description: "把剧本或段落拆成镜头表、资产需求和镜头提示词。",
    assetTypeLabel: "镜头表",
    recommendedRatio: "16:9",
    checklist: ["场次与镜头编号清晰", "资产需求可追溯", "镜头提示词可复制"],
  }, "shotlist-builder"),
  withSource({
    key: "aigc_pipeline",
    name: "全流程制作梳理",
    type: "workflow",
    description: "把项目需求拆成剧本、资产、分镜、视频和交付步骤。",
    assetTypeLabel: "制作记录",
    recommendedRatio: "",
    checklist: ["流程阶段清楚", "资产归档明确", "下一步动作可执行"],
  }, "jsy-fenjue/鎏光智绘AI影视剧制作SOP.md"),
  withSource({ key: "automation_script", name: "自动流程 · 剧本改编", type: "script", description: "从真实输入出发组织故事骨架、改编策略和单集剧本任务。", assetTypeLabel: "制作记录", recommendedRatio: "" }, "automation-workflow/script_agent_decision.md"),
  withSource({ key: "automation_director", name: "自动流程 · 导演规划", type: "workflow", description: "按场次整理台词、情绪、过渡和制作注意事项。", assetTypeLabel: "制作记录", recommendedRatio: "" }, "automation-workflow/production_execution_director_plan.md"),
  withSource({ key: "automation_storyboard", name: "自动流程 · 分镜表", type: "shotlist", description: "把剧本整理为可进入分镜面板的镜头表。", assetTypeLabel: "镜头表", recommendedRatio: "9:16" }, "automation-workflow/production_execution_storyboard_table.md"),
  withSource({ key: "automation_review", name: "自动流程 · 分镜质检", type: "workflow", description: "按红线和审核维度检查分镜产出，只提出问题和建议。", assetTypeLabel: "制作记录", recommendedRatio: "" }, "automation-workflow/production_agent_supervision.md"),
  withSource({ key: "seedance_suite", name: "视频连续性与交付规范", type: "video", description: "覆盖镜头语言、连续性、参考图、声音、字幕和交付质检。", assetTypeLabel: "视频提示词", recommendedRatio: "16:9" }, "seedance-suite/SKILL.md"),
  withSource({ key: "script_doctor", name: "剧本检查规范", type: "script", description: "统一检查结构、人物动机、节奏与冲突。", assetTypeLabel: "制作记录", recommendedRatio: "" }, "jsy-expanded/script-revision/script-revision"),
  withSource({ key: "character_asset", name: "人物资产规范", type: "character", description: "记录人物身份、外形与一致性要求。", assetTypeLabel: "人物", recommendedRatio: "3:4" }, "jsy-fenjue/人物提示词SKILL.md"),
  withSource({ key: "costume_asset", name: "服装资产规范", type: "costume", description: "记录人物、场次、年代与服装要求。", assetTypeLabel: "服装", recommendedRatio: "3:4" }, "jsy-fenjue/服装提示词SKILL.md"),
  withSource({ key: "scene_asset", name: "场景资产规范", type: "scene", description: "记录场景空间、材质与光线要求。", assetTypeLabel: "场景", recommendedRatio: "16:9" }, "jsy-expanded/scene-prompt/scene-prompt-generator"),
  withSource({ key: "prop_asset", name: "道具资产规范", type: "prop", description: "记录关键道具的材质、年代和状态。", assetTypeLabel: "道具", recommendedRatio: "1:1" }, "jsy-fenjue/道具提示词SKILL.md"),
  withSource({ key: "extras_asset", name: "群演资产规范", type: "extras", description: "记录群演构成、服装和行为分布。", assetTypeLabel: "群演", recommendedRatio: "16:9" }, "jsy-fenjue/群演提示词SKILL.md"),
  withSource({ key: "storyboard_still", name: "分镜静帧规范", type: "storyboard", description: "基于已锁定资产整理镜头静帧要求。", assetTypeLabel: "分镜静帧", recommendedRatio: "16:9" }, "jsy-expanded/storyboard-master/storyboard-master"),
  withSource({ key: "video_prompt", name: "视频提示词规范", type: "video", description: "记录动作、运镜、时长和连续性要求。", assetTypeLabel: "视频提示词", recommendedRatio: "16:9" }, "video-prompt-standalone"),
  withSource({ key: "shotlist", name: "镜头表规范", type: "shotlist", description: "统一拍摄顺序、景别、机位与时长字段。", assetTypeLabel: "制作记录", recommendedRatio: "" }, "shotlist-builder"),
  withSource({ key: "image_prompt", name: "生图提示词规范", type: "image", description: "把制作需求整理为统一的生图提示词。", assetTypeLabel: "图片", recommendedRatio: "" }, "image-prompt-director-single-file.md"),
];
