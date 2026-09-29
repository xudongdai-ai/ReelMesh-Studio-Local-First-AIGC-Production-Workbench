module.exports = {
  appId: "com.reelmesh.studio.manager",
  productName: "ReelMesh Studio · 经理端",
  asar: true,
  directories: { output: "release/manager" },
  files: ["dist/**/*", "electron-manager.mjs", "package.json"],
  extraMetadata: { main: "electron-manager.mjs", productName: "ReelMesh Studio · 经理端" },
  mac: { category: "public.app-category.productivity", icon: "build/icon.icns", target: [{ target: "dir", arch: ["arm64"] }] },
};
