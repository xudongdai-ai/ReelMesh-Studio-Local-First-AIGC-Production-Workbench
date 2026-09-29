import { useEffect, useState } from "react";

export const STORAGE_KEYS = {
  projects: "hjsc.v7.projects",
  assets: "hjsc.v7.assets",
  assetFiles: "hjsc.v7.assetFiles",
  imageTasks: "hjsc.v7.imageTasks",
  shots: "hjsc.v7.shots",
  weddingWorkflows: "hjsc.v7.weddingWorkflows",
  activityLogs: "hjsc.v7.activityLogs",
  skillTemplates: "hjsc.v7.skillTemplates",
  productionSpecs: "hjsc.v7.productionSpecs",
  accounts: "hjsc.v7.accounts",
  organizations: "hjsc.v7.organizations",
  assignments: "hjsc.v7.assignments",
  invitations: "hjsc.v7.invitations",
  currentProject: "hjsc.v7.currentProject",
  currentUser: "hjsc.v7.currentUser",
  currentManager: "hjsc.v7.currentManager",
  currentAdmin: "hjsc.v7.currentAdmin",
  currentDeveloper: "hjsc.v7.currentDeveloper",
  workspaceScale: "hjsc.v7.workspaceScale.comfortable",
  premiereSettings: "hjsc.v7.premiereSettings",
  premiereSubtitle: "hjsc.v7.premiereSubtitle",
  premierePresets: "hjsc.v7.premierePresets",
  editingStudio: "hjsc.v7.editingStudio",
};

const LEGACY_PREFIXES = ["hjsc.v2.", "hjsc.v3.", "hjsc.v4.", "hjsc.v5.", "hjsc.v6.", "hjsc.admin."];
const CLEAN_INSTALL_MARKER = "hjsc.workspace.initialized.0.6";

export function clearLegacyPrototypeData() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => window.localStorage.removeItem(key));
    window.localStorage.setItem(CLEAN_INSTALL_MARKER, "ready");
  } catch {
    // Storage can be unavailable in privacy-restricted browser sessions.
  }
}

export function useStoredState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
