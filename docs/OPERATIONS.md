# 运维与验收

## 启动与构建

```bash
# 开发运行
npm start

# 打包 macOS Apple Silicon 版本
npm run build
```

构建脚本使用项目内安装的 `electron-packager`，完成后 `postbuild.js` 会生成 `release/图库.app`。当前构建目标是 `darwin/arm64`；要给其他平台打包，需要另行调整脚本和测试环境。

本机日常使用的安装位置是 `/Applications/图库.app`。打包后如果要更新它，先退出正在运行的 App，再用 Finder 替换旧 App；不要在 App 运行时覆盖它。

## 如何确认版本

版本来源只有一个：`package.json` 的 `version`。可以这样检查：

```bash
node -p "require('./package.json').version"
plutil -p release/图库.app/Contents/Info.plist | rg 'CFBundleShortVersionString|CFBundleVersion'
```

打开 App 后，顶部的 `APP · v...` 标记也会显示打包版本。当前版本为 `0.4.4`。

版本更新记录：打开 App 顶部的「版本更新」面板查看；记录源文件是 `docs/CHANGES.md`。每个版本按「新增功能 / Bug 修复 / 其他修改」分组填写，面板会在打开时重新读取。

版本处于 0.x 阶段时，新增功能递增中间数字 x：`0.4.0 → 0.5.0`；小修正、Bug、图标和样式调整递增末位数字 y：`0.4.0 → 0.4.1`。只整理文档、规则或构建流程时不增加功能版本。

## 图片与元数据操作

```bash
python3 add.py add 图片.jpg --title "标题" --category "分类" --tags "标签1,标签2"
python3 add.py list
python3 add.py rebuild
python3 add.py remove <id>
python3 add.py restore <id>
```

- 改完 `library.json` 后运行 `python3 add.py rebuild`。
- `remove` 只把原图和缩略图移入回收站，默认可恢复。
- 清空回收站是不可逆操作；执行前先确认已经有独立备份。
- `library-data.js` 不手动编辑。

## 备份与恢复

1. 在 App 顶部点击「备份」。
2. 选择备份保存位置。
3. App 会创建一个带版本时间标记的文件夹，复制 `library.json`、`library-data.js`、`images/`、`thumbs/` 和 `trash/`。
4. 需要恢复整库时，先退出 App，再保留当前目录副本，最后从备份中恢复这些文件和目录。

单张误删优先使用 App 的「回收站 → 恢复」，不要直接从备份覆盖整个项目。

## 变更后的验收清单

- `node -p "require('./package.json').version"` 与 `CLAUDE.md`、`使用说明.md` 的版本号一致。
- `python3 add.py list` 能读到图片，且 `python3 add.py rebuild` 能正常完成。
- App 顶部显示正确版本；搜索、收藏/合集、批量操作、比较/拼贴、回收站和备份入口存在。
- `release/图库.app/Contents/Info.plist` 的版本与源码一致。
- 如果改了 `gallery.js`、`preload.js` 或前端文件，重新打包后再更新 `/Applications/图库.app`。
