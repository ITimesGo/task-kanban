// electron-builder afterPack 钩子：打包后裁剪 Electron 自带的多语言文件，
// 只保留中文（简体/繁体）和英文兜底，减小体积。这是无风险裁剪，不影响功能。
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir || context.outDir;
  const localesDir = path.join(appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  const keep = (name) => {
    // 保留 zh-CN / zh-TW / zh-cn / en-US，其余删除
    const lower = name.toLowerCase();
    return lower.startsWith('zh') || lower.startsWith('zh-') ||
           lower === 'en-us.pak' || lower === 'en-us';
  };

  for (const file of fs.readdirSync(localesDir)) {
    if (!keep(file)) {
      try { fs.unlinkSync(path.join(localesDir, file)); } catch (_) {}
    }
  }
  console.log(`[after-pack] 裁剪 locales 完成，保留: ${fs.readdirSync(localesDir).join(', ')}`);
};
