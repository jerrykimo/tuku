# 图片收藏库

本地 macOS Electron 图片管理应用：图片保存在项目目录，应用负责浏览、搜索、编辑、收藏、整理和安全删除。

当前应用版本：**0.4.3**。版本号来自 `package.json`，也会显示在 App 顶部的 `APP · v0.4.3` 标记中。

## 先从这里开始

- 朋友接手与 GitHub 协作：阅读 [两人协作说明](docs/COLLABORATION.md)。全新副本先运行 `npm ci` 和 `python3 add.py rebuild`，再运行 `npm start`；个人图库不会随代码下载。
- 日常使用：打开 `/Applications/图库.app`
- 开发运行：`npm start` 或 `npx electron .`
- 重新打包：`npm run build`，产物在 `release/图库.app`
- 使用和 CLI 命令：阅读 [使用说明.md](使用说明.md)
- 接手代码：先阅读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/OPERATIONS.md](docs/OPERATIONS.md)

## 已有功能

- 按标题、描述、标签、分类、编号搜索和筛选
- 收藏与合集（灵感板）
- 多选后批量加标签、改分类、收藏、加入合集或删除
- 选择 2–6 张图片并排比较，导出拼贴参考图
- 回收站、恢复、彻底清空和独立备份
- 主色筛选、深浅主题、随机浏览和 Finder 定位
- 顶部「版本更新」入口：查看每个版本的新增功能、Bug 修复和其他修改

## 数据规则

- `library.json` 是唯一的元数据源，记录图片、分类、合集、收藏和回收站信息。
- `library-data.js` 是生成文件，修改 `library.json` 后运行 `python3 add.py rebuild`，不要手动编辑它。
- `images/` 保存原图，`thumbs/` 保存缩略图，`trash/` 保存待恢复的原图和缩略图。
- 打包后的 App 仍读取 Dropbox 中的项目目录；源码和图片数据不在 `.app` 内。

## 版本规则

项目处于 0.x 阶段：新增功能递增中间数字 x，例如 `0.4.0 → 0.5.0`；小修正、Bug、图标和样式调整只递增末位数字 y，例如 `0.4.0 → 0.4.1`。两类修改都要同步更新 `package.json` 与说明文档；只做文档或整理时不增加功能版本。

每次发布版本时，在 [docs/CHANGES.md](docs/CHANGES.md) 对应版本下按「新增功能 / Bug 修复 / 其他修改」记录；App 内的「版本更新」面板会自动读取这份记录。

## 规则与文档

`CLAUDE.md` 是项目规则的源文件，`AGENTS.md` 是同一份规则的入口。完整文档索引见 [CLAUDE.md](CLAUDE.md)。
