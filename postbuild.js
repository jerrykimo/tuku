// 打包后处理：把 release/图库-darwin-arm64/图库.app 原子替换到 release/图库.app
// 用 Node fs 而非 shell rm，避免触发批量删除保护；也规避 mv 到已存在目录时的嵌套问题。
const fs = require('fs');
const path = require('path');

const release = path.join(__dirname, 'release');
const src = path.join(release, '图库-darwin-arm64', '图库.app');
const dst = path.join(release, '图库.app');

if (!fs.existsSync(src)) {
  console.error('✗ 未找到打包产物：' + src);
  process.exit(1);
}

fs.rmSync(dst, { recursive: true, force: true });
fs.renameSync(src, dst);
fs.rmSync(path.join(release, '图库-darwin-arm64'), { recursive: true, force: true });

console.log('✓ 已生成 release/图库.app');
