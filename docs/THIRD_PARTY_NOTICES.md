# 第三方许可与来源说明

## 仓库根目录许可

根目录 `LICENSE` 中的 MIT License 仅适用于作者原创的第一方应用代码与项目文档，不覆盖第三方依赖、素材、商标或其他权利人的内容。

## 未随公开副本分发的素材

本作品集副本有意不包含 `server/skill-sources/`、`public/skill-files/` 中的原始 Skill、提示词规范和压缩包，也不包含客户提供的字体及 Premiere 样式文件。这些材料的公开再分发权未在本仓库中确认。私有部署者应自行确认授权后再放入对应目录；不得依据本仓库的 MIT License 推定取得这些材料的使用或再分发权。

## 随包保留的音频

`public/music/NOTICE.md` 与 `public/sfx/NOTICE.md` 记录了音频素材来源和来源页面声明。再分发时应一并保留来源说明，并自行核对各文件在目标用途下的许可条件。

## 第三方代码与依赖

- `package.json`、`package-lock.json` 列出的依赖分别遵循其上游许可。
- Premiere XML 互操作结构参考了 [yf-dev/pekora](https://github.com/yf-dev/pekora) 的 MIT 许可实现思路；本项目保留本地转换逻辑，不会把用户字幕或项目文件发送至该项目。
- 其他上游代码应以其原始仓库和随附 LICENSE/NOTICE 文件为准。
