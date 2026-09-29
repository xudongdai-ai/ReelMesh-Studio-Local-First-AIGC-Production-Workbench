module.exports = {
  appId: "com.reelmesh.studio.user",
  productName: "ReelMesh Studio · 用户端",
  asar: true,
  directories: { output: "release/user" },
  files: ["dist/**/*", "electron-user.mjs", "package.json"],
  extraMetadata: { main: "electron-user.mjs", productName: "ReelMesh Studio · 用户端" },
  mac: {
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    target: [{ target: "dir", arch: ["arm64"] }],
  },
};
