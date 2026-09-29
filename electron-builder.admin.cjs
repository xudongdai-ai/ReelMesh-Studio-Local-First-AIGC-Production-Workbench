module.exports = {
  appId: "com.reelmesh.studio.admin",
  productName: "ReelMesh Studio · 管理端",
  asar: true,
  directories: { output: "release/admin" },
  files: ["dist/**/*", "electron-admin.mjs", "package.json"],
  extraMetadata: { main: "electron-admin.mjs", productName: "ReelMesh Studio · 管理端" },
  mac: {
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    target: [{ target: "dir", arch: ["arm64"] }],
  },
};
