import * as XLSX from "xlsx";
import JSZip from "jszip";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function promptsText(project, assets, shots) {
  const assetLines = assets.map((asset) => [
    `## ${asset.name} v${String(asset.version).padStart(2, "0")} · ${asset.status}`,
    `类型：${asset.typeLabel}`,
    `文件：${asset.filename}`,
    `提示词：${asset.prompt}`,
    "",
  ].join("\n"));
  const shotLines = shots.map((shot) => [
    `## 镜头 ${shot.number} · ${shot.sceneName}`,
    `静帧提示词：${shot.stillPrompt}`,
    `视频提示词：${shot.videoPrompt}`,
    "",
  ].join("\n"));
  return [`${project.name} · 全部提示词`, `导出时间：${new Date().toLocaleString("zh-CN")}`, "", "# 资产提示词", ...assetLines, "# 分镜提示词", ...shotLines].join("\n");
}

function assetsRows(assets) {
  return assets.map((asset) => ({
    资产编号: asset.code,
    资产名称: asset.name,
    类型: asset.typeLabel,
    版本: `v${String(asset.version).padStart(2, "0")}`,
    状态: asset.status,
    提示词: asset.prompt,
    文件名: asset.filename,
    备注: asset.notes,
    创建时间: asset.createdAt,
  }));
}

function shotsRows(shots) {
  return shots.map((shot) => ({
    镜头编号: shot.number,
    所属场景: shot.sceneName,
    时长: shot.duration,
    景别: shot.shotSize,
    机位: shot.camera,
    人物: shot.characters.join("、"),
    场景资产: shot.sceneAsset,
    道具: shot.props.join("、"),
    动作: shot.action,
    台词: shot.dialogue,
    静帧提示词: shot.stillPrompt,
    视频提示词: shot.videoPrompt,
    绑定资产: shot.assetIds.join(", "),
    状态: shot.status,
  }));
}

function workbookBytes(sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

function shotlistHtml(project, shots) {
  const rows = shots.map((shot) => `<tr><td>${shot.number}</td><td>${shot.sceneName}</td><td>${shot.duration}</td><td>${shot.shotSize}</td><td>${shot.camera}</td><td>${shot.action}</td><td>${shot.dialogue}</td><td>${shot.status}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${project.name} 镜头表</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;margin:40px;color:#171717}h1{font-size:24px}p{color:#666}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border:1px solid #ddd;text-align:left;font-size:12px;vertical-align:top}th{background:#f2f2f2}</style><body><h1>${project.name} · 镜头表</h1><p>${project.type} · ${project.aspectRatio} · ${project.style}</p><table><thead><tr><th>镜头</th><th>场景</th><th>时长</th><th>景别</th><th>机位</th><th>动作</th><th>台词</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function exportPrompts(project, assets, shots) {
  downloadBlob(new Blob([promptsText(project, assets, shots)], { type: "text/plain;charset=utf-8" }), `${project.name}_全部提示词.txt`);
}

export function exportAssetsExcel(project, assets) {
  downloadBlob(new Blob([workbookBytes("资产清单", assetsRows(assets))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${project.name}_资产清单.xlsx`);
}

export function exportShotsExcel(project, shots) {
  downloadBlob(new Blob([workbookBytes("镜头表", shotsRows(shots))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${project.name}_镜头表.xlsx`);
}

export function exportShotlist(project, shots) {
  downloadBlob(new Blob([shotlistHtml(project, shots)], { type: "text/html;charset=utf-8" }), `${project.name}_镜头表.html`);
}

export async function exportAssetPackage(project, assets, shots, imageTasks) {
  const zip = new JSZip();
  zip.file("README.txt", `${project.name} 项目资产包\n包含资产清单、镜头表、全部提示词、镜头表网页与审核结果。\n生成时间：${new Date().toLocaleString("zh-CN")}`);
  zip.file("manifest.json", JSON.stringify({ project, assets, shots, imageTasks }, null, 2));
  zip.file(`${project.name}_全部提示词.txt`, promptsText(project, assets, shots));
  zip.file(`${project.name}_资产清单.xlsx`, workbookBytes("资产清单", assetsRows(assets)));
  zip.file(`${project.name}_镜头表.xlsx`, workbookBytes("镜头表", shotsRows(shots)));
  zip.file(`${project.name}_镜头表.html`, shotlistHtml(project, shots));

  const selectedImages = imageTasks.flatMap((task) => task.results.filter((result) => result.id === task.selectedResultId).map((result) => ({ task, result })));
  for (const { task, result } of selectedImages) {
    try {
      const response = await fetch(result.full);
      if (response.ok) zip.file(`approved/${task.id}_${result.id}.png`, await response.blob());
    } catch {
      zip.file(`approved/${task.id}_${result.id}.txt`, `原图路径：${result.full}`);
    }
  }

  downloadBlob(await zip.generateAsync({ type: "blob" }), `${project.name}_项目资产包.zip`);
}
