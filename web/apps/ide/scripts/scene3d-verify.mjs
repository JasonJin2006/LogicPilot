// Browser verification for the 3D Scene panel.
//
// The point of this test is the one thing a unit test cannot check: that the
// panel actually draws. A Three.js view can mount, hold a populated scene and
// report a healthy object count while rendering nothing at all — a wrong camera,
// a missing light or a zero-size surface all produce a blank frame and no error.
// So the assertions read the framebuffer back and require it to be non-uniform.
//
// Software WebGL (`--enable-unsafe-swiftshader`) makes that possible without a
// GPU on the machine; it is slow, which is why the scene stays small and nothing
// here asserts performance.
//
// Prereqs: the Vite dev server from scripts/test-scene3d-browser.mjs.
// Usage: node web/apps/ide/scripts/scene3d-verify.mjs

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const repoRoot = join(here, '..', '..', '..', '..');
const OUT = join(repoRoot, '.verify', 'out');
mkdirSync(OUT, { recursive: true });

const NEWLINE = String.fromCharCode(10);

const log = (...args) => console.log('[scene3d]', ...args);
const failures = [];
function check(condition, label) {
  if (condition) {
    log(`  ok ${label}`);
    return;
  }
  failures.push(label);
  log(`  FAIL ${label}`);
}

const EDGE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = EDGE_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('[scene3d] no Chrome/Chromium/Edge executable found');
  process.exit(1);
}

// A real model from the repository, so the scene has genuine nodes and edges
// rather than a fixture invented for the test.
const modelSource = readFileSync(join(repoRoot, 'examples', 'mm1.lp'), 'utf8');
// No presentation file on purpose. A bundle whose presentation declares an
// empty `edges` array replaces the model's own couplings: opening the same model
// with one yields 0 edges, without one yields the 3 the DSL declares. The 3D
// view must be checked against a document that actually has connections.
const projectBundle = {
  schema: 'logicpilot.project',
  format: 'bundle',
  version: 1,
  manifest: {
    name: 'Scene3DDemo',
    model: 'model/main.lp',
    presentation: null,
    defaultExperiment: null,
    defaults: { seed: 42, schemaVersion: 2 },
  },
  files: {
    'model/main.lp': modelSource,
  },
};

// mm1.lp declares three `couple` lines, so a faithful document has three edges.
const EXPECTED_EDGES = 3;

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // This test deliberately runs without the simulation gateway: the structure
  // view renders the editor's own document and needs no run. The IDE's runtime
  // page still probes the fixed gateway port, so that one refusal is expected
  // and allowlisted narrowly - anything else still fails the run.
  if (text.includes('ws://127.0.0.1:8089/sim') && text.includes('ERR_CONNECTION_REFUSED')) return;
  consoleErrors.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

