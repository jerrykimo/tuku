/* 图片收藏库 · 前端逻辑 */
(function () {
  "use strict";

  var DATA = window.LIBRARY_DATA || { title: "图库", images: [] };
  var ASSET_ROOT = "";
  var IMAGES = [];
  var APP_VERSION = "0.4.3";
  var CHANGELOG = [];
  var CHANGELOG_FALLBACK = [{
    version: "0.4.3",
    label: "当前版本",
    sections: [{
      title: "新增功能",
      items: ["增加键盘快捷键：灯箱内 F 收藏、⌫ 移入回收站、← → 翻页、Esc 关闭；多选时 ⌫ 批量移入回收站、F 批量收藏；按 / 快速聚焦搜索框。"]
    }, {
      title: "Bug 修复",
      items: ["暂无。"]
    }, {
      title: "其他修改",
      items: ["灯箱底部新增快捷键提示，收藏与删除按钮标注对应按键。"]
    }]
  }];
  var state = {
    q: "",
    cats: new Set(),
    tags: new Set(),
    sort: "new",
    shuffleOrder: null,
    favoriteOnly: false,
    collectionId: "",
    color: null,
    selectMode: false,
    selection: new Set(),
    tagsExpanded: false,
  };

  var els = {};
  var lbList = [];
  var lbIndex = 0;
  var compareIds = [];
  var collectionDialogMode = "manage";
  var collectionDialogIds = [];

  function $(id) { return document.getElementById(id); }

  // 打包版界面位于 app.asar，原图和缩略图位于外部数据目录（~/github/图片收藏库）。
  // Electron 启动时由主进程提供 assetRoot；直接打开 index.html 时继续使用相对路径。
  function assetUrl(relPath) {
    var value = String(relPath || "");
    if (!value || /^(?:data:|https?:|file:|blob:)/i.test(value)) return value;
    if (!ASSET_ROOT) return value;
    try { return new URL(value, ASSET_ROOT).href; } catch (e) { return value; }
  }

  function normalizeImage(im) {
    im.tags = Array.isArray(im.tags) ? im.tags : [];
    im.colors = Array.isArray(im.colors) ? im.colors : [];
    im.collections = Array.isArray(im.collections) ? im.collections : [];
    im.favorite = !!im.favorite;
    return im;
  }

  function normalizeData(data) {
    data = data || {};
    data.images = Array.isArray(data.images) ? data.images.map(normalizeImage) : [];
    data.collections = Array.isArray(data.collections) ? data.collections : [];
    data.trash = Array.isArray(data.trash) ? data.trash : [];
    return data;
  }

  DATA = normalizeData(DATA);
  IMAGES = DATA.images;

  function updateImageById(id, changes) {
    for (var i = 0; i < IMAGES.length; i++) {
      if (IMAGES[i].id === id) {
        for (var k in changes) { IMAGES[i][k] = changes[k]; }
        return IMAGES[i];
      }
    }
    return null;
  }

  function syncLbList() {
    var byId = {};
    IMAGES.forEach(function (im) { byId[im.id] = im; });
    lbList = lbList.map(function (im) { return byId[im.id] || im; });
    if (lbIndex >= lbList.length) lbIndex = Math.max(0, lbList.length - 1);
  }

  function refreshFromResponse(r) {
    if (!r) return;
    if (r.data) {
      DATA = normalizeData(r.data);
      IMAGES = DATA.images;
    } else {
      if (Array.isArray(r.images)) {
        IMAGES = r.images.map(normalizeImage);
        DATA.images = IMAGES;
      }
      if (Array.isArray(r.collections)) DATA.collections = r.collections;
      if (Array.isArray(r.trash)) DATA.trash = r.trash;
    }
    state.selection.forEach(function (id) {
      if (!IMAGES.some(function (im) { return im.id === id; })) state.selection.delete(id);
    });
    syncLbList();
    updateTrashCount();
  }

  /* ---------- 确认提示 ---------- */
  function showConfirm(title, msg, onOk, okText) {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = msg;
    els.confirm.classList.remove("hidden");
    els.confirmCancel.classList.remove("hidden");
    els.confirmOk.textContent = okText || "确认";
    els.confirmOk.onclick = function () {
      els.confirm.classList.add("hidden");
      refreshBodyLock();
      onOk();
    };
    els.confirmCancel.onclick = function () {
      els.confirm.classList.add("hidden");
      refreshBodyLock();
    };
  }

  function showNotice(title, msg) {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = msg;
    els.confirm.classList.remove("hidden");
    els.confirmCancel.classList.add("hidden");
    els.confirmOk.textContent = "知道了";
    els.confirmOk.onclick = function () {
      els.confirm.classList.add("hidden");
      refreshBodyLock();
    };
  }

  /* ---------- 主题 ---------- */
  function initTheme() {
    var t = null;
    try { t = localStorage.getItem("gallery-theme"); } catch (e) {}
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  }

  function toggleTheme() {
    var cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem("gallery-theme", cur); } catch (e) {}
  }

  /* ---------- 数据筛选 ---------- */
  function tagList() {
    var map = {};
    IMAGES.forEach(function (im) {
      (im.tags || []).forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map)
      .map(function (t) { return { name: t, count: map[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, "zh"); });
  }

  function catList() {
    var map = {};
    IMAGES.forEach(function (im) {
      var c = im.category || "未分类";
      map[c] = (map[c] || 0) + 1;
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, "zh"); });
  }

  function collectionCount(id) {
    return IMAGES.filter(function (im) {
      return (im.collections || []).indexOf(id) >= 0;
    }).length;
  }

  function collectionName(id) {
    var c = DATA.collections.find(function (item) { return item.id === id; });
    return c ? c.name : id;
  }

  /* ---------- 颜色筛选 ---------- */
  var COLOR_TOLERANCE = 20; // 色相容差（度）
  var COLOR_TOP_K = 2;      // 只取前 2 个主色参与匹配，避免多色图什么都匹配
  var COLOR_MIN_SAT = 0.15; // 忽略低饱和颜色，避免灰暗色调误命中

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (h.length !== 6 || isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h: h, s: s, l: l };
  }

  function hueDist(a, b) {
    var d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  }

  function imageMatchesColor(im, hue) {
    var cols = (im.colors || []).slice(0, COLOR_TOP_K);
    for (var i = 0; i < cols.length; i++) {
      var rgb = hexToRgb(cols[i]);
      if (!rgb) continue;
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      if (hsl.s < COLOR_MIN_SAT) continue; // 忽略低饱和颜色
      if (hueDist(hsl.h, hue) <= COLOR_TOLERANCE) return true;
    }
    return false;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = IMAGES.filter(function (im) {
      if (state.favoriteOnly && !im.favorite) return false;
      if (state.collectionId && (im.collections || []).indexOf(state.collectionId) < 0) return false;
      if (state.cats.size && !state.cats.has(im.category || "未分类")) return false;
      if (state.color != null && !imageMatchesColor(im, state.color)) return false;
      if (state.tags.size) {
        var tags = im.tags || [];
        var ok = true;
        state.tags.forEach(function (t) { if (tags.indexOf(t) < 0) ok = false; });
        if (!ok) return false;
      }
      if (q) {
        var hay = [im.title, im.desc, im.category, im.id, im.num]
          .concat(im.tags || [])
          .concat((im.collections || []).map(collectionName))
          .join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    if (state.sort === "shuffle" && state.shuffleOrder) {
      var byId = {}, seen = {}, out = [];
      list.forEach(function (im) { byId[im.id] = im; });
      state.shuffleOrder.forEach(function (id) {
        if (byId[id]) { out.push(byId[id]); seen[id] = true; }
      });
      list.forEach(function (im) { if (!seen[im.id]) out.push(im); });
      return out;
    }
    if (state.sort === "new") {
      list.sort(function (a, b) { return String(b.added || "").localeCompare(String(a.added || "")); });
    } else if (state.sort === "old") {
      list.sort(function (a, b) { return String(a.added || "").localeCompare(String(b.added || "")); });
    } else {
      list.sort(function (a, b) { return (a.title || "").localeCompare(b.title || "", "zh"); });
    }
    return list;
  }

  /* ---------- 通用渲染 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function chip(label, count, active, fn, extraClass) {
    var b = document.createElement("button");
    b.className = "chip" + (active ? " on" : "") + (extraClass ? " " + extraClass : "");
    b.innerHTML = esc(label) + (count != null ? ' <em class="cnt">' + count + "</em>" : "");
    b.addEventListener("click", fn);
    return b;
  }

  function renderCats() {
    els.catBar.innerHTML = "";
    els.catBar.appendChild(chip("全部", IMAGES.length, state.cats.size === 0, function () {
      state.cats.clear();
      renderAll();
    }));
    catList().forEach(function (c) {
      var n = IMAGES.filter(function (im) { return (im.category || "未分类") === c; }).length;
      els.catBar.appendChild(chip(c, n, state.cats.has(c), function () {
        if (state.cats.has(c)) state.cats.delete(c);
        else { state.cats.clear(); state.cats.add(c); }
        renderAll();
      }));
    });
  }

  var TAG_PEEK = 16; // 标签折叠时默认显示的个数

  function renderTags() {
    els.tagBar.innerHTML = "";
    var label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = "标签";
    els.tagBar.appendChild(label);

    var tags = tagList();
    var expanded = state.tagsExpanded;
    var shown = expanded ? tags : tags.slice(0, TAG_PEEK);
    shown.forEach(function (t) {
      els.tagBar.appendChild(chip(t.name, t.count, state.tags.has(t.name), function () {
        if (state.tags.has(t.name)) state.tags.delete(t.name);
        else state.tags.add(t.name);
        renderAll();
      }));
    });

    var hiddenCount = tags.length - TAG_PEEK;
    if (hiddenCount > 0) {
      var toggle = document.createElement("button");
      toggle.className = "chip chip-more";
      toggle.title = expanded ? "收起标签" : "展开全部标签";
      toggle.innerHTML = expanded
        ? '收起 <span class="more-ico">▲</span>'
        : '展开 <em class="cnt">' + hiddenCount + '</em> 个 <span class="more-ico">▼</span>';
      toggle.addEventListener("click", function () {
        state.tagsExpanded = !state.tagsExpanded;
        renderTags();
      });
      els.tagBar.appendChild(toggle);
    }
  }

  function renderCollections() {
    els.collectionBar.innerHTML = "";
    var label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = "收藏";
    els.collectionBar.appendChild(label);

    var favoriteCount = IMAGES.filter(function (im) { return im.favorite; }).length;
    els.collectionBar.appendChild(chip("★ 收藏", favoriteCount, state.favoriteOnly, function () {
      state.favoriteOnly = !state.favoriteOnly;
      state.collectionId = "";
      renderAll();
    }));

    DATA.collections.slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), "zh");
    }).forEach(function (c) {
      els.collectionBar.appendChild(chip(c.name, collectionCount(c.id), state.collectionId === c.id, function () {
        state.collectionId = state.collectionId === c.id ? "" : c.id;
        state.favoriteOnly = false;
        renderAll();
      }));
    });

    els.collectionBar.appendChild(chip("管理合集", null, false, function () {
      openCollectionsDialog("manage", []);
    }, "chip-action"));
  }

  function renderColorBar() {
    var hue = state.color;
    if (hue == null) {
      els.colorStrip.classList.remove("has-color");
      els.colorClear.hidden = true;
      els.colorCount.textContent = "";
      return;
    }
    els.colorStrip.classList.add("has-color");
    els.colorClear.hidden = false;
    els.colorMarker.style.left = (hue / 360 * 100) + "%";
    els.colorMarker.style.background = "hsl(" + hue + " 75% 50%)";
    var n = IMAGES.filter(function (im) { return imageMatchesColor(im, hue); }).length;
    els.colorCount.textContent = "匹配 " + n + " 张";
  }

  function colorChip() {
    var b = document.createElement("button");
    b.className = "chip on";
    var dot = document.createElement("span");
    dot.className = "color-dot";
    dot.style.background = "hsl(" + state.color + " 75% 50%)";
    b.appendChild(dot);
    b.appendChild(document.createTextNode("颜色 ✕"));
    b.addEventListener("click", function () { state.color = null; renderAll(); });
    return b;
  }

  function renderActiveBar() {
    var has = state.cats.size || state.tags.size || state.q.trim() || state.favoriteOnly || state.collectionId || state.color != null;
    els.activeBar.hidden = !has;
    els.activeBar.innerHTML = "";
    if (!has) return;
    els.activeBar.appendChild(chip("清除筛选", null, false, function () {
      state.q = "";
      state.cats.clear();
      state.tags.clear();
      state.favoriteOnly = false;
      state.collectionId = "";
      state.color = null;
      els.search.value = "";
      renderAll();
    }));
    if (state.favoriteOnly) {
      els.activeBar.appendChild(chip("收藏 ✕", null, true, function () {
        state.favoriteOnly = false;
        renderAll();
      }));
    }
    if (state.collectionId) {
      els.activeBar.appendChild(chip(collectionName(state.collectionId) + " ✕", null, true, function () {
        state.collectionId = "";
        renderAll();
      }));
    }
    if (state.color != null) {
      els.activeBar.appendChild(colorChip());
    }
    state.cats.forEach(function (c) {
      els.activeBar.appendChild(chip(c + " ✕", null, true, function () {
        state.cats.delete(c);
        renderAll();
      }));
    });
    state.tags.forEach(function (t) {
      els.activeBar.appendChild(chip(t + " ✕", null, true, function () {
        state.tags.delete(t);
        renderAll();
      }));
    });
  }

  function renderSelectionBar() {
    var count = state.selection.size;
    els.selectionBar.classList.toggle("hidden", !state.selectMode);
    els.selectionCount.textContent = "已选 " + count + " 张";
    els.batchCompare.disabled = count < 2 || count > 6;
    els.batchCollage.disabled = count < 2 || count > 6;
    els.btnSelect.classList.toggle("on", state.selectMode);
    els.btnSelect.textContent = state.selectMode ? "退出选择" : "选择";
  }

  function showEmpty(kind) {
    els.grid.classList.add("hidden");
    els.empty.classList.remove("hidden");
    if (kind === "library-empty") {
      els.empty.innerHTML =
        '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg></div>' +
        "<h3>等待第一张图片</h3>" +
        "<p>把喜欢的图片直接发给小耳，我会自动分类、打标签、存进这里。<br>点击「添加图片」按钮选图，或运行 <code>python add.py add 图片路径</code> 手动入库。</p>" +
        '<div class="hint">图片存于本机 images/ 目录</div>';
    } else {
      els.empty.innerHTML =
        '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>' +
        "<h3>没有匹配的图片</h3>" +
        "<p>换一个关键词，或点击“清除筛选”重新看看全部收藏。</p>";
    }
  }

  function toggleSelection(id) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    renderSelectionBar();
    renderGrid();
  }

  function renderGrid() {
    var list = filtered();
    els.grid.innerHTML = "";
    if (IMAGES.length === 0) { showEmpty("library-empty"); return; }
    if (list.length === 0) { showEmpty("no-match"); return; }
    els.empty.classList.add("hidden");
    els.grid.classList.remove("hidden");

    list.forEach(function (im, i) {
      var selected = state.selection.has(im.id);
      var fig = document.createElement("figure");
      fig.className = "card" + (selected ? " selected" : "") + (state.selectMode ? " select-mode" : "");
      fig.style.setProperty("--i", Math.min(i, 12));

      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = assetUrl(im.thumb || im.file);
      img.alt = im.title || "";

      var num = document.createElement("span");
      num.className = "card-num";
      num.textContent = im.num || "";
      num.title = "库编号" + (im.num ? " " + im.num : "");

      var select = document.createElement("button");
      select.className = "card-select";
      select.textContent = selected ? "✓" : "";
      select.setAttribute("aria-label", selected ? "取消选择" : "选择图片");
      select.setAttribute("aria-pressed", selected ? "true" : "false");
      select.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!state.selectMode) state.selectMode = true;
        toggleSelection(im.id);
      });

      var favorite = document.createElement("button");
      favorite.className = "card-fav" + (im.favorite ? " on" : "");
      favorite.textContent = im.favorite ? "★" : "☆";
      favorite.title = im.favorite ? "取消收藏" : "收藏";
      favorite.setAttribute("aria-label", favorite.title);
      favorite.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleFavorite(im.id);
      });

      var cap = document.createElement("figcaption");
      var t = document.createElement("div");
      t.className = "card-title";
      t.textContent = im.title || "未命名";
      var m = document.createElement("div");
      m.className = "card-meta";
      m.textContent = (im.category || "未分类") + (im.added ? " · " + im.added : "");
      cap.appendChild(t);
      cap.appendChild(m);

      var tags = document.createElement("div");
      tags.className = "card-tags";
      (im.tags || []).slice(0, 4).forEach(function (tg) {
        var s = document.createElement("span");
        s.textContent = "#" + tg;
        s.addEventListener("click", function (e) {
          e.stopPropagation();
          state.tags.add(tg);
          renderAll();
        });
        tags.appendChild(s);
      });
      cap.appendChild(tags);

      fig.appendChild(num);
      fig.appendChild(select);
      fig.appendChild(favorite);
      fig.appendChild(img);
      fig.appendChild(cap);
      fig.addEventListener("click", function () {
        if (state.selectMode) toggleSelection(im.id);
        else openLightbox(list, i);
      });
      els.grid.appendChild(fig);
    });

    var scopeCount = list.length === IMAGES.length ? IMAGES.length : list.length + "/" + IMAGES.length;
    els.stat.textContent = scopeCount + " 张 · " + tagList().length + " 个标签";
  }

  function renderAll() {
    renderColorBar();
    renderCats();
    renderTags();
    renderCollections();
    renderActiveBar();
    renderSelectionBar();
    renderGrid();
  }

  /* ---------- 灯箱 ---------- */
  function openLightbox(list, index) {
    lbList = list;
    lbIndex = index;
    renderLb();
    els.lb.classList.remove("hidden");
    els.lb.setAttribute("aria-hidden", "false");
    refreshBodyLock();
  }

  function closeLb() {
    els.lb.classList.add("hidden");
    els.lb.setAttribute("aria-hidden", "true");
    els.lbImg.removeAttribute("src");
    refreshBodyLock();
  }

  function navLb(d) {
    if (lbList.length <= 1) return;
    lbIndex = (lbIndex + d + lbList.length) % lbList.length;
    renderLb();
  }

  function currentLbImage() { return lbList[lbIndex]; }

  function renderLb() {
    var im = currentLbImage();
    if (!im) return;
    els.lbImg.src = assetUrl(im.file);
    els.lbImg.alt = im.title || "";
    els.lbNum.textContent = im.num || "";
    els.lbTitle.textContent = im.title || "未命名";
    els.lbCat.textContent = im.category || "未分类";
    els.lbDesc.textContent = im.desc || "";
    els.lbDesc.hidden = !im.desc;
    els.lbDate.textContent = im.added || "";
    els.lbOrig.href = assetUrl(im.file);
    els.lbCount.textContent = (lbIndex + 1) + " / " + lbList.length;
    els.lbFavorite.textContent = im.favorite ? "★" : "☆";
    els.lbFavorite.classList.toggle("on", !!im.favorite);
    els.lbFavorite.title = (im.favorite ? "取消收藏" : "收藏") + "（F）";

    els.lbTags.innerHTML = "";
    (im.tags || []).forEach(function (t) {
      var c = document.createElement("span");
      c.className = "chip-tag";
      c.innerHTML = "<em>#</em>" + esc(t) + '<button class="tag-rm" aria-label="移除标签">×</button>';
      c.querySelector(".tag-rm").addEventListener("click", function (e) {
        e.stopPropagation();
        removeTag(im, t);
      });
      els.lbTags.appendChild(c);
    });

    var addWrap = document.createElement("span");
    addWrap.className = "chip-tag tag-add";
    addWrap.innerHTML = '<input id="lb-tag-input" type="text" placeholder="新标签" maxlength="20" autocomplete="off"><button class="tag-add-btn" title="添加标签">+</button>';
    els.lbTags.appendChild(addWrap);
    var input = addWrap.querySelector("input");
    var btn = addWrap.querySelector("button");
    var doAdd = function () {
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      input.value = "";
      addTag(im, v);
    };
    btn.addEventListener("click", doAdd);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doAdd(); }
    });

    els.lbPrev.disabled = lbList.length <= 1;
    els.lbNext.disabled = lbList.length <= 1;
  }

  function toggleFavorite(id) {
    var im = IMAGES.find(function (item) { return item.id === id; });
    if (!im) return;
    window.electronAPI.updateImage(id, { favorite: !im.favorite }).then(function (r) {
      if (r.ok) { refreshFromResponse(r); renderAll(); if (!els.lb.classList.contains("hidden")) renderLb(); }
      else showNotice("保存失败", r.error || "没有保存收藏状态。");
    });
  }

  function addTag(im, tag) {
    var tags = (im.tags || []).slice();
    if (tags.indexOf(tag) >= 0) return;
    tags.push(tag);
    window.electronAPI.updateImage(im.id, { tags: tags }).then(function (r) {
      if (r.ok) { refreshFromResponse(r); renderAll(); renderLb(); }
      else showNotice("保存失败", r.error || "没有保存标签。");
    });
  }

  function removeTag(im, tag) {
    var tags = (im.tags || []).filter(function (t) { return t !== tag; });
    window.electronAPI.updateImage(im.id, { tags: tags }).then(function (r) {
      if (r.ok) { refreshFromResponse(r); renderAll(); renderLb(); }
      else showNotice("保存失败", r.error || "没有保存标签。");
    });
  }

  /* ---------- 批量操作 ---------- */
  function selectedIds() { return Array.from(state.selection); }

  function batchUpdate(payload) {
    return window.electronAPI.batchUpdateImages(payload).then(function (r) {
      if (r.ok) {
        refreshFromResponse(r);
        renderAll();
      } else {
        showNotice("批量操作失败", r.error || "没有完成批量操作。");
      }
      return r;
    }).catch(function (err) {
      showNotice("批量操作失败", err && err.message ? err.message : "客户端没有完成操作。");
      return { ok: false };
    });
  }

  function batchAddTags() {
    var value = window.prompt("给选中的图片添加哪些标签？多个标签用逗号分隔。", "");
    if (value == null) return;
    var tags = value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (!tags.length) return;
    batchUpdate({ ids: selectedIds(), addTags: tags });
  }

  function batchSetCategory() {
    var value = window.prompt("把选中的图片改成哪个分类？", "");
    if (value == null) return;
    value = value.trim() || "未分类";
    batchUpdate({ ids: selectedIds(), changes: { category: value } });
  }

  function batchDelete() {
    var ids = selectedIds();
    if (!ids.length) return;
    showConfirm("移入回收站", "将选中的 " + ids.length + " 张图片移入回收站，之后仍可恢复。继续吗？", function () {
      window.electronAPI.removeImages(ids).then(function (r) {
        if (r.ok) {
          state.selection.clear();
          refreshFromResponse(r);
          renderAll();
        } else showNotice("操作失败", r.error || "没有完成操作。");
      });
    }, "移入回收站");
  }

  /* ---------- 合集 ---------- */
  function openCollectionsDialog(mode, ids) {
    collectionDialogMode = mode || "manage";
    collectionDialogIds = ids || [];
    els.collectionsTitle.textContent = collectionDialogMode === "assign" ? "加入合集" : "合集与灵感板";
    els.collectionsSubtitle.textContent = collectionDialogMode === "assign" ? "选择一个合集，把选中的图片放进去。" : "把图片按项目、用途或灵感方向整理起来。";
    renderCollectionList();
    els.collectionsDialog.classList.remove("hidden");
    els.collectionsDialog.setAttribute("aria-hidden", "false");
    refreshBodyLock();
  }

  function closeCollectionsDialog() {
    els.collectionsDialog.classList.add("hidden");
    els.collectionsDialog.setAttribute("aria-hidden", "true");
    refreshBodyLock();
  }

  function renderCollectionList() {
    els.collectionList.innerHTML = "";
    if (!DATA.collections.length) {
      els.collectionList.innerHTML = '<div class="panel-empty">还没有合集，先新建一个吧。</div>';
      return;
    }
    DATA.collections.slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), "zh");
    }).forEach(function (c) {
      var row = document.createElement("div");
      row.className = "collection-row";
      var main = document.createElement("button");
      main.className = "collection-main";
      main.innerHTML = "<strong>" + esc(c.name) + "</strong><span>" + collectionCount(c.id) + " 张</span>";
      main.addEventListener("click", function () {
        if (collectionDialogMode === "assign") {
          batchUpdate({ ids: collectionDialogIds, addCollection: c.id }).then(function (r) {
            if (r.ok) closeCollectionsDialog();
          });
        } else {
          state.collectionId = state.collectionId === c.id ? "" : c.id;
          state.favoriteOnly = false;
          closeCollectionsDialog();
          renderAll();
        }
      });
      row.appendChild(main);

      if (collectionDialogMode === "manage") {
        var rename = document.createElement("button");
        rename.className = "row-action";
        rename.textContent = "改名";
        rename.addEventListener("click", function () { renameCollection(c); });
        var remove = document.createElement("button");
        remove.className = "row-action danger-text";
        remove.textContent = "删除";
        remove.addEventListener("click", function () { deleteCollection(c); });
        row.appendChild(rename);
        row.appendChild(remove);
      }
      els.collectionList.appendChild(row);
    });
  }

  function createCollection() {
    var name = window.prompt("新合集名称", "");
    if (name == null || !name.trim()) return;
    window.electronAPI.createCollection(name.trim()).then(function (r) {
      if (!r.ok) { showNotice("创建失败", r.error || "没有创建合集。"); return; }
      refreshFromResponse(r);
      renderAll();
      renderCollectionList();
      if (collectionDialogMode === "assign" && collectionDialogIds.length) {
        batchUpdate({ ids: collectionDialogIds, addCollection: r.collection.id }).then(function (result) {
          if (result.ok) closeCollectionsDialog();
        });
      }
    });
  }

  function renameCollection(c) {
    var name = window.prompt("新的合集名称", c.name);
    if (name == null || !name.trim() || name.trim() === c.name) return;
    window.electronAPI.renameCollection(c.id, name.trim()).then(function (r) {
      if (!r.ok) { showNotice("改名失败", r.error || "没有修改合集名称。"); return; }
      refreshFromResponse(r);
      renderAll();
      renderCollectionList();
    });
  }

  function deleteCollection(c) {
    showConfirm("删除合集", "只删除这个合集，不会删除里面的图片。继续吗？", function () {
      window.electronAPI.deleteCollection(c.id).then(function (r) {
        if (!r.ok) { showNotice("删除失败", r.error || "没有删除合集。"); return; }
        if (state.collectionId === c.id) state.collectionId = "";
        refreshFromResponse(r);
        renderAll();
        renderCollectionList();
      });
    }, "删除合集");
  }

  function deleteImageById(id) {
    showConfirm("移入回收站", "图片会移入回收站，之后仍可恢复。继续吗？", function () {
      window.electronAPI.removeImage(id).then(function (r) {
        if (r.ok) {
          refreshFromResponse(r);
          closeLb();
          renderAll();
        } else showNotice("操作失败", r.error || "没有完成操作。");
      }).catch(function (err) {
        showNotice("操作失败", err && err.message ? err.message : "客户端没有完成操作。");
      });
    }, "移入回收站");
  }

  /* ---------- 比较与拼贴 ---------- */
  function openCompare(ids) {
    if (ids.length < 2 || ids.length > 6) {
      showNotice("需要 2–6 张图片", "请先选择 2 到 6 张图片，再进行比较或拼贴导出。");
      return;
    }
    compareIds = ids.slice();
    els.compareGrid.innerHTML = "";
    compareIds.map(function (id) { return IMAGES.find(function (im) { return im.id === id; }); })
      .filter(Boolean).forEach(function (im) {
        var card = document.createElement("article");
        card.className = "compare-card";
        var img = document.createElement("img");
        img.src = assetUrl(im.file);
        img.alt = im.title || "";
        var title = document.createElement("h3");
        title.textContent = im.title || "未命名";
        var meta = document.createElement("p");
        meta.textContent = (im.category || "未分类") + (im.num ? " · " + im.num : "");
        card.appendChild(img);
        card.appendChild(title);
        card.appendChild(meta);
        els.compareGrid.appendChild(card);
      });
    els.compareSubtitle.textContent = "已选 " + compareIds.length + " 张 · 可导出为一张拼贴参考图";
    els.compareDialog.classList.remove("hidden");
    els.compareDialog.setAttribute("aria-hidden", "false");
    refreshBodyLock();
  }

  function closeCompare() {
    els.compareDialog.classList.add("hidden");
    els.compareDialog.setAttribute("aria-hidden", "true");
    refreshBodyLock();
  }

  function loadCanvasImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = reject;
      image.src = src;
    });
  }

  function exportCollage(ids) {
    var items = ids.map(function (id) { return IMAGES.find(function (im) { return im.id === id; }); }).filter(Boolean);
    if (items.length < 2 || items.length > 6) return;
    var cellW = 480;
    var cellH = 430;
    var cols = items.length <= 2 ? 2 : 3;
    var rows = Math.ceil(items.length / cols);
    var canvas = document.createElement("canvas");
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    var ctx = canvas.getContext("2d");
    var isLight = document.documentElement.dataset.theme === "light";
    ctx.fillStyle = isLight ? "#f5f3ee" : "#0d0e11";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    Promise.all(items.map(function (im) { return loadCanvasImage(assetUrl(im.file)); })).then(function (images) {
      images.forEach(function (image, index) {
        var x = (index % cols) * cellW;
        var y = Math.floor(index / cols) * cellH;
        ctx.fillStyle = isLight ? "#ffffff" : "#1a1b21";
        ctx.fillRect(x + 10, y + 10, cellW - 20, cellH - 20);
        var maxW = cellW - 44;
        var maxH = cellH - 92;
        var scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
        var w = image.naturalWidth * scale;
        var h = image.naturalHeight * scale;
        ctx.drawImage(image, x + (cellW - w) / 2, y + 24 + (maxH - h) / 2, w, h);
        ctx.fillStyle = isLight ? "#1c1d21" : "#eceef1";
        ctx.font = "600 16px -apple-system, BlinkMacSystemFont, sans-serif";
        var title = String(items[index].title || "未命名");
        if (title.length > 28) title = title.slice(0, 27) + "…";
        ctx.fillText(title, x + 24, y + cellH - 31);
        ctx.fillStyle = isLight ? "#6c7077" : "#9aa1ad";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText((items[index].category || "未分类") + (items[index].num ? " · " + items[index].num : ""), x + 24, y + cellH - 14);
      });
      var dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      window.electronAPI.saveCollage({ dataUrl: dataUrl, defaultName: "图库拼贴-" + new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-") + ".jpg" }).then(function (r) {
        if (r && r.ok) showNotice("导出完成", "拼贴图已保存到：\n" + r.path);
      });
    }).catch(function () {
      showNotice("导出失败", "有图片无法读取，暂时无法生成拼贴图。");
    });
  }

  /* ---------- 回收站与备份 ---------- */
  function updateTrashCount() {
    if (els.trashCount) els.trashCount.textContent = String(DATA.trash.length);
  }

  function openTrash() {
    renderTrash();
    els.trashDialog.classList.remove("hidden");
    els.trashDialog.setAttribute("aria-hidden", "false");
    refreshBodyLock();
  }

  function closeTrash() {
    els.trashDialog.classList.add("hidden");
    els.trashDialog.setAttribute("aria-hidden", "true");
    refreshBodyLock();
  }

  function renderTrash() {
    els.trashList.innerHTML = "";
    updateTrashCount();
    if (!DATA.trash.length) {
      els.trashList.innerHTML = '<div class="panel-empty">回收站是空的。</div>';
      els.emptyTrash.disabled = true;
      return;
    }
    els.emptyTrash.disabled = false;
    DATA.trash.forEach(function (entry) {
      var im = entry.image || entry;
      var row = document.createElement("div");
      row.className = "trash-row";
      var img = document.createElement("img");
      img.src = assetUrl(entry.trashThumb || im.thumb || im.file);
      img.alt = im.title || "";
      var info = document.createElement("div");
      info.className = "trash-info";
      var title = document.createElement("strong");
      title.textContent = im.title || "未命名";
      var meta = document.createElement("span");
      meta.textContent = "移入时间 " + String(entry.trashedAt || "").replace("T", " ").slice(0, 16);
      info.appendChild(title);
      info.appendChild(meta);
      var restore = document.createElement("button");
      restore.className = "chip";
      restore.textContent = "恢复";
      restore.addEventListener("click", function () {
        window.electronAPI.restoreImage(im.id).then(function (r) {
          if (!r.ok) { showNotice("恢复失败", r.error || "没有恢复这张图片。"); return; }
          refreshFromResponse(r);
          renderTrash();
          renderAll();
        });
      });
      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(restore);
      els.trashList.appendChild(row);
    });
  }

  function emptyTrash() {
    if (!DATA.trash.length) return;
    showConfirm("彻底清空回收站", "清空后图片和缩略图将无法恢复。确定继续吗？", function () {
      window.electronAPI.emptyTrash().then(function (r) {
        if (!r.ok) { showNotice("清空失败", r.error || "没有清空回收站。"); return; }
        refreshFromResponse(r);
        renderTrash();
      });
    }, "彻底删除");
  }

  function createBackup() {
    window.electronAPI.createBackup().then(function (r) {
      if (r && r.ok) {
        showNotice("备份完成", "已备份 " + r.imageCount + " 张图片。\n位置：\n" + r.folderPath);
      } else if (r && r.error) {
        showNotice("备份失败", r.error);
      }
    }).catch(function (err) {
      showNotice("备份失败", err && err.message ? err.message : "没有完成备份。");
    });
  }

  /* ---------- 版本更新 ---------- */
  function renderChangelog() {
    var versions = CHANGELOG.length ? CHANGELOG : CHANGELOG_FALLBACK;
    els.changelogList.innerHTML = "";
    els.changelogSubtitle.textContent = "当前版本 v" + APP_VERSION + " · 可在 docs/CHANGES.md 继续补充记录。";

    if (!versions.length) {
      els.changelogList.innerHTML = '<div class="panel-empty">暂时没有版本更新记录。</div>';
      return;
    }

    versions.forEach(function (entry) {
      var article = document.createElement("article");
      article.className = "changelog-version" + (entry.version === APP_VERSION ? " current" : "");

      var head = document.createElement("div");
      head.className = "changelog-version-head";
      var version = document.createElement("strong");
      version.className = "changelog-version-id";
      version.textContent = "v" + (entry.version || "未知版本");
      var label = document.createElement("span");
      label.className = "changelog-version-label";
      label.textContent = entry.label || (entry.version === APP_VERSION ? "当前版本" : "历史版本");
      head.appendChild(version);
      head.appendChild(label);
      if (entry.version === APP_VERSION) {
        var current = document.createElement("span");
        current.className = "changelog-current";
        current.textContent = "当前使用";
        head.appendChild(current);
      }
      article.appendChild(head);

      (entry.sections || []).forEach(function (section) {
        var block = document.createElement("section");
        block.className = "changelog-section";
        var title = document.createElement("h3");
        title.textContent = section.title || "其他修改";
        block.appendChild(title);
        var list = document.createElement("ul");
        (section.items || []).forEach(function (item) {
          var li = document.createElement("li");
          li.textContent = item;
          list.appendChild(li);
        });
        block.appendChild(list);
        article.appendChild(block);
      });
      els.changelogList.appendChild(article);
    });
  }

  function openChangelog() {
    var getChangelog = window.electronAPI && window.electronAPI.getChangelog;
    var request = getChangelog ? getChangelog() : Promise.resolve({ ok: false });
    request.then(function (r) {
      if (r && r.ok && Array.isArray(r.versions)) CHANGELOG = r.versions;
    }).catch(function (err) {
      console.error("读取版本更新记录失败，将使用内置记录", err);
    }).then(function () {
      renderChangelog();
      els.changelogDialog.classList.remove("hidden");
      els.changelogDialog.setAttribute("aria-hidden", "false");
      refreshBodyLock();
    });
  }

  function closeChangelog() {
    els.changelogDialog.classList.add("hidden");
    els.changelogDialog.setAttribute("aria-hidden", "true");
    refreshBodyLock();
  }

  /* ---------- Finder / 添加 ---------- */
  function openInFinder() {
    var im = currentLbImage();
    if (im) window.electronAPI.openInFinder(im.file);
  }

  function addImagesFromDialog() {
    window.electronAPI.addImages().then(function (r) {
      if (r.ok) {
        refreshFromResponse(r);
        renderAll();
      }
    });
  }

  /* ---------- 遮罩层 ---------- */
  function refreshBodyLock() {
    var locked = !els.lb.classList.contains("hidden") ||
      !els.collectionsDialog.classList.contains("hidden") ||
      !els.compareDialog.classList.contains("hidden") ||
      !els.trashDialog.classList.contains("hidden") ||
      !els.changelogDialog.classList.contains("hidden") ||
      !els.confirm.classList.contains("hidden");
    document.body.style.overflow = locked ? "hidden" : "";
  }

  function closePanelByName(name) {
    if (name === "collections") closeCollectionsDialog();
    else if (name === "compare") closeCompare();
    else if (name === "trash") closeTrash();
    else if (name === "changelog") closeChangelog();
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    els.search.addEventListener("input", function () {
      state.q = this.value;
      renderActiveBar();
      renderGrid();
    });
    els.sort.addEventListener("change", function () {
      state.sort = this.value;
      if (state.sort !== "shuffle") state.shuffleOrder = null;
      renderGrid();
    });
    els.colorStrip.addEventListener("click", function (e) {
      var rect = els.colorStrip.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      state.color = Math.round(frac * 360) % 360;
      renderAll();
    });
    els.colorStrip.addEventListener("keydown", function (e) {
      var hue = state.color == null ? 180 : state.color;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        state.color = (hue + (e.key === "ArrowRight" ? 5 : -5) + 360) % 360;
        renderAll();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        state.color = e.key === "Home" ? 0 : 360;
        renderAll();
      } else if (e.key === "Escape") {
        e.preventDefault();
        state.color = null;
        renderAll();
      }
    });
    els.colorClear.addEventListener("click", function () {
      state.color = null;
      renderAll();
    });
    els.btnShuffle.addEventListener("click", function () {
      var list = IMAGES.slice();
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      }
      state.shuffleOrder = list.map(function (im) { return im.id; });
      state.sort = "shuffle";
      els.sort.value = "shuffle";
      renderGrid();
    });
    els.btnTheme.addEventListener("click", toggleTheme);
    els.btnAdd.addEventListener("click", addImagesFromDialog);
    els.btnSelect.addEventListener("click", function () {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selection.clear();
      renderAll();
    });
    els.btnCollections.addEventListener("click", function () { openCollectionsDialog("manage", []); });
    els.btnTrash.addEventListener("click", openTrash);
    els.btnBackup.addEventListener("click", createBackup);
    els.btnChangelog.addEventListener("click", openChangelog);

    els.batchFavorite.addEventListener("click", function () { batchUpdate({ ids: selectedIds(), changes: { favorite: true } }); });
    els.batchUnfavorite.addEventListener("click", function () { batchUpdate({ ids: selectedIds(), changes: { favorite: false } }); });
    els.batchTag.addEventListener("click", batchAddTags);
    els.batchCategory.addEventListener("click", batchSetCategory);
    els.batchCollection.addEventListener("click", function () {
      if (selectedIds().length) openCollectionsDialog("assign", selectedIds());
    });
    els.batchCompare.addEventListener("click", function () { openCompare(selectedIds()); });
    els.batchCollage.addEventListener("click", function () { openCompare(selectedIds()); });
    els.batchDelete.addEventListener("click", batchDelete);
    els.batchClear.addEventListener("click", function () {
      state.selection.clear();
      state.selectMode = false;
      renderAll();
    });

    els.lbClose.addEventListener("click", closeLb);
    els.lbBack.addEventListener("click", closeLb);
    els.lbPrev.addEventListener("click", function () { navLb(-1); });
    els.lbNext.addEventListener("click", function () { navLb(1); });
    els.lbFavorite.addEventListener("click", function () {
      var im = currentLbImage();
      if (im) toggleFavorite(im.id);
    });
    els.lbDelete.addEventListener("click", function () {
      var im = currentLbImage();
      if (im) deleteImageById(im.id);
    });
    els.lbFinder.addEventListener("click", openInFinder);
    els.lbCollections.addEventListener("click", function () {
      var im = currentLbImage();
      if (im) openCollectionsDialog("assign", [im.id]);
    });

    els.collectionsClose.addEventListener("click", closeCollectionsDialog);
    els.collectionsDone.addEventListener("click", closeCollectionsDialog);
    els.newCollection.addEventListener("click", createCollection);
    els.compareClose.addEventListener("click", closeCompare);
    els.compareDone.addEventListener("click", closeCompare);
    els.compareExport.addEventListener("click", function () { exportCollage(compareIds); });
    els.trashClose.addEventListener("click", closeTrash);
    els.trashDone.addEventListener("click", closeTrash);
    els.emptyTrash.addEventListener("click", emptyTrash);
    els.changelogClose.addEventListener("click", closeChangelog);
    els.changelogDone.addEventListener("click", closeChangelog);
    document.querySelectorAll("[data-close-panel]").forEach(function (node) {
      node.addEventListener("click", function () { closePanelByName(node.getAttribute("data-close-panel")); });
    });

    els.confirm.querySelector(".confirm-back").addEventListener("click", function () {
      els.confirm.classList.add("hidden");
      refreshBodyLock();
    });

    document.addEventListener("keydown", function (e) {
      var target = e.target;
      var tag = target && target.tagName ? target.tagName : "";
      var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable);

      if (!els.confirm.classList.contains("hidden")) {
        if (e.key === "Escape" && !typing) {
          els.confirm.classList.add("hidden");
          refreshBodyLock();
        }
        return;
      }
      if (!els.lb.classList.contains("hidden")) {
        if (typing) return; // 正在输入标签，不触发快捷键
        if (e.key === "Escape") closeLb();
        else if (e.key === "ArrowLeft") navLb(-1);
        else if (e.key === "ArrowRight") navLb(1);
        else if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          var favIm = currentLbImage();
          if (favIm) toggleFavorite(favIm.id);
        }
        else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          var delIm = currentLbImage();
          if (delIm) deleteImageById(delIm.id);
        }
        return;
      }
      var panelOpen = !els.collectionsDialog.classList.contains("hidden") ||
        !els.compareDialog.classList.contains("hidden") ||
        !els.trashDialog.classList.contains("hidden") ||
        !els.changelogDialog.classList.contains("hidden");
      if (panelOpen) {
        if (e.key === "Escape") {
          if (!els.collectionsDialog.classList.contains("hidden")) closeCollectionsDialog();
          else if (!els.compareDialog.classList.contains("hidden")) closeCompare();
          else if (!els.trashDialog.classList.contains("hidden")) closeTrash();
          else if (!els.changelogDialog.classList.contains("hidden")) closeChangelog();
        }
        return;
      }
      if (typing) return;
      if (state.selectMode && state.selection.size) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          batchDelete();
          return;
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          batchUpdate({ ids: selectedIds(), changes: { favorite: true } });
          return;
        }
      }
      if (e.key === "/") {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (e.key === "Escape" && state.selectMode) {
        state.selection.clear();
        state.selectMode = false;
        renderAll();
      }
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    initTheme();
    els = {
      wordmark: $("wordmark"), stat: $("stat"), search: $("search"), sort: $("sort"),
      btnShuffle: $("btn-shuffle"), btnTheme: $("btn-theme"), btnAdd: $("btn-add"), btnSelect: $("btn-select"),
      btnChangelog: $("btn-changelog"), btnCollections: $("btn-collections"), btnTrash: $("btn-trash"), btnBackup: $("btn-backup"), trashCount: $("trash-count"),
      catBar: $("cat-bar"), tagBar: $("tag-bar"), collectionBar: $("collection-bar"), activeBar: $("active-bar"),
      colorStrip: $("color-strip"), colorMarker: $("color-marker"), colorClear: $("color-clear"), colorCount: $("color-count"),
      selectionBar: $("selection-bar"), selectionCount: $("selection-count"),
      batchFavorite: $("batch-favorite"), batchUnfavorite: $("batch-unfavorite"), batchTag: $("batch-tag"), batchCategory: $("batch-category"),
      batchCollection: $("batch-collection"), batchCompare: $("batch-compare"), batchCollage: $("batch-collage"), batchDelete: $("batch-delete"), batchClear: $("batch-clear"),
      grid: $("grid"), empty: $("empty"),
      lb: $("lb"), lbImg: $("lb-img"), lbBack: $("lb-back"), lbClose: $("lb-close"), lbPrev: $("lb-prev"), lbNext: $("lb-next"),
      lbFavorite: $("lb-favorite"), lbDelete: $("lb-delete"), lbFinder: $("lb-finder"), lbCollections: $("lb-collections"),
      lbNum: $("lb-num"), lbTitle: $("lb-title"), lbCat: $("lb-cat"), lbDesc: $("lb-desc"), lbTags: $("lb-tags"), lbDate: $("lb-date"), lbOrig: $("lb-orig"), lbCount: $("lb-count"),
      collectionsDialog: $("collections-dialog"), collectionsTitle: $("collections-title"), collectionsSubtitle: $("collections-subtitle"), collectionList: $("collection-list"), collectionsClose: $("collections-close"), collectionsDone: $("collections-done"), newCollection: $("new-collection"),
      compareDialog: $("compare-dialog"), compareSubtitle: $("compare-subtitle"), compareGrid: $("compare-grid"), compareClose: $("compare-close"), compareDone: $("compare-done"), compareExport: $("compare-export"),
      trashDialog: $("trash-dialog"), trashList: $("trash-list"), trashClose: $("trash-close"), trashDone: $("trash-done"), emptyTrash: $("empty-trash"),
      changelogDialog: $("changelog-dialog"), changelogSubtitle: $("changelog-subtitle"), changelogList: $("changelog-list"), changelogClose: $("changelog-close"), changelogDone: $("changelog-done"),
      confirm: $("confirm-dialog"), confirmTitle: $("confirm-title"), confirmMsg: $("confirm-message"), confirmOk: $("confirm-ok"), confirmCancel: $("confirm-cancel"),
    };
    els.wordmark.textContent = DATA.title || "图库";
    document.title = (DATA.title || "图库") + " · 图片收藏库";
    var badge = document.createElement("span");
    badge.className = "mode-badge";
    badge.textContent = "APP · v" + APP_VERSION;
    badge.title = "Electron 桌面应用 · 当前版本 " + APP_VERSION;
    els.wordmark.parentNode.insertBefore(badge, els.wordmark.nextSibling);
    bindEvents();
    renderAll();
    updateTrashCount();
  }

  function start() {
    var getLibrary = window.electronAPI && window.electronAPI.getLibrary;
    if (!getLibrary) { init(); return; }
    getLibrary().then(function (r) {
      if (r && r.ok && r.data) {
        DATA = normalizeData(r.data);
        IMAGES = DATA.images;
      }
      if (r && r.assetRoot) ASSET_ROOT = String(r.assetRoot);
      if (r && r.appVersion) APP_VERSION = String(r.appVersion);
    }).catch(function (err) {
      console.error("读取最新图库失败，将使用打包时的数据", err);
    }).then(init);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
