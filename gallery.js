const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 开发模式用 __dirname（项目文件夹）；打包后指向外部数据目录（~/github/图片收藏库）
const PROJECT_DIR = path.join(os.homedir(), 'github', '图片收藏库');
const ROOT = app.isPackaged ? PROJECT_DIR : __dirname;
const IMG_DIR = path.join(ROOT, 'images');
const THUMB_DIR = path.join(ROOT, 'thumbs');
const TRASH_DIR = path.join(ROOT, 'trash');
const TRASH_IMG_DIR = path.join(TRASH_DIR, 'images');
const TRASH_THUMB_DIR = path.join(TRASH_DIR, 'thumbs');
const DATA_FILE = path.join(ROOT, 'library.json');
const DATA_JS = path.join(ROOT, 'library-data.js');
const THUMB_SIZE = 480;

// ══════════════════════════════════════════════
//   数据读写
// ══════════════════════════════════════════════

function loadData() {
  let data = { version: 1, title: '图库', categories: [], collections: [], trash: [], images: [] };
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  if (!Array.isArray(data.images)) data.images = [];
  if (!Array.isArray(data.collections)) data.collections = [];
  if (!Array.isArray(data.trash)) data.trash = [];
  data.images.forEach(im => {
    if (!Array.isArray(im.tags)) im.tags = [];
    if (!Array.isArray(im.collections)) im.collections = [];
    im.favorite = !!im.favorite;
  });
  return data;
}

function saveData(data) {
  const cats = [];
  for (const im of data.images) {
    if (im.category && !cats.includes(im.category)) cats.push(im.category);
  }
  data.categories = cats;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  // library-data.js 供 file:// 直接双击和 Electron 共用
  const js = '// 自动生成\nwindow.LIBRARY_DATA = ' +
    JSON.stringify(data, null, 2) + ';\n';
  fs.writeFileSync(DATA_JS, js, 'utf-8');
}

function relativeToRoot(fullPath) {
  return path.relative(ROOT, fullPath).split(path.sep).join('/');
}

function safeResolve(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const full = path.resolve(ROOT, relPath);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (full !== ROOT && !full.startsWith(rootPrefix)) return null;
  return full;
}

function uniquePath(folder, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let target = path.join(folder, filename);
  let n = 1;
  while (fs.existsSync(target)) {
    target = path.join(folder, `${stem}_${n}${ext}`);
    n++;
  }
  return target;
}

function moveFile(src, dst) {
  if (!src || !fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
  }
  return true;
}

// ══════════════════════════════════════════════
//   缩略图
// ══════════════════════════════════════════════

function generateThumb(src, dst) {
  try {
    const sharp = require('sharp');
    return sharp(src)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84 })
      .toFile(dst);
  } catch {
    fs.copyFileSync(src, dst);
    return Promise.resolve();
  }
}

// ══════════════════════════════════════════════
//   主色提取（供前端「按颜色筛选」）
// ══════════════════════════════════════════════

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function colorDistSq(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function rawPixels(data, channels) {
  const out = [];
  for (let i = 0; i < data.length; i += channels) out.push([data[i], data[i + 1], data[i + 2]]);
  return out;
}

// 与 add.py 的 extract_palette 算法保持一致：忽略低饱和像素，16 步长量化，取前 5 个主色
async function extractPalette(filePath) {
  try {
    const sharp = require('sharp');
    const { data, info } = await sharp(filePath)
      .resize(48, 48, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const step = 16;
    const chromaMin = 24;
    const channels = info.channels;
    const chromaPx = [];
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) >= chromaMin) chromaPx.push([r, g, b]);
    }
    const px = chromaPx.length >= 60 ? chromaPx : rawPixels(data, channels);
    const counts = new Map();
    for (const [r, g, b] of px) {
      const key = ((r - r % step) << 16) | ((g - g % step) << 8) | (b - b % step);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const palette = [];
    for (const [key] of ordered) {
      const r = (key >> 16) & 255, g = (key >> 8) & 255, b = key & 255;
      if (palette.some(c => colorDistSq(c, [r, g, b]) < 900)) continue;
      palette.push([r, g, b]);
      if (palette.length >= 5) break;
    }
    return palette.map(c => rgbToHex(c[0], c[1], c[2]));
  } catch (e) {
    return [];
  }
}

