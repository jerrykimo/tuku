# 图片收藏库 · Tuku

**作者：Wayne Wang（GitHub：[@jerrykimo](https://github.com/jerrykimo)）**


本地 macOS Electron 图片管理应用：图片保存在项目目录，应用负责浏览、搜索、编辑、收藏、整理和安全删除。

当前应用版本：**0.4.4**。版本号来自 `package.json`，也会显示在 App 顶部的 `APP · v0.4.4` 标记中。

## 快速开始

需要 Node.js 22.12+、npm 和 Python 3。主要在 macOS Apple Silicon 上使用；其他平台尚未验收。

```sh
git clone https://github.com/jerrykimo/tuku.git
cd tuku
npm ci
python3 add.py rebuild
npm start
```

首次运行会创建空图库；点击「添加图片」导入自己的素材。CLI 的完整缩略图和主色提取可选安装 Pillow：`python3 -m pip install Pillow`（建议使用虚拟环境）。

**当前提供源码运行方式。** 打包版固定读取 `~/github/图片收藏库`，还不是适用于任意安装路径的通用安装包。新用户请先按上面的方式启动，不要把本机打包产物直接当作独立安装包分发。

## 先从这里开始

- 朋友接手与 GitHub 协作：阅读 [两人协作说明](docs/COLLABORATION.md)。全新副本先运行 `npm ci` 和 `python3 add.py rebuild`，再运行 `npm start`；个人图库不会随代码下载。
- 已有本机安装：打开 `/Applications/图库.app`（需满足下方的数据目录规则）
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
- 打包后的 App 读取 `~/github/图片收藏库`；源码和图片数据不在 `.app` 内。

## 版本规则

项目处于 0.x 阶段：新增功能递增中间数字 x，例如 `0.4.0 → 0.5.0`；小修正、Bug、图标和样式调整只递增末位数字 y，例如 `0.4.0 → 0.4.1`。两类修改都要同步更新 `package.json` 与说明文档；只做文档或整理时不增加功能版本。

每次发布版本时，在 [docs/CHANGES.md](docs/CHANGES.md) 对应版本下按「新增功能 / Bug 修复 / 其他修改」记录；App 内的「版本更新」面板会自动读取这份记录。

## 规则与文档

`CLAUDE.md` 是项目规则的源文件，`AGENTS.md` 是同一份规则的入口。完整文档索引见 [CLAUDE.md](CLAUDE.md)。

## 开源与署名

Copyright © 2026 **Wayne Wang（GitHub：@jerrykimo）**。

本项目源代码采用 [MIT License](LICENSE)，允许使用、修改和再分发（包括商业用途）。分发本项目或其重要组成部分时，必须保留版权署名和完整许可证声明。第三方依赖沿用各自的许可证；导入图库的图片不因使用本工具而改变其版权归属。

发现问题或有改进建议，欢迎提交 [Issues](https://github.com/jerrykimo/tuku/issues) 或 Pull Request。协作流程见 [docs/COLLABORATION.md](docs/COLLABORATION.md)。
