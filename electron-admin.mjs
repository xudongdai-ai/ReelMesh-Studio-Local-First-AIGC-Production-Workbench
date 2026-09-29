import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function installChineseMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "ReelMesh Studio管理端",
      submenu: [
        { role: "about", label: "关于ReelMesh Studio管理端" },
        { type: "separator" },
        { role: "hide", label: "隐藏管理端" },
        { role: "hideOthers", label: "隐藏其他应用" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出管理端" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { role: "front", label: "前置全部窗口" },
      ],
    },
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 907,
    minHeight: 647,
    show: false,
    backgroundColor: "#ffffff",
    title: "ReelMesh Studio管理端",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.once("ready-to-show", () => window.show());
  void window.loadFile(path.join(__dirname, "dist", "admin.html"));
}

app.whenReady().then(() => {
  installChineseMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