// 为缺少主色的图片补齐 colors（兜底，正常情况下入库时已生成）
async function ensureColors(data) {
  let changed = false;
  for (const im of data.images) {
    if (Array.isArray(im.colors) && im.colors.length) continue;
    const thumbPath = safeResolve(im.thumb);
    if (thumbPath && fs.existsSync(thumbPath)) {
      const colors = await extractPalette(thumbPath);
      if (colors.length) { im.colors = colors; changed = true; }
    }
  }
  if (changed) saveData(data);
}


// ══════════════════════════════════════════════
//   回收站
// ══════════════════════════════════════════════

function moveImageToTrash(im) {
  const token = `${Date.now()}-${String(im.id || 'image').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const fileName = `${token}-${path.basename(im.file || 'image')}`;
  const thumbName = `${token}-${path.basename(im.thumb || 'thumb.jpg')}`;
  const trashFile = uniquePath(TRASH_IMG_DIR, fileName);
  const trashThumb = uniquePath(TRASH_THUMB_DIR, thumbName);
  const originalFile = safeResolve(im.file);
  const originalThumb = safeResolve(im.thumb);
  const movedFile = moveFile(originalFile, trashFile);
  const movedThumb = moveFile(originalThumb, trashThumb);
  return {
    image: JSON.parse(JSON.stringify(im)),
    trashFile: movedFile ? relativeToRoot(trashFile) : null,
    trashThumb: movedThumb ? relativeToRoot(trashThumb) : null,
    trashedAt: new Date().toISOString(),
  };
}

function removeImagesFromData(data, ids) {
  const wanted = new Set(ids);
  const kept = [];
  const moved = [];
  for (const im of data.images) {
    if (wanted.has(im.id)) moved.push(moveImageToTrash(im));
    else kept.push(im);
  }
  data.images = kept;
  data.trash = moved.concat(data.trash);
  saveData(data);
  return moved.length;
}

// 版本变更记录以 Markdown 保存，App 只读取版本标题、分类标题和列表内容。
// 这样后续更新时只需编辑 docs/CHANGES.md，不用再改界面代码。
function parseChangelog(markdown) {
  const versions = [];
  let current = null;
  let currentSection = null;

  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const versionMatch = rawLine.match(/^##\s+(\d+\.\d+\.\d+)(?:\s*·\s*(.*))?\s*$/);
    if (versionMatch) {
      current = {
        version: versionMatch[1],
        label: versionMatch[2] || '',
        sections: [],
      };
      versions.push(current);
      currentSection = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = rawLine.match(/^###\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = { title: sectionMatch[1], items: [] };
      current.sections.push(currentSection);
      continue;
    }

    const itemMatch = rawLine.match(/^\s*-\s+(.+?)\s*$/);
    if (itemMatch) {
      if (!currentSection) {
        currentSection = { title: '其他修改', items: [] };
        current.sections.push(currentSection);
      }
      currentSection.items.push(itemMatch[1]);
    }
  }

  return versions.filter(entry => entry.sections.some(section => section.items.length));
}

function loadChangelog() {
  // 打包版从外部项目目录读取，更新记录后不必为了文档改动重新打包 App。
  const file = path.join(ROOT, 'docs', 'CHANGES.md');
  try {
    return parseChangelog(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    console.error('读取版本变更记录失败:', error.message);
    return [];
  }
}

// ══════════════════════════════════════════════
//   IPC 处理
// ══════════════════════════════════════════════

ipcMain.handle('get-library', async () => {
  const data = loadData();
  await ensureColors(data);
  return {
    ok: true,
    data,
    appVersion: app.getVersion(),
    assetRoot: pathToFileURL(ROOT + path.sep).href,
  };
});

ipcMain.handle('get-changelog', () => ({
  ok: true,
  versions: loadChangelog(),
}));

ipcMain.handle('remove-image', (_, id) => {
  const data = loadData();
  const removed = removeImagesFromData(data, [id]);
  if (!removed) return { ok: false, error: '图片不存在' };
  return { ok: true, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('remove-images', (_, ids) => {
  const data = loadData();
  const list = Array.isArray(ids) ? ids : [];
  const removed = removeImagesFromData(data, list);
  if (!removed) return { ok: false, error: '没有找到要移入回收站的图片' };
  return { ok: true, removed, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('update-image', (_, { id, changes }) => {
  const data = loadData();
  const im = data.images.find(item => item.id === id);
  if (!im) return { ok: false, error: '图片不存在' };
  if (changes && typeof changes === 'object') Object.assign(im, changes);
  if (!Array.isArray(im.tags)) im.tags = [];
  if (!Array.isArray(im.collections)) im.collections = [];
  im.favorite = !!im.favorite;
  saveData(data);
  return { ok: true, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('batch-update-images', (_, payload) => {
  const data = loadData();
  const ids = Array.isArray(payload && payload.ids) ? payload.ids : [];
  const wanted = new Set(ids);
  const addTags = Array.isArray(payload && payload.addTags) ? payload.addTags.filter(Boolean) : [];
  const removeTags = Array.isArray(payload && payload.removeTags) ? payload.removeTags : [];
  const addCollection = payload && payload.addCollection;
  const removeCollection = payload && payload.removeCollection;
  if (addCollection && !data.collections.some(c => c.id === addCollection)) {
    return { ok: false, error: '合集不存在' };
  }
  let changed = 0;
  for (const im of data.images) {
    if (!wanted.has(im.id)) continue;
    if (payload.changes && typeof payload.changes === 'object') Object.assign(im, payload.changes);
    im.tags = Array.isArray(im.tags) ? im.tags : [];
    im.collections = Array.isArray(im.collections) ? im.collections : [];
    addTags.forEach(tag => { if (!im.tags.includes(tag)) im.tags.push(tag); });
    im.tags = im.tags.filter(tag => !removeTags.includes(tag));
    if (addCollection && !im.collections.includes(addCollection)) im.collections.push(addCollection);
    if (removeCollection) im.collections = im.collections.filter(id => id !== removeCollection);
    im.favorite = !!im.favorite;
    changed++;
  }
  if (!changed) return { ok: false, error: '没有找到要修改的图片' };
  saveData(data);
  return { ok: true, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('create-collection', (_, name) => {
  const data = loadData();
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: '合集名称不能为空' };
  if (data.collections.some(c => c.name === clean)) return { ok: false, error: '已经有同名合集' };
  const collection = {
    id: `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: clean,
    created: new Date().toISOString(),
  };
  data.collections.push(collection);
  saveData(data);
  return { ok: true, collection, collections: data.collections, images: data.images, trash: data.trash };
});

