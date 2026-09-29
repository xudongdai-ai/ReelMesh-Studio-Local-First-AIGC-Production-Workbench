module.exports = {
  appId: "com.reelmesh.studio",
  productName: "ReelMesh Studio",
  asar: true,
  asarUnpack: ["**/node_modules/sharp/**", "**/node_modules/@img/**"],
  directories: { output: "release/desktop" },
  files: [
    "dist/**/*",
    "server/**/*",
    "electron-main.mjs",
    "electron-preload.cjs",
    "package.json",
    "node_modules/sharp/**/*",
    "node_modules/@img/**/*",
  ],
  extraResources: [
    { from: "public/music", to: "music" },
    { from: "public/sfx", to: "sfx" },
  ],
  extraMetadata: {
    main: "electron-main.mjs",
    productName: "ReelMesh Studio",
  },
  mac: {
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    target: [{ target: "dir", arch: ["arm64"] }],
  },
};
