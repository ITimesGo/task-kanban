const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// plugins.js 依赖 electron app；这里只校验目录常量与 catalog 形状通过 ocr cleanup 旁路
// 轻量：直接读源文件确保 catalog 含 ocr
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main/plugins.js'), 'utf8');

describe('plugins catalog', () => {
  it('declares ocr plugin metadata', () => {
    assert.match(src, /id:\s*'ocr'/);
    assert.match(src, /clipboard-quick/);
    assert.match(src, /ocr-search/);
    assert.match(src, /图片文字识别/);
    assert.match(src, /在图片预览中提取可复制文字/);
    assert.match(src, /PLUGIN_CATALOG/);
  });
});