ipcMain.handle('rename-collection', (_, id, name) => {
  const data = loadData();
  const clean = String(name || '').trim();
  const collection = data.collections.find(c => c.id === id);
  if (!collection) return { ok: false, error: '合集不存在' };
  if (!clean) return { ok: false, error: '合集名称不能为空' };
  if (data.collections.some(c => c.id !== id && c.name === clean)) return { ok: false, error: '已经有同名合集' };
  collection.name = clean;
  saveData(data);
  return { ok: true, collections: data.collections, images: data.images, trash: data.trash };
});

ipcMain.handle('delete-collection', (_, id) => {
  const data = loadData();
  const exists = data.collections.some(c => c.id === id);
  if (!exists) return { ok: false, error: '合集不存在' };
  data.collections = data.collections.filter(c => c.id !== id);
  data.images.forEach(im => {
    im.collections = (im.collections || []).filter(collectionId => collectionId !== id);
  });
  saveData(data);
  return { ok: true, collections: data.collections, images: data.images, trash: data.trash };
});

ipcMain.handle('restore-image', async (_, id) => {
  const data = loadData();
  const index = data.trash.findIndex(entry => (entry.image || entry).id === id);
  if (index < 0) return { ok: false, error: '回收站里没有这张图片' };
  const entry = data.trash[index];
  const image = JSON.parse(JSON.stringify(entry.image || entry));

  let destFile = safeResolve(image.file);
  if (!destFile) destFile = path.join(IMG_DIR, path.basename(image.file || `${id}.jpg`));
  if (fs.existsSync(destFile)) {
    destFile = uniquePath(IMG_DIR, path.basename(destFile));
    image.file = relativeToRoot(destFile);
  }
  let destThumb = safeResolve(image.thumb);
  if (!destThumb) destThumb = path.join(THUMB_DIR, path.basename(image.thumb || `${id}.jpg`));
  if (fs.existsSync(destThumb)) {
    destThumb = uniquePath(THUMB_DIR, path.basename(destThumb));
    image.thumb = relativeToRoot(destThumb);
  }

  const sourceFile = safeResolve(entry.trashFile);
  const sourceThumb = safeResolve(entry.trashThumb);
  const fileRestored = fs.existsSync(destFile) || moveFile(sourceFile, destFile);
  if (!fileRestored) return { ok: false, error: '原图文件已经不存在，无法恢复' };
  if (sourceThumb && fs.existsSync(sourceThumb)) moveFile(sourceThumb, destThumb);
  if (!fs.existsSync(destThumb)) {
    try { await generateThumb(destFile, destThumb); } catch {}
  }

  data.trash.splice(index, 1);
  data.images.unshift(image);
  saveData(data);
  return { ok: true, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('empty-trash', () => {
  const data = loadData();
  for (const entry of data.trash) {
    for (const rel of [entry.trashFile, entry.trashThumb]) {
      const full = safeResolve(rel);
      if (full && fs.existsSync(full)) fs.unlinkSync(full);
    }
  }
  data.trash = [];
  saveData(data);
  return { ok: true, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('open-in-finder', (_, relPath) => {
  const full = safeResolve(relPath);
  if (full && fs.existsSync(full)) {
    shell.showItemInFolder(full);
    return { ok: true };
  }
  return { ok: false, error: '文件不存在' };
});

ipcMain.handle('add-images', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要添加的图片',
    filters: [
      { name: '图片', extensions: ['jpg','jpeg','png','webp','gif','bmp','tif','tiff','heic','heif'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };

  const data = loadData();
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  let added = 0;
  for (const src of result.filePaths) {
    let ext = path.extname(src).toLowerCase();
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let fname = ts + ext;
    let dst = path.join(IMG_DIR, fname);
    let n = 1;
    while (fs.existsSync(dst)) { dst = path.join(IMG_DIR, `${ts}_${n}${ext}`); n++; }
    fs.copyFileSync(src, dst);

    const thumbName = path.basename(dst, ext) + '.jpg';
    const thumbPath = path.join(THUMB_DIR, thumbName);
    await generateThumb(dst, thumbPath);
    const colors = await extractPalette(thumbPath);

    const today = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = today + '-';
    let maxN = 0;
    for (const im of data.images) {
      if (im.id && im.id.startsWith(prefix)) {
        const num = parseInt(im.id.slice(prefix.length), 10);
        if (num > maxN) maxN = num;
      }
    }
    const imageId = prefix + String(maxN + 1).padStart(3, '0');
    let maxNum = 0;
    for (const im of data.images) {
      const nm = im.num || '';
      if (nm.startsWith('K')) {
        const num = parseInt(nm.slice(1), 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const imageNum = 'K' + String(maxNum + 1).padStart(9, '0');
    data.images.push({
      id: imageId,
      num: imageNum,
      file: relativeToRoot(dst),
      thumb: relativeToRoot(thumbPath),
      title: path.basename(src, ext).replace(/[_\-\s]+/g, ' ').trim() || '未命名',
      category: '未分类',
      tags: [],
      colors,
      collections: [],
      favorite: false,
      desc: '',
      added: now.toISOString().slice(0, 10),
    });
    added++;
  }
  data.images.reverse();
  saveData(data);
  return { ok: true, added, images: data.images, collections: data.collections, trash: data.trash };
});

ipcMain.handle('save-collage', async (_, payload) => {
  const dataUrl = payload && payload.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return { ok: false, error: '拼贴图数据无效' };
  }
  const defaultName = String(payload.defaultName || '图库拼贴.jpg').replace(/[\\/:*?"<>|]/g, '_');
  const result = await dialog.showSaveDialog({
    title: '导出拼贴图',
    defaultPath: path.join(app.getPath('pictures'), defaultName),
    filters: [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.*)$/);
  if (!match) return { ok: false, error: '拼贴图数据格式不正确' };
  fs.writeFileSync(result.filePath, Buffer.from(match[1], 'base64'));
  return { ok: true, path: result.filePath };
});

ipcMain.handle('create-backup', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择备份保存位置',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  const data = loadData();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  let folder = path.join(result.filePaths[0], `图库备份-${stamp}`);
  let n = 1;
  while (fs.existsSync(folder)) { folder = path.join(result.filePaths[0], `图库备份-${stamp}-${n}`); n++; }
  fs.mkdirSync(folder, { recursive: true });
  for (const file of ['library.json', 'library-data.js']) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(folder, file));
  }
  for (const dir of ['images', 'thumbs', 'trash']) {
    const src = path.join(ROOT, dir);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(folder, dir), { recursive: true });
  }
  return { ok: true, folderPath: folder, imageCount: data.images.length, trashCount: data.trash.length };
});

// ══════════════════════════════════════════════
//   窗口
// ══════════════════════════════════════════════

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: '图库',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0e11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
