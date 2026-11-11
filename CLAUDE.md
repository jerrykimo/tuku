# 图片收藏库 — 项目规则

Electron 桌面应用。图片本地存储，AI 负责分类+打标签入库，APP 内浏览/搜索/编辑/管理。

当前应用版本：`0.4.4`。处于 0.x 阶段；新增功能递增中间数字 x（例如 `0.4.0 → 0.5.0`），小修正、Bug、图标和样式调整递增末位数字 y（例如 `0.4.2 → 0.4.3`），并同步更新 `package.json` 的 `version`。

## 目录速查
- `gallery.js` — Electron 主进程（IPC 处理、文件读写、缩略图生成）
- `preload.js` — 安全 IPC 桥接
- `index.html` + `style.css` + `app.js` — 前端（由 gallery.js 加载）
- `add.py` — CLI 入库脚本（add/remove/restore/list/rebuild）
- `library.json` — 元数据源（分类/标题/标签/描述/收藏/合集），可手改
- `library-data.js` — 自动生成，勿手改（改完 library.json 跑 `python3 add.py rebuild`）
- `images/` 原图 · `thumbs/` 缩略图 · `trash/` 回收站文件
- `/Applications/图库.app` — 本地使用的打包桌面应用（与源码分离）

## 文档入口
- `README.md` — 新人快速开始与项目地图
- `使用说明.md` — 日常使用、入库和管理命令
- `docs/ARCHITECTURE.md` — 组件、数据流、IPC 和删除语义
- `docs/OPERATIONS.md` — 启动、构建、备份、恢复和验收清单
- `docs/CHANGES.md` — 版本变更记录
- `AGENTS.md` — 与本文件保持一致的规则入口

## 红线
- 添加图片可在 APP 内点「添加图片」按钮，或 CLI `python3 add.py add <图> …`
- 分类：少而稳定；标签：多而具体
- 删除：APP 内红色垃圾桶（推荐）或 CLI `python3 add.py remove <id>`，默认移入回收站
- `library-data.js` 是生成文件，绝不手改

## 环境
- Python 脚本：使用本机 Python 3；需要完整图片处理时，在虚拟环境中安装 Pillow
- APP 启动：`npm start` / `npx electron .` / 双击 `/Applications/图库.app`
- 详情见 `使用说明.md`
