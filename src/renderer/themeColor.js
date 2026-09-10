/** 主题色工具：解析 hex、生成衍生色、可用性校验 */

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((x) => clampByte(x).toString(16).padStart(2, '0')).join('')}`;
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t
  );
}

function srgbChannelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度 0~1 */
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r)
    + 0.7152 * srgbChannelToLinear(g)
    + 0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(a, b) {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const light = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  return (light + 0.05) / (dark + 0.05);
}

/** 与白色背景的对比度（兼容旧调用） */
function contrastWithWhite(hex) {
  return contrastRatio(hex, '#ffffff');
}

/**
 * 主题色是否可用：须为合法 hex，且相对指定背景有足够对比。
 * against 默认白色（白天）；黑夜请传入深色背景。
 */
function isUsableThemeColor(input, { allowShort = true, against = '#ffffff' } = {}) {
  const hex = parseHexColor(input, { allowShort });
  if (!hex) return false;
  const bg = parseHexColor(against) || '#ffffff';
  return contrastRatio(hex, bg) >= 2.6;
}

/** 解析用户输入；非法返回 null。支持 #RGB / #RRGGBB（可省略 #） */
function parseHexColor(input, { allowShort = true } = {}) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return null;
  if (s[0] !== '#') s = `#${s}`;
  if (allowShort && /^#[0-9a-f]{3}$/.test(s)) {
    s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/.test(s)) return null;
  return s;
}

/** 由主色生成一套 CSS 变量所需字段；对比不足或非法返回 null */
function themeFromPrimary(primary, opts = {}) {
  const {
    softMix = '#ffffff',
    hoverMix = '#ffffff',
    activeMix = '#000000',
    against = '#ffffff',
    allowShort = true,
  } = opts;
  const hex = parseHexColor(primary, { allowShort });
  if (!hex || !isUsableThemeColor(hex, { allowShort, against })) return null;
  const { r, g, b } = hexToRgb(hex);
  const softT = softMix.toLowerCase() === '#ffffff' ? 0.9 : 0.78;
  return {
    primary: hex,
    hover: mixHex(hex, hoverMix, 0.22),
    active: mixHex(hex, activeMix, 0.14),
    soft: mixHex(hex, softMix, softT),
    ring: hex,
    rgb: `${r},${g},${b}`,
  };
}

/**
 * 预览色：
 * - 完整 6 位且对比度够 → 显示该色
 * - 否则黑色（格式不对 / 不可用）
 */
function previewColor(input, { against = '#ffffff' } = {}) {
  const hex = parseHexColor(input, { allowShort: false });
  if (hex && isUsableThemeColor(hex, { allowShort: false, against })) return hex;
  return '#000000';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseHexColor,
    themeFromPrimary,
    previewColor,
    mixHex,
    isUsableThemeColor,
    contrastWithWhite,
    contrastRatio,
  };
}