try {
  const port = process.env.LOGICPILOT_BROWSER_PORT ?? '5173';
  const url = `http://127.0.0.1:${port}`;
  log(`loading ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.area-center', { timeout: 20_000 });
  await page.waitForTimeout(500);

  // Seed through the real open path rather than by reaching into stores.
  await page
    .locator('input[type="file"][accept=".lpproj,.lp,.sysml,.json"]')
    .first()
    .setInputFiles({
      name: 'scene3d.lpproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(projectBundle)),
    });
  await page.waitForSelector('.model-block', { timeout: 30_000 });
  const modelNodeCount = await page.locator('.model-block').count();
  check(modelNodeCount > 0, `the 2D canvas rendered the seeded model (${modelNodeCount} blocks)`);
  log('model seeded through the project open path');

  // Open the scene through the canvas toolbar button, which is the path a user
  // takes. The Scene tab then appears next to Model.
  await page.getByRole('button', { name: '3D scene' }).click();
  await page.waitForSelector('.area-center .tab', { timeout: 10_000 });
  await page.locator('.area-center .tab').filter({ hasText: 'Scene' }).click();
  await page.waitForSelector('[data-testid="scene3d-workspace"]', { timeout: 20_000 });
  await page.waitForFunction(
    () => typeof window.__logicpilotScene3d !== 'undefined',
    undefined,
    { timeout: 20_000 },
  );
  // three.js is lazy: give the chunk and the first frames time to land.
  await page.waitForFunction(
    () => (window.__logicpilotScene3d?.stats()?.frames ?? 0) > 0,
    undefined,
    { timeout: 30_000 },
  );
  log('scene panel mounted and rendered at least one frame');

  const stats = await page.evaluate(() => window.__logicpilotScene3d.stats());
  check(stats.contextAvailable, 'a WebGL context was created');
  check(
    stats.objectCount === modelNodeCount,
    `the scene has one object per model block (scene ${stats.objectCount}, canvas ${modelNodeCount})`,
  );
  // Cross-view consistency: the 3D scene must agree with what the product's own
  // 2D canvas drew from the same document. This is the assertion that catches
  // the projection dropping edges, and it stays meaningful whatever the seed.
  const svgEdgePaths = await page.locator('.model-edges path, .model-edges line, .model-edges polyline').count();
  check(
    stats.linkCount === EXPECTED_EDGES,
    `every declared connection became a link (${stats.linkCount} of ${EXPECTED_EDGES})`,
  );
  check(
    svgEdgePaths >= stats.linkCount,
    `the 2D canvas drew at least as many edges as the 3D scene (2D ${svgEdgePaths}, 3D ${stats.linkCount})`,
  );

  // The readout must agree with the scene immediately, not after the next poll:
  // a status line reading "0 nodes" over a drawn scene is a lie the user sees.
  const statusCount = await page.locator('[data-testid="scene3d-object-count"]').textContent();
  check(
    Number(statusCount) === modelNodeCount,
    `the readout reports the node count without waiting for a poll (${statusCount ?? 'none'})`,
  );

  const surface = await page.locator('[data-testid="scene3d-surface"]').boundingBox();
  check(
    surface !== null && surface.width > 100 && surface.height > 100,
    `the drawing surface has a usable size (${Math.round(surface?.width ?? 0)}x${Math.round(surface?.height ?? 0)})`,
  );

  // The assertion that matters: the framebuffer is not a flat fill. Object count
  // and frame count can both look healthy while nothing is actually drawn.
  const pixels = await page.evaluate(() => window.__logicpilotScene3d.samplePixels());
  check(pixels !== null, 'the framebuffer could be sampled');
  if (pixels !== null) {
    check(
      pixels.variance > 3,
      `the frame is not blank (luminance variance ${pixels.variance.toFixed(2)}, sampled ${pixels.sampled})`,
    );
    check(
      pixels.distinctColors > 8,
      `the frame has real shading, not one flat colour (${pixels.distinctColors} distinct colours)`,
    );
  }

  await page.screenshot({ path: join(OUT, 'scene3d-1-structure.png') });

  // Picking: synthesise a real click at the node's projected pixel so the
  // ray-cast path runs, then confirm the shared model store took the selection.
  const targetId = await page.evaluate(() => window.__logicpilotScene3d.objectIds()[0] ?? null);
  check(typeof targetId === 'string', 'the scene exposes node ids for picking');
  if (typeof targetId === 'string') {
    await page.evaluate((id) => window.__logicpilotScene3d.select(null), targetId);
    const point = await page.evaluate(
      (id) => window.__logicpilotScene3d.projectNode(id),
      targetId,
    );
    check(point !== null, 'the node could be projected to screen space');
    if (point !== null && surface !== null) {
      await page.mouse.click(surface.x + point.x, surface.y + point.y);
      await page.waitForTimeout(300);
      const selected = await page.evaluate(() => window.__logicpilotScene3d.stats().selectedId);
      check(
        selected === targetId,
        `clicking a node in 3D selected it in the shared model store (${String(selected)})`,
      );
      const status = await page.locator('[data-testid="scene3d-selected"]').textContent();
      check(
        (status ?? '').length > 0 && !(status ?? '').includes('nothing selected'),
        `the panel reports the selection (${status ?? ''})`,
      );
    }
  }

  // The 2D canvas must show the same selection: one selection model, two views.
  const svgSelected = await page.locator('.model-block.selected').count();
  check(svgSelected > 0, 'the 2D canvas reflects the selection made in 3D');

  // Orbiting must change the rendered frame, which is the cheapest evidence the
  // camera is driving the renderer rather than the scene being frozen.
  const before = await page.evaluate(() => window.__logicpilotScene3d.stats().frames);
  await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width / 2 + 120, surface.y + surface.height / 2 + 40, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__logicpilotScene3d.stats().frames);
  check(after > before, `orbiting drove further frames (${before} -> ${after})`);
  await page.screenshot({ path: join(OUT, 'scene3d-2-orbited.png') });

  // Switching away and back must not leave a broken or duplicated canvas.
  await page.locator('.area-center .tab').filter({ hasText: 'Model' }).click();
  await page.locator('.area-center .tab').filter({ hasText: 'Scene' }).click();
  await page.waitForTimeout(500);
  const canvasCount = await page.locator('[data-testid="scene3d-surface"] canvas').count();
  check(canvasCount === 1, `exactly one canvas after tab switching (${canvasCount})`);

  // Closing the tab and reopening it must build a fresh, working surface rather
  // than leaving an orphaned context.
  await page.locator('.area-center .tab').filter({ hasText: 'Scene' }).locator('.tab-x').click();
  await page.waitForTimeout(300);
  const afterClose = await page.locator('[data-testid="scene3d-surface"] canvas').count();
  check(afterClose === 0, `closing the tab unmounts the canvas (${afterClose})`);
  await page.getByRole('button', { name: '3D scene' }).click();
  await page.waitForSelector('[data-testid="scene3d-workspace"]', { timeout: 20_000 });
  await page.locator('.area-center .tab').filter({ hasText: 'Scene' }).click();
  await page.waitForFunction(
    () => (window.__logicpilotScene3d?.stats()?.frames ?? 0) > 0,
    undefined,
    { timeout: 30_000 },
  );
  const reopened = await page.evaluate(() => window.__logicpilotScene3d.samplePixels());
  check(
    reopened !== null && reopened.variance > 3,
    `the reopened scene renders again (variance ${reopened?.variance.toFixed(2) ?? 'n/a'})`,
  );

  // --- milestone 2: live agents -------------------------------------------------
  //
  // The wire frames describe agents as queue slot indices, so this is the only
  // place that can prove the mapping, the interpolation and the renderer agree:
  // the markers must appear when a run starts and must move while it runs.

  // Steps are named so a timeout says which interaction failed.
  const step = async (label, action) => {
    try {
      await action();
    } catch (error) {
      // Only the first line: Playwright's call log is noise here.
      const firstLine = String(error.message).split(NEWLINE)[0];
      throw new Error(`while ${label}: ${firstLine}`);
    }
  };

  // Connect the runtime first: the gateway is what produces wire frames.
  await step('opening settings', () => page.getByRole('button', { name: 'Settings' }).click());
  await step('waiting for the settings dialog', () =>
    page.getByRole('dialog', { name: 'Settings' }).waitFor(),
  );
  await step('opening the runtime page', () =>
    page.locator('.settings-nav button', { hasText: '运行环境' }).click(),
  );
  await step('revealing the advanced controls', () =>
    page.locator('details.settings-advanced summary').click(),
  );
  await page
    .waitForFunction(() => document.querySelector('.conn-connected') !== null, undefined, {
      timeout: 15_000,
    })
    .catch(async () => {
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.waitForSelector('.conn-connected', { timeout: 10_000 });
    });
  await step('closing settings', () =>
    page.getByRole('button', { name: 'Close', exact: true }).click(),
  );

  // Run from the Model tab: the Run action lives in that canvas's tab bar.
  await step('switching to the Model tab', () =>
    page.locator('.area-center .tab').filter({ hasText: 'Model' }).click(),
  );
  await step('opening the run dialog', () =>
    page.getByRole('button', { name: 'Run', exact: true }).click(),
  );
  await step('waiting for the run dialog', () =>
    page.getByRole('dialog', { name: 'Run' }).waitFor(),
  );
  await step('selecting animated mode', () =>
    page
      .locator('label.field')
      .filter({ hasText: 'execution mode' })
      .locator('select')
      .selectOption('animated'),
  );
  for (const [label, value] of [
    // Long enough that the run is still live while the samples below are taken:
    // an animated run that finishes first empties the agent layer legitimately,
    // and a check that races the clock reports a fault that is not there.
    ['arrivals', '120'],
    ['warmup', '0'],
    ['speed', '4'],
    ['reps', '1'],
  ]) {
    const field = page.locator('label.field', { hasText: label }).locator('input');
    // Fast mode disables the speed field; skip it rather than fighting it.
    if (await field.isDisabled()) continue;
    await field.fill(value);
  }
  await step('starting the run', () => page.getByRole('button', { name: 'Start' }).click());

  // The scene pane stays mounted while another tab is active (the centre area
  // renders every panel in its list), so the agent layer is already advancing
  // here. Watching from the hook avoids racing the run against tab switching.
  await step('waiting for agents to appear', () =>
    page.waitForFunction(
      () => (window.__logicpilotScene3d?.stats()?.agentCount ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    ),
  );
  const withAgents = await page.evaluate(() => window.__logicpilotScene3d.stats().agentCount);
  check(withAgents > 0, `agents appeared in the scene once the run started (${withAgents})`);

  // The real animation assertion: sample twice and require movement. A frozen
  // scene can still hold markers at plausible positions.
  //
  // Taken here, while the run is definitely live, rather than after the dialog is
  // dismissed. The layer is empty both when the mapping is broken and when a run
  // has simply finished, and a check that cannot tell those apart reports a fault
  // that is not there. The retry loop covers a model whose agents happen to be
  // parked at the same instant in both samples.
  let moved = false;
  let tracked = 0;
  let attempts = 0;
  for (; attempts < 4 && !moved; attempts += 1) {
    await page
      .waitForFunction(() => (window.__logicpilotScene3d?.stats()?.agentCount ?? 0) > 0, undefined, {
        timeout: 15_000,
      })
      .catch(() => {});
    const firstSample = await page.evaluate(() => window.__logicpilotScene3d.sampleAgents());
    await page.waitForTimeout(600);
    const secondSample = await page.evaluate(() => window.__logicpilotScene3d.sampleAgents());
    tracked = Math.max(tracked, firstSample.length);
    moved = firstSample.some((agent, index) => {
      const other = secondSample[index];
      if (other === undefined || other.id !== agent.id) return true;
      return Math.abs(other.x - agent.x) > 1e-3 || Math.abs(other.z - agent.z) > 1e-3;
    });
    if (!moved) {
      const diag = await page.evaluate(() => ({
        agentCount: window.__logicpilotScene3d.stats().agentCount,
        frames: window.__logicpilotScene3d.stats().frames,
        sampled: window.__logicpilotScene3d.sampleAgents().length,
        live: document.querySelector('[data-testid="scene3d-agent-count"]')?.textContent ?? null,
      }));
      log(`  attempt ${attempts + 1}: no movement yet ${JSON.stringify(diag)}`);
    }
  }
  check(moved, `agents moved between samples (${tracked} markers tracked, ${attempts} attempt(s))`);

  // The Run dialog stays up until dismissed; close it so the tab bar is usable.
  await step('closing the run dialog', () =>
    page
      .getByRole('dialog', { name: 'Run' })
      .getByRole('button', { name: 'Close', exact: true })
      .click(),
  );

  // Now show it: switch to the scene for the visual record and the readout.
  await step('switching to the Scene tab', () =>
    page.locator('.area-center .tab').filter({ hasText: 'Scene' }).click({ timeout: 15_000 }),
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'scene3d-3-live.png') });

  // The counters must reach the readout, or the HUD is decorative.
  const hud = await page.locator('[data-testid="scene3d-live"]').textContent().catch(() => null);
  check(hud !== null && /queue/.test(hud), `the run counters reached the readout (${hud?.trim() ?? 'none'})`);
  const queueValue = await page
    .locator('[data-testid="scene3d-queue"]')
    .textContent()
    .catch(() => null);
  check(
    queueValue !== null && Number.isFinite(Number(queueValue)),
    `the queue length is a number (${queueValue ?? 'none'})`,
  );

  // --- the spatial floor ---------------------------------------------------------
  //
  // A model that declares `node`/`path` markup is drawn from those coordinates
  // rather than from the canvas layout. That is a claim about geometry, so it is
  // checked as geometry: the real example's L-shaped run must survive parsing,
  // projection and the renderer with its distances intact.
  const spatialSource = readFileSync(join(repoRoot, 'examples', 'move_route.lp'), 'utf8');

  await step('opening the spatial example', () =>
    page
      .locator('input[type="file"][accept=".lpproj,.lp,.sysml,.json"]')
      .first()
      .setInputFiles({
        name: 'move_route.lp',
        mimeType: 'text/plain',
        buffer: Buffer.from(spatialSource),
      }),
  );
  await step('waiting for the floor to be built', () =>
    page.waitForFunction(
      () => (window.__logicpilotScene3d?.spatial()?.markerCount ?? 0) === 3,
      undefined,
      { timeout: 20_000 },
    ),
  );
  // Opening a document brings the Model tab forward, which hides the scene
  // surface. Everything below measures or clicks real pixels, so bring it back
  // first: a hidden panel has no bounding box and a 1x1 viewport, and framing
  // against that would fit the camera to nothing.
  await step('bringing the Scene tab forward', () =>
    page.locator('.area-center .tab').filter({ hasText: 'Scene' }).click({ timeout: 15_000 }),
  );
  await page.waitForFunction(
    () => {
      const surface = document.querySelector('[data-testid="scene3d-surface"]');
      return surface !== null && surface.getBoundingClientRect().width > 100;
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);

  const spatialStats = await page.evaluate(() => window.__logicpilotScene3d.stats().spatial);
  check(spatialStats !== null, 'the scene reports a spatial reading of the model');
  check(
    spatialStats?.markerCount === 3 && spatialStats?.segmentCount === 2,
    `the floor has the example's three nodes and two paths (${JSON.stringify(spatialStats)})`,
  );
  check(
    spatialStats?.bridgeCount === 1,
    `the moveTo step is anchored to its destination (${spatialStats?.bridgeCount} bridge(s))`,
  );

  // Screen-space independence: the model's own coordinates, not the canvas grid.
  const spatial = await page.evaluate(() => window.__logicpilotScene3d.spatial());
  const at = (name) => spatial?.positions.find((entry) => entry.name === name) ?? null;
  const dock = at('Dock');
  const depot = at('Depot');
  const bay = at('Bay');
  check(
    dock !== null && depot !== null && bay !== null,
    'all three declared nodes are drawn on the floor',
  );
  if (dock !== null && depot !== null && bay !== null) {
    const gapX = depot.x - dock.x;
    const gapZ = depot.z - dock.z;
    const legX = bay.x - depot.x;
    const legZ = bay.z - depot.z;
    check(
      Math.abs(gapX - 10) < 1e-6 && Math.abs(gapZ) < 1e-6,
      `Dock to Depot is the declared 10 units along one axis (dx ${gapX.toFixed(3)}, dz ${gapZ.toFixed(3)})`,
    );
    check(
      Math.abs(legX) < 1e-6 && Math.abs(legZ - 10) < 1e-6,
      `Depot to Bay turns the corner as declared (dx ${legX.toFixed(3)}, dz ${legZ.toFixed(3)})`,
    );
    // Reverse control: the canvas layout would place them in one row at a fixed
    // pitch, so these two gaps would match. They do not.
    check(
      Math.abs(gapX - legX) > 1,
      `the floor is not the canvas layout (the two legs differ by ${Math.abs(gapX - legX).toFixed(3)})`,
    );
  }
  check(
    JSON.stringify(spatial?.segments.map((segment) => [segment.name, segment.length])) ===
      JSON.stringify([
        ['Run1', 10],
        ['Run2', 10],
      ]),
    `both runs are drawn at their declared length (${JSON.stringify(spatial?.segments)})`,
  );

  // Every block in the example is understood now: the three `node`, two `path` and
  // the `moveTo` used to land in the unknown-kind fallback.
  const spatialUnknown = await page.evaluate(() => window.__logicpilotScene3d.unknownKindCount());
  check(
    spatialUnknown === 0,
    `no block in the spatial example falls back to an unmapped kind (${spatialUnknown})`,
  );

  // The floor must be inside the fitted view, grid and all. Framed from the
  // default viewpoint rather than from wherever the earlier orbit left the camera,
  // so the screenshot below shows what opening a spatial model actually looks like.
  await step('resetting the view', () =>
    page.getByRole('button', { name: 'Reset view' }).click({ timeout: 10_000 }),
  );
  await page.evaluate(() => window.__logicpilotScene3d.frame());
  await page.waitForTimeout(300);
  const spatialBounds = await page.evaluate(() => window.__logicpilotScene3d.bounds());
  check(
    (spatialBounds?.max.x ?? 0) >= 6 && (spatialBounds?.min.z ?? 0) <= -6,
    `the fit covers the whole board and the rail beside it (${JSON.stringify(spatialBounds)})`,
  );

  const spatialPixels = await page.evaluate(() => window.__logicpilotScene3d.samplePixels());
  check(
    spatialPixels !== null && spatialPixels.variance > 3,
    `the floor is actually drawn (luminance variance ${spatialPixels?.variance.toFixed(2) ?? 'n/a'})`,
  );

  // The status line must state the scale rather than leaving the picture to be
  // taken on trust.
  const markerReadout = await page
    .locator('[data-testid="scene3d-spatial-markers"]')
    .textContent()
    .catch(() => null);
  const gridReadout = await page
    .locator('[data-testid="scene3d-spatial-grid"]')
    .textContent()
    .catch(() => null);
  check(
    markerReadout === '3' && gridReadout === '1',
    `the readout states the board and its grid cell (${markerReadout} nodes, grid ${gridReadout})`,
  );

  // A click on a floor marker has to select the `node` block in the shared model
  // store, or the floor is decoration rather than part of the model view.
  const spatialIds = await page.evaluate(() => window.__logicpilotScene3d.objectIds());
  check(
    spatialIds.length === 8,
    `the floor and the rail are both addressable (${spatialIds.length} scene objects)`,
  );
  const bridgeTargets = await page.evaluate(() => {
    const api = window.__logicpilotScene3d;
    const targets = new Set((api.spatial()?.bridges ?? []).map((bridge) => bridge.to));
    return api.objectIds().filter((id) => targets.has(id));
  });
  check(
    bridgeTargets.length === 1,
    `the bridge targets exactly one floor node (${JSON.stringify(bridgeTargets)})`,
  );
  const targetNodeId = bridgeTargets[0];
  if (typeof targetNodeId === 'string') {
    // Re-measure: the status line grew when the spatial readout appeared, so the
    // surface measured for the earlier model is no longer where the pixels are.
    const spatialSurface = await page.locator('[data-testid="scene3d-surface"]').boundingBox();
    check(
      spatialSurface !== null && spatialSurface.width > 100,
      `the scene surface is on screen for the click (${JSON.stringify(spatialSurface)})`,
    );
    await page.evaluate(() => window.__logicpilotScene3d.select(null));
    const point = await page.evaluate(
      (id) => window.__logicpilotScene3d.projectNode(id),
      targetNodeId,
    );
    // Checked separately from the surface: a null here means the marker is behind
    // the camera, which is a different fault from the panel not being visible.
    check(point !== null, `the floor marker projects to a pixel (${JSON.stringify(point)})`);
    if (point !== null && spatialSurface !== null) {
      await page.mouse.click(spatialSurface.x + point.x, spatialSurface.y + point.y);
      await page.waitForTimeout(300);
      const selected = await page.evaluate(() => window.__logicpilotScene3d.stats().selectedId);
      check(
        selected === targetNodeId,
        `clicking a floor marker selected its node in the shared store (${String(selected)})`,
      );
    }
  }

  await page.screenshot({ path: join(OUT, 'scene3d-4-spatial.png') });

  check(consoleErrors.length === 0, `no console errors (${consoleErrors.length})`);
  if (consoleErrors.length > 0) {
    for (const message of consoleErrors.slice(0, 10)) log(`    console: ${message}`);
  }
} catch (error) {
  failures.push(`unexpected failure: ${error.message}`);
  log(`FAIL ${error.message}`);
  await page.screenshot({ path: join(OUT, 'scene3d-failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

if (failures.length === 0) {
  log('PASS');
  process.exit(0);
}
log(`${failures.length} check(s) failed`);
for (const failure of failures) log(`  - ${failure}`);
process.exit(1);
