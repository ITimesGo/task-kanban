/**
 * 从 assets/icon.png 生成 Windows 用多尺寸 icon.ico
 * 用法: node scripts/gen-icon.mjs
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = path.join(root, 'assets', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const bufs = [];
for (const s of sizes) {
  bufs.push(await sharp(pngPath).resize(s, s, { fit: 'cover' }).png().toBuffer());
}
const ico = await pngToIco(bufs);
fs.writeFileSync(icoPath, ico);
console.log(`wrote ${icoPath} (${ico.length} bytes)`);
