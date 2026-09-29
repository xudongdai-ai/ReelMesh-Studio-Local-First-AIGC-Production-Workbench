import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSubtitleExportSession, getSubtitleExportDirectory } from "./server/transcription.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let stopLocalServer = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function installChineseMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "ReelMesh Studio",
      submenu: [
        { role: "about", label: "关于ReelMesh Studio" },
        { type: "separator" },
        { role: "hide", label: "隐藏ReelMesh Studio" },
        { role: "hideOthers", label: "隐藏其他应用" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出ReelMesh Studio" },
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

function installDownloadHandler() {
  app.on("web-contents-created", (_event, contents) => {
    contents.session.on("will-download", (_downloadEvent, item) => {
      const fileName = item.getFilename() || "ReelMesh Studio导出文件";
      item.setSavePath(path.join(app.getPath("desktop"), fileName));
    });
  });
}

function installSubtitleExportHandlers() {
  ipcMain.handle("subtitle:choose-export-folder", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const selection = await dialog.showOpenDialog(window, {
      title: "选择成片保存位置",
      defaultPath: app.getPath("desktop"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return createSubtitleExportSession(selection.filePaths[0]);
  });
  ipcMain.handle("subtitle:open-export-folder", async (_event, id) => {
    const directory = getSubtitleExportDirectory(id);
    if (!directory) throw new Error("保存位置已失效");
    return shell.openPath(directory);
  });
}

async function startLocalServer() {
  process.env.HJSC_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.HJSC_API_HOST = "127.0.0.1";
  process.env.HJSC_API_PORT = "8787";
  process.env.HJSC_ALLOW_LOOPBACK_H3 = "1";
  process.env.HJSC_LOCAL_ACCESS = "1";
  process.env.HJSC_WHISPER_MODEL = path.join(process.resourcesPath, "models", "ggml-base.bin");
  process.env.HJSC_SUBTITLE_FONT_DIR = path.join(process.resourcesPath, "fonts");
  if (process.platform === "win32") {
    process.env.HJSC_FFMPEG = path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
    process.env.HJSC_WHISPER_CLI = path.join(process.resourcesPath, "whisper", "whisper.exe");
  } else {
    process.env.HJSC_WHISPER_CLI = "/opt/homebrew/bin/whisper-cli";
  }
  const serverModule = await import("./server/index.mjs");
  await serverModule.startServer();
  stopLocalServer = serverModule.stopServer;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 907,
    minHeight: 647,
    show: false,
    backgroundColor: "#ffffff",
    title: "ReelMesh Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "electron-preload.cjs"),
    },
  });

  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.once("ready-to-show", () => window.show());
  void window.loadFile(path.join(__dirname, "dist", "index.html"), { query: { local: "1" } });
}

app.whenReady().then(async () => {
  installChineseMenu();
  installDownloadHandler();
  installSubtitleExportHandlers();
  try {
    await startLocalServer();
    createWindow();
  } catch (error) {
    console.error("本地服务启动失败", error);
    dialog.showErrorBox("ReelMesh Studio无法启动", `本地数据服务启动失败：${error.message || error}`);
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on("before-quit", () => {
  if (stopLocalServer) void stopLocalServer().catch(() => {});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
