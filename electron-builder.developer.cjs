module.exports = {
  appId: "com.reelmesh.studio.developer",
  productName: "ReelMesh Studio · 开发者端",
  asar: true,
  directories: { output: "release/developer" },
  files: ["dist/**/*", "electron-developer.mjs", "package.json"],
  extraMetadata: { main: "electron-developer.mjs", productName: "ReelMesh Studio · 开发者端" },
  mac: { category: "public.app-category.productivity", icon: "build/icon.icns", target: [{ target: "dir", arch: ["arm64"] }] },
};
