#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片收藏库 · 管理脚本

用法：
  python3 add.py add 图片1.jpg 图片2.png [--title 标题] [--category 分类] [--tags 标签1,标签2] [--desc 描述]
  python3 add.py remove <id> [id...]
  python3 add.py restore <id> [id...]
  python3 add.py list [--category 分类] [--tag 标签]
  python3 add.py rebuild

说明：
  - add 会把图片复制进 images/，自动生成缩略图到 thumbs/，并更新 library.json 与 library-data.js
  - 不支持的格式（如 HEIC）在 macOS 上会先用 sips 转成 jpg
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(ROOT, "images")
THUMB_DIR = os.path.join(ROOT, "thumbs")
TRASH_DIR = os.path.join(ROOT, "trash")
TRASH_IMG_DIR = os.path.join(TRASH_DIR, "images")
TRASH_THUMB_DIR = os.path.join(TRASH_DIR, "thumbs")
DATA_FILE = os.path.join(ROOT, "library.json")
DATA_JS = os.path.join(ROOT, "library-data.js")

SUPPORTED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
THUMB_SIZE = 480


def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {"version": 1, "title": "图库", "categories": [], "images": []}
    data.setdefault("collections", [])
    data.setdefault("trash", [])
    data.setdefault("images", [])
    for img in data["images"]:
        img.setdefault("tags", [])
        img.setdefault("collections", [])
        img.setdefault("favorite", False)
    return data


def save_data(data):
    data.setdefault("collections", [])
    data.setdefault("trash", [])
    cats = []
    for img in data["images"]:
        if img.get("category") and img["category"] not in cats:
            cats.append(img["category"])
    data["categories"] = cats
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    write_data_js(data)


