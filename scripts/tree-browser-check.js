// Run after npm run build. Capture the real world with AIRP's lighting and cameras.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const out = 'test-results/trees';
await mkdir(out, { recursive: true });
const local = { host: '127.0.0.1', port: 0 };
const dev = await createServer({ server: { ...local, hmr: false, watch: null }, logLevel: 'error' });
await dev.listen();
const prod = await preview({ preview: local, logLevel: 'error' });
const url = server => 'http://127.0.0.1:' + server.httpServer.address().port;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: process.env.AIRP_SOFTWARE_GL ? ['--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1050, height: 700 } });
  page.setDefaultTimeout(120000);
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', r => {
    if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());
    if (r.url().includes('/assets/trees/') && r.url().endsWith('.glb')) requests.push(r.url());
  });
  async function ready() {
    await page.waitForSelector('#curtain[hidden]', { state: 'attached' });
  }
  async function visit(name) {
    await page.locator('#atlas-btn').click();
    await page.locator('#stations').getByRole('button', { name, exact: true }).click();
    await ready();
  }
  await page.goto(url(prod));
  await ready();
  assert.equal(requests.length, 0, 'No tree downloads at the city spawn');
  await visit('Tree Model Showcase');
  assert.ok(requests.length >= 5);
  assert.equal(new Set(requests).size, 5);
  await page.keyboard.press('g');
  await page.waitForFunction(() => document.querySelector('[data-mode="ground"]').getAttribute('aria-pressed') === 'true');
  await page.screenshot({ path: out + '/atlas-arrival.jpg', quality: 90 });
  console.log('Production atlas loaded all five local GLBs.');

  await page.goto(url(dev));
  await ready();
  await visit('Tree Model Showcase');
  await page.waitForFunction(() => window.airp?.showcase.ready && airp.streamer.settled);
  await page.evaluate(() => {
    airp.quality('high');
    // Use a fixed image size for comparisons on both software and hardware GPUs.
    airp.maxDpr = airp.nextDpr = 1;
    airp.resPeriod = -100000;
  });
  const shaderChecks = await page.evaluate(() => {
    const s = airp.showcase;
    return s.groves.map(({ species, batches, trees }) => {
      const mats = batches.near.map(p => p.batch.material);
      return { id: species.id, references: airp.assets.entries.get(species.assetId).refs,
        bark: mats.some(m => m.isMeshStandardMaterial && m.map && m.normalMap),
        leaves: mats.some(m => m.alphaTest > 0 && m.map && !m.transparent),
        shadows: batches.near.every(p => p.batch.castShadow && p.batch.receiveShadow),
        shared: batches.far.every(p => mats.includes(p.batch.material)), trees: trees.length };
    });
  });
  assert.equal(shaderChecks.length, 5);
  assert.ok(shaderChecks.every(s => s.bark && s.leaves && s.shadows && s.shared && s.references >= 1 && s.references <= 2 && s.trees === 3));
  async function settled() {
    await page.waitForFunction(() => !airp.waitForTerrain && airp.streamer.settled && airp.roads.settled);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const capture = name => page.locator('#world').screenshot({ path: out + '/' + name + '.jpg', quality: 94,
    style: 'main > :not(#world) { visibility: hidden !important; }' });
  for (const { id } of shaderChecks) {
    await page.evaluate(id => {
      const e = airp, { species, trees } = e.showcase.groves.find(g => g.species.id === id);
      const t = trees[0], h = species.dimensions.height;
      const dist = Math.max(h * 1.35, species.dimensions.width * 0.95);
      const x = t.x - dist * 0.32, z = t.z + dist * 0.95;
      const eye = e.controls.height(x, z) + 1.72;
      e.controls.setMode('ground');
      e.travel({ x, z, above: 1.72, yaw: Math.atan2(x - t.x, z - t.z),
        pitch: Math.atan2(t.y + h * 0.47 - eye, dist) });
    }, id);
    await settled();
    await capture(id);
    console.log('Ground inspection', id);
  }
  // A close approach checks bark normals at eye height in the game's normal lighting.
  await page.evaluate(() => {
    const t = airp.showcase.groves.find(g => g.species.id === 'birch').trees[0];
    airp.travel({ x: t.x - 1.7, z: t.z + 2.1, yaw: Math.atan2(-1.7, 2.1), pitch: 0.27, above: 1.72 });
  });
  await settled();
  await capture('birch-bark');
  const ground = await page.evaluate(async () => {
    const { groundHeight } = await import('/src/world/queries.js');
    return Math.max(...airp.showcase.groves.flatMap(g => g.trees.map(t =>
      Math.abs(t.y - groundHeight(t.x, t.z, airp.streamer.resolutionAt(t.x, t.z))))));
  });
  assert.ok(ground < 0.055);
  await page.evaluate(() => {
    airp.controls.setMode('fly');
    airp.travel({ x: -372, z: 480, above: 47, yaw: 0, pitch: -0.57 });
  });
  await settled();
  await capture('aerial');
  // Render two consecutive frames at the same pose and clock. A real cast
  // shadow makes the ground darker even though both frames draw every tree.
  const shadowPixels = await page.evaluate(() => {
    const e = airp, renderer = e.renderer, gl = renderer.getContext();
    const original = new Map(e.showcase.root.children.map(mesh => [mesh, mesh.castShadow]));
    const readFrame = () => {
      e.atmosphere.sun.shadow.needsUpdate = true;
      renderer.render(e.scene, e.camera);
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const shaded = readFrame();
    try {
      original.forEach((_, mesh) => { mesh.castShadow = false; });
      const unshaded = readFrame();
      let darker = 0;
      for (let i = 0; i < shaded.length; i += 4)
        if (unshaded[i + 1] > shaded[i + 1] + 4) darker++;
      return darker;
    } finally {
      original.forEach((cast, mesh) => { mesh.castShadow = cast; });
      e.atmosphere.sun.shadow.needsUpdate = true;
    }
  });
  assert.ok(shadowPixels > 25, 'Tree cast shadows should affect visible pixels in the clearing');
  await page.evaluate(() => airp.travel({ x: -372, z: 565, above: 46, yaw: 0, pitch: -0.23 }));
  await settled();
  assert.ok(await page.evaluate(() => airp.showcase.groves.every(g =>
    g.trees.every(t => t.level === 'far') && g.batches.far.every(p => p.batch.count === 3))));
  await visit('Silverpine Forest');
  await page.waitForFunction(()=>airp.forest.settled);
  assert.ok(await page.evaluate(() => !airp.showcase.root.parent && airp.showcase.root.children.length === 0 &&
    Array.from(airp.assets.entries).filter(([id])=>id.startsWith('showcase-')).every(([,entry])=>entry.refs===1) &&
    Array.from(airp.assets.entries.keys()).filter(id=>id.startsWith('showcase-')).length===airp.forest.models.entries.size));
  await visit('Tree Model Showcase');
  await settled();
  assert.ok(await page.evaluate(() => airp.showcase.groves.every(g => g.trees[0].level === 'near') &&
    airp.showcase.groves.length === 5 && airp.atmosphere.sun.shadow.map != null));
  assert.deepEqual(errors, []);
  console.log('PASS: WebGL2 production and dev, ground and aerial cameras, five near/far pairs, shadow materials, grounding, shared buffers and round-trip disposal.', { ground, shadowPixels });
} finally {
  await browser?.close();
  await dev.close();
  await new Promise(resolve => prod.httpServer.close(resolve));
}
