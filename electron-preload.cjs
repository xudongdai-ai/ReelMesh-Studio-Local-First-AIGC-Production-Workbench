const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hjscDesktop", {
  chooseSubtitleExportFolder: () => ipcRenderer.invoke("subtitle:choose-export-folder"),
  openSubtitleExportFolder: (id) => ipcRenderer.invoke("subtitle:open-export-folder", id),
});