def write_data_js(data):
    js = ("// 本文件由 add.py 自动生成，请勿手动编辑\n"
          "window.LIBRARY_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write(js)


def make_thumb(src, dst, size=THUMB_SIZE):
    """生成缩略图；无 Pillow 时直接复制原图。返回说明文字。

    GIF 多帧时取中间帧作缩略图（避免第一帧是封面/标题占位帧）。"""
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(src, dst)
        return "原图复制"
    try:
        im = Image.open(src)
        if im.format == "GIF" and getattr(im, "n_frames", 1) > 1:
            im.seek(im.n_frames // 2)
            im = im.convert("RGB")
        else:
            im.seek(0)
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[3])
                im = bg
            else:
                im = im.convert("RGB")
        im.thumbnail((size, size), Image.LANCZOS)
        im.save(dst, "JPEG", quality=84, optimize=True)
        return "缩略图"
    except Exception:
        shutil.copyfile(src, dst)
        return "原图复制(回退)"


def _color_dist_sq(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def extract_palette(src, n=5):
    """从图片（缩略图或原图）提取 n 个主色，返回 ['#rrggbb', ...]；失败返回 []。

    用于前端「按颜色筛选」功能。忽略低饱和/近黑/近白像素，让有彩色的像素主导主色板，
    再量化到 16 步长统计频率，按色距去重取前 n 个。"""
    try:
        from PIL import Image
    except ImportError:
        return []
    try:
        im = Image.open(src)
        im = im.convert("RGB")
        im.thumbnail((48, 48), Image.LANCZOS)
    except Exception:
        return []
    step = 16
    chroma_min = 24
    counts = {}
    try:
        px = im.getdata()
    except Exception:
        return []
    chroma_px = []
    for (r, g, b) in px:
        if max(r, g, b) - min(r, g, b) >= chroma_min:
            chroma_px.append((r, g, b))
    if len(chroma_px) < 60:
        chroma_px = list(px)  # 近乎灰阶的图，退回全像素
    for (r, g, b) in chroma_px:
        key = (r - r % step, g - g % step, b - b % step)
        counts[key] = counts.get(key, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    palette = []
    for color, _cnt in ordered:
        if any(_color_dist_sq(color, c) < 900 for c in palette):
            continue
        palette.append(color)
        if len(palette) >= n:
            break
    return ["#%02x%02x%02x" % c for c in palette]


def sips_convert_to_jpeg(src, dst):
    try:
        r = subprocess.run(["sips", "-s", "format", "jpeg", src, "--out", dst],
                           capture_output=True, timeout=120)
        return r.returncode == 0 and os.path.exists(dst)
    except Exception:
        return False


def unique_path(folder, filename):
    stem, ext = os.path.splitext(filename)
    p = os.path.join(folder, filename)
    i = 1
    while os.path.exists(p):
        p = os.path.join(folder, f"{stem}_{i}{ext}")
        i += 1
    return p


def move_to_trash(img):
    """把原图和缩略图移入可恢复的 trash 目录，并保留原始相对路径。"""
    os.makedirs(TRASH_IMG_DIR, exist_ok=True)
    os.makedirs(TRASH_THUMB_DIR, exist_ok=True)
    token = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", img.get("id", "image"))
    file_name = f"{token}-{safe_id}-{os.path.basename(img.get('file', 'image'))}"
    thumb_name = f"{token}-{safe_id}-{os.path.basename(img.get('thumb', 'thumb.jpg'))}"
    trash_file = unique_path(TRASH_IMG_DIR, file_name)
    trash_thumb = unique_path(TRASH_THUMB_DIR, thumb_name)
    src_file = os.path.join(ROOT, img.get("file", "")) if img.get("file") else ""
    src_thumb = os.path.join(ROOT, img.get("thumb", "")) if img.get("thumb") else ""
    moved_file = False
    moved_thumb = False
    if src_file and os.path.exists(src_file):
        shutil.move(src_file, trash_file)
        moved_file = True
    if src_thumb and os.path.exists(src_thumb):
        shutil.move(src_thumb, trash_thumb)
        moved_thumb = True
    return {
        "image": json.loads(json.dumps(img)),
        "trashFile": os.path.relpath(trash_file, ROOT) if moved_file else None,
        "trashThumb": os.path.relpath(trash_thumb, ROOT) if moved_thumb else None,
        "trashedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    }


def clean_title(name):
    stem = os.path.splitext(os.path.basename(name))[0]
    stem = re.sub(r"[_\-\s]+", " ", stem).strip()
    return stem or "未命名"


def next_id(data):
    today = datetime.date.today().strftime("%Y%m%d")
    prefix = today + "-"
    max_n = 0
    for im in data["images"]:
        im_id = im.get("id", "")
        if im_id.startswith(prefix):
            try:
                max_n = max(max_n, int(im_id[len(prefix):]))
            except ValueError:
                pass
    return f"{today}-{max_n + 1:03d}"


def next_num(data):
    """下一个库编号，如 K000000001 → K000000002。按现有 K 编号最大值 +1。"""
    max_n = 0
    for im in data["images"]:
        n = im.get("num", "")
        if n.startswith("K"):
            try:
                max_n = max(max_n, int(n[1:]))
            except ValueError:
                pass
    return f"K{max_n + 1:09d}"


def cmd_add(args):
    if not args.paths:
        print("✗ 请提供至少一个图片路径")
        sys.exit(1)
    data = load_data()
    os.makedirs(IMG_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)
    for p in args.paths:
        if not os.path.exists(p):
            print(f"✗ 文件不存在: {p}")
            continue
        ext = os.path.splitext(p)[1].lower()
        src = p
        if ext not in SUPPORTED_EXT:
            if sys.platform != "darwin":
                print(f"✗ 不支持的格式: {p}")
                continue
            print(f"⚠ {ext or '未知'} 格式，尝试用 sips 转换…")
            converted = os.path.join(ROOT, ".convert_tmp.jpg")
            if not sips_convert_to_jpeg(p, converted):
                print(f"✗ 转换失败: {p}")
                continue
            src, ext = converted, ".jpg"
        fname = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ext
        dst = unique_path(IMG_DIR, fname)
        shutil.copy2(src, dst)
        if src != p:
            os.remove(src)
        thumb = unique_path(THUMB_DIR, os.path.splitext(os.path.basename(dst))[0] + ".jpg")
        mode = make_thumb(dst, thumb)
        img = {
            "id": next_id(data),
            "num": next_num(data),
            "file": os.path.relpath(dst, ROOT),
            "thumb": os.path.relpath(thumb, ROOT),
            "title": args.title or clean_title(p),
            "category": args.category or "未分类",
            "tags": [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags else [],
            "colors": extract_palette(thumb),
            "collections": [],
            "favorite": False,
            "desc": args.desc or "",
            "added": datetime.date.today().isoformat(),
        }
        data["images"].insert(0, img)
        print(f"✓ [{img['id']}] {img['title']} ｜ {img['category']} ｜ {mode}")
    save_data(data)
    print(f"共 {len(data['images'])} 张")


def cmd_remove(args):
    data = load_data()
    ids = set(args.ids)
    kept, removed = [], 0
    moved = []
    for im in data["images"]:
        if im["id"] in ids:
            moved.append(move_to_trash(im))
            print(f"↩ 已移入回收站 [{im['id']}] {im['title']}")
            removed += 1
        else:
            kept.append(im)
    data["images"] = kept
    data["trash"] = moved + data.get("trash", [])
    save_data(data)
    print(f"移入回收站 {removed} 张，剩余 {len(kept)} 张")


def cmd_restore(args):
    data = load_data()
    wanted = set(args.ids)
    kept = []
    restored = 0
    for entry in data.get("trash", []):
        img = entry.get("image", entry)
        if img.get("id") not in wanted:
            kept.append(entry)
            continue
        os.makedirs(IMG_DIR, exist_ok=True)
        os.makedirs(THUMB_DIR, exist_ok=True)
        dest_file = os.path.join(ROOT, img.get("file", ""))
        if os.path.exists(dest_file):
            dest_file = unique_path(IMG_DIR, os.path.basename(dest_file))
            img["file"] = os.path.relpath(dest_file, ROOT)
        source_file = os.path.join(ROOT, entry.get("trashFile", "")) if entry.get("trashFile") else ""
        if source_file and os.path.exists(source_file):
            shutil.move(source_file, dest_file)
        elif not os.path.exists(dest_file):
            print(f"✗ 原图不存在，无法恢复 [{img.get('id')}] {img.get('title')}")
            kept.append(entry)
            continue

        dest_thumb = os.path.join(ROOT, img.get("thumb", ""))
        if os.path.exists(dest_thumb):
            dest_thumb = unique_path(THUMB_DIR, os.path.basename(dest_thumb))
            img["thumb"] = os.path.relpath(dest_thumb, ROOT)
        source_thumb = os.path.join(ROOT, entry.get("trashThumb", "")) if entry.get("trashThumb") else ""
        if source_thumb and os.path.exists(source_thumb):
            shutil.move(source_thumb, dest_thumb)
        elif not os.path.exists(dest_thumb):
            make_thumb(dest_file, dest_thumb)
        if not img.get("colors"):
            target = dest_thumb if os.path.exists(dest_thumb) else dest_file
            colors = extract_palette(target) if os.path.exists(target) else []
            if colors:
                img["colors"] = colors
        data["images"].insert(0, img)
        restored += 1
        print(f"✓ 已恢复 [{img.get('id')}] {img.get('title')}")
    data["trash"] = kept
    save_data(data)
    print(f"恢复 {restored} 张，回收站剩余 {len(kept)} 张")


def cmd_list(args):
    data = load_data()
    imgs = data["images"]
    if args.category:
        imgs = [im for im in imgs if im.get("category") == args.category]
    if args.tag:
        imgs = [im for im in imgs if args.tag in (im.get("tags") or [])]
    for im in imgs:
        print(f"[{im['id']}] {im['title']} ｜ {im.get('category')} ｜ {'、'.join(im.get('tags') or [])}")
    print(f"共 {len(imgs)} 张")


def cmd_rebuild(args):
    data = load_data()
    os.makedirs(THUMB_DIR, exist_ok=True)
    for im in data["images"]:
        src_path = os.path.join(ROOT, im["file"]) if im.get("file") else ""
        thumb_path = os.path.join(ROOT, im["thumb"]) if im.get("thumb") else ""
        if src_path and thumb_path and os.path.exists(src_path) and not os.path.exists(thumb_path):
            make_thumb(src_path, thumb_path)
            print(f"→ 生成缩略图 {im['thumb']}")
        if not im.get("colors"):
            target = thumb_path if (thumb_path and os.path.exists(thumb_path)) else (src_path if src_path and os.path.exists(src_path) else "")
            if target:
                colors = extract_palette(target)
                if colors:
                    im["colors"] = colors
                    print(f"→ 提取主色 {im['id']}: {', '.join(colors[:3])}")
    save_data(data)
    print("✓ library.json 与 library-data.js 已重建")


def main():
    parser = argparse.ArgumentParser(description="图片收藏库管理")
    sub = parser.add_subparsers(dest="cmd")

    p_add = sub.add_parser("add", help="添加图片并自动分类入库")
    p_add.add_argument("paths", nargs="+")
    p_add.add_argument("--title", default="")
    p_add.add_argument("--category", default="")
    p_add.add_argument("--tags", default="")
    p_add.add_argument("--desc", default="")
    p_add.set_defaults(fn=cmd_add)

    p_rm = sub.add_parser("remove", help="把图片移入回收站（按 id）")
    p_rm.add_argument("ids", nargs="+")
    p_rm.set_defaults(fn=cmd_remove)

    p_restore = sub.add_parser("restore", help="从回收站恢复图片（按 id）")
    p_restore.add_argument("ids", nargs="+")
    p_restore.set_defaults(fn=cmd_restore)

    p_ls = sub.add_parser("list", help="列出图片")
    p_ls.add_argument("--category", default="")
    p_ls.add_argument("--tag", default="")
    p_ls.set_defaults(fn=cmd_list)

    p_rb = sub.add_parser("rebuild", help="重建数据文件与缺失缩略图")
    p_rb.set_defaults(fn=cmd_rebuild)

    args = parser.parse_args()
    if not getattr(args, "cmd", None):
        parser.print_help()
        sys.exit(1)
    args.fn(args)


if __name__ == "__main__":
    main()
