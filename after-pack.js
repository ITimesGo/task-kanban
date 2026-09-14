// electron-builder afterPack：
// 1) 裁剪 Electron 多语言 locales（只留中/英）
// 2) 用纯 JS（resedit）把自定义 ICO 写入 exe —— 避免 signAndEditExecutable
//    触发 winCodeSign 解压（需要创建符号链接，普通用户常无权限）
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const { NtExecutable, NtExecutableResource } = require('pe-library');

function trimLocales(appOutDir) {
  const localesDir = path.join(appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  const keep = (name) => {
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
}

function applyExeIcon(appOutDir, productFilename, projectDir) {
  if (process.platform !== 'win32') return;

  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  const icoPath = path.join(projectDir, 'assets', 'icon.ico');
  if (!fs.existsSync(exePath)) {
    console.warn(`[after-pack] 未找到 exe: ${exePath}`);
    return;
  }
  if (!fs.existsSync(icoPath)) {
    console.warn(`[after-pack] 未找到图标: ${icoPath}`);
    return;
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const icons = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);

  if (groups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
  } else {
    for (const g of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
    }
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`[after-pack] 已写入自定义图标: ${exePath}`);
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir || context.outDir;
  const projectDir = context.packager?.projectDir || path.join(__dirname);
  const productFilename =
    context.packager?.appInfo?.productFilename ||
    context.packager?.appInfo?.productName ||
    '任务看板';

  trimLocales(appOutDir);
  if (context.electronPlatformName === 'win32') {
    applyExeIcon(appOutDir, productFilename, projectDir);
  }
};
