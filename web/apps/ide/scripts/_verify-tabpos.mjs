import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = EDGE_CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
try {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForSelector('.model-canvas', { timeout: 20_000 });
  const snap = () => page.evaluate(() => {
    const ws = document.querySelector('.model-workspace').getBoundingClientRect();
    const tab = document.querySelector('.dsl-edge-tab').getBoundingClientRect();
    const editor = document.querySelector('.dsl-editor')?.getBoundingClientRect() ?? null;
    return {
      open: !!editor,
      ws: { left: Math.round(ws.left), right: Math.round(ws.right), width: Math.round(ws.width) },
      tab: { left: Math.round(tab.left), right: Math.round(tab.right) },
      editor: editor ? { left: Math.round(editor.left), right: Math.round(editor.right) } : null,
      tabGapFromWsRight: Math.round(ws.right - tab.right),
      tabGapFromEditorLeft: editor ? Math.round(tab.left - editor.left) : null,
      tabGapFromEditorRight: editor ? Math.round(editor.right - tab.right) : null,
    };
  });
  console.log('collapsed:', JSON.stringify(await snap()));
  await page.locator('.dsl-edge-tab').click();
  await page.waitForTimeout(150);
  console.log('open:', JSON.stringify(await snap()));
} finally { await browser.close(); }
