# 两个人如何一起维护图库

## 共同维护的内容

GitHub 仓库保存 App 代码、图标、依赖版本和项目说明。每个人自己的图片、标签、收藏、合集、回收站和生成文件留在自己的电脑，由 `.gitignore` 排除。

GitHub 不同步图库内容，也不会自动更新电脑里已安装的 App。图片仍需单独备份。

## 朋友第一次接手

1. 公开仓库可直接下载试用。参与维护可 Fork 仓库提交 PR；直接推送需要仓库协作权限。
2. 安装 Git、Node.js 22 和 Python 3。在自己电脑的普通本地目录保存项目，例如 `~/Developer/tuku`；两个人不要共用同一个 Dropbox 开发目录。
3. 在终端运行下面的命令（也可以用 GitHub Desktop 克隆，再打开项目终端）。公开仓库克隆不需要协作邀请；推送代码需要登录自己的 GitHub 账号。

```bash
git clone https://github.com/jerrykimo/tuku.git
cd tuku
npm ci
python3 add.py rebuild
npm start
```

全新副本中没有个人图库，`rebuild` 会创建空的 `library.json` 和生成的 `library-data.js`；已有图库时，它会基于原有记录重建生成文件。不要手写 `library-data.js`。

启动后用「添加图片」导入自己准备的测试图片即可。Electron 内的图片处理使用 npm 安装的 sharp；CLI 如需完整缩略图和主色处理，可在 Python 虚拟环境中安装 Pillow。

目前主要在 macOS Apple Silicon 上使用和打包。其他平台尚未验收。当前打包版固定读取 `~/github/图片收藏库`，所以朋友先用 `npm start` 开发和试用；在解决目录配置之前，不要把 `npm run build` 的结果视为通用安装包。具体见 [架构说明](ARCHITECTURE.md)。

## 每次改一个功能

- **仓库**：项目代码和历史记录的存放位置。
- **main**：双方认可的主版本。
- **分支**：为一个功能或修复建立的独立修改线路。
- **提交（commit）**：保存一次有说明的代码修改。
- **推送（push）**：把本地提交上传到 GitHub。
- **PR（Pull Request）**：请另一人查看修改，并申请合入主版本。

每次开始前，先确保上次修改已经提交或妥善保存，再同步主版本、建立自己的分支。例如新增重复图片检测：

```bash
git switch main
git pull --ff-only
git switch -c feature/duplicate-check
```

完成修改并在 App 中试用后，先检查文件列表和差异，确认没有图片、个人数据或凭据。`git add` 后只写这次需要提交的具体文件名，下面用 `app.js` 举例：

```bash
git status
git diff
git add app.js
git commit -m "增加重复图片检测"
git push -u origin feature/duplicate-check
```

到 GitHub 仓库页面创建 PR，写清改了什么、怎么试过，并附界面截图（如有界面变化）。另一人查看并试用后，由约定的负责人合并。下一次开发前再同步 `main`。

如果提示冲突，先保留双方修改，请对方或 AI 协助处理；不要用强制推送覆盖对方提交。

## 两个人的约定

- 新功能和 Bug 可在 Issues 中各记一条，标明由谁处理；开始前先认领。
- 一条分支只处理一件事。约定双方都通过 PR 合并，先由仓库所有者负责合并与发布；这是协作约定，不代表已经开启技术限制。
- 代码检查通过后还要启动 App，试用本次影响的操作。涉及删除、恢复、备份时使用测试图片。
- 版本号和变更记录遵守 `AGENTS.md`。文档、开源署名和构建元数据整理不改变功能版本，当前保持 `0.4.4`。
- 当前由原维护者打包和更新本机 App；跨电脑可用的安装包需要先完成数据目录配置改造。
- 不上传真实图库、密钥或本机工具日志；`.gitignore` 只阻止普通添加，不要用 `git add -f` 强行加入这些文件。

可让自己的 AI 开发助手执行：

> 先读 AGENTS.md 和 docs/COLLABORATION.md，同步 main 后开独立分支完成这个功能，验证后提交 PR，不直接修改 main，不提交个人图库数据。
