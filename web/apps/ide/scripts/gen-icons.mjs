// Renders the app icon source (desktop/src-tauri/icons/icon-source.svg) at
// every Windows ICO size straight from vector art, so small sizes stay
// crisp instead of being scaled down from a bitmap. The 512px PNG is the
// store/display icon (icon.png). Outputs land in desktop/src-tauri/icons/.
//
// Usage (from web/apps/ide): node scripts/gen-icons.mjs

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..', '..', '..');
const iconsDir = join(root, 'desktop', 'src-tauri', 'icons');
// Windows asks the icon resource for exact DPI-dependent sizes (the taskbar
// uses 16-40px); every plausible target gets a native entry so the shell
// never has to scale a nearby bitmap (which is what makes it look soft).
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512];

const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage();
const svg = readFileSync(join(iconsDir, 'icon-source.svg'), 'utf8');

for (const size of SIZES) {
  const sized = svg.replace('<svg', `<svg width="${size}" height="${size}"`);
  await page.setContent(
    `<div style="width:${size}px;height:${size}px">${sized}</div>`,
  );
  const png = await page
    .locator('svg')
    .first()
    .screenshot({ type: 'png' });
  writeFileSync(join(iconsDir, size === 512 ? 'icon.png' : `.icon-${size}.png`), png);
  console.log(`rendered ${size}px`);
}
await browser.close();

// Assemble the multi-size ICO from the rendered PNGs (32-bit DIBs + PNG for
// 256), then drop the scratch PNGs (the 512px icon.png is the display icon).
const python =
  process.env.PYTHON ||
  ['python', 'py', 'python3'].find((candidate) => {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
if (!python) {
  console.error('python not found; keep scratch PNGs and run scripts/build-ico.py manually');
  process.exit(1);
}
try {
  execFileSync(python, [join(here, 'build-ico.py')], { stdio: 'inherit' });
} catch (error) {
  console.error('build-ico.py failed; keeping scratch PNGs:', error.message);
  process.exit(1);
}
for (const size of SIZES) {
  if (size !== 512) {
    unlinkSync(join(iconsDir, `.icon-${size}.png`));
  }
}
console.log('done: icon.ico + icon.png regenerated');
