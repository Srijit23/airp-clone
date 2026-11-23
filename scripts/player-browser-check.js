// Smoke-test the shipping character asset and player/controller integration in real WebGL2.
// Run after 'npm run build'. Set CHROME_PATH to a local Chromium if needed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const errors = [];
const host = { host: '127.0.0.1', port: 0 };
const dev = await createServer({ server: { ...host, hmr: false, watch: null }, logLevel: 'error' });
await dev.listen();
const prod = await preview({ preview: host, logLevel: 'error' });
const address = s => 'http://127.0.0.1:' + s.httpServer.address().port;
await mkdir('test-results/player', { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: process.env.AIRP_SOFTWARE_GL ? [
      '--no-zygote', '--single-process', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ] : [],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });

  await page.goto(address(prod));
  await page.waitForSelector('#curtain[hidden]', { timeout: 120000 });
  assert.equal(await page.title(), 'AIRP');
  assert.equal(await page.locator('[data-mode="player"]').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: 'test-results/player/character-production.jpg', quality: 88 });
  await page.goto(address(dev));
  await page.waitForSelector('#curtain[hidden]', { timeout: 120000 });
  await page.waitForFunction(() => window.airp?.player?.model && airp.player.enabled);
  const result = await page.evaluate(async () => {
    const e = window.airp, c = e.controls, p = e.player;
    const { buildingAt, buildings } = await import('/src/places/records.js');
    const start = { ...p.motion };
    c.keys.clear();
    const before = { x: p.motion.x, z: p.motion.z };
    c.keys.add('KeyW');
    for (let i = 0; i < 60; i++) p.update(1 / 60, c);
    c.keys.clear();
    const walked = Math.hypot(p.motion.x - before.x, p.motion.z - before.z);
    const walkAnimation = p.actionName;
    p.warp(before.x, before.z, c);
    c.keys.add('KeyW'); c.keys.add('ShiftLeft');
    for (let i = 0; i < 60; i++) p.update(1 / 60, c);
    c.keys.clear();
    const ran = Math.hypot(p.motion.x - before.x, p.motion.z - before.z);
    const runAnimation = p.actionName;
    p.warp(before.x, before.z, c);
    c.keys.add('Space');
    p.update(1 / 60, c);
    const jumpAnimation = p.actionName;
    let peak = p.motion.y - p.world.height(p.motion.x, p.motion.z);
    for (let i = 0; i < 110; i++) {
      p.update(1 / 60, c);
      peak = Math.max(peak, p.motion.y - p.world.height(p.motion.x, p.motion.z));
    }
    c.keys.clear();
    const landed = p.motion.grounded && Math.abs(p.motion.y - p.world.height(p.motion.x, p.motion.z)) < 0.001;
    const building = buildings.find(b => buildingAt(b.position.x, b.position.z) === b);
    const blocked = p.world.blocked(building.position.x, building.position.z, building.position.y);
    const centerDistance = Math.hypot(e.camera.position.x - p.motion.x, e.camera.position.z - p.motion.z);
    const modelVisible = p.root.visible && p.model.visible;
    c.setMode('fly');
    const fly = c.mode === 'fly' && !p.root.visible;
    c.setMode('player');
    const restored = c.mode === 'player' && p.root.visible;
    return { start: [start.x,start.y,start.z], walked, ran, walkAnimation, runAnimation,
      jumpAnimation, peak, landed, blocked, centerDistance, modelVisible, fly, restored,
      clips: p.actions.size, assets: e.assets.entries.size };
  });
  console.log('Character browser metrics:', result);
  assert.ok(result.walked > 1.5, 'WASD walking did not move');
  assert.ok(result.ran > result.walked * 1.35, 'Sprint is not faster than walking');
  assert.equal(result.walkAnimation, 'Walking');
  assert.equal(result.runAnimation, 'Running');
  assert.ok(['Jump', 'WalkJump'].includes(result.jumpAnimation));
  assert.ok(result.peak > 0.85, 'Jump did not leave the terrain');
  assert.equal(result.landed, true, 'Character did not land on the surface');
  assert.equal(result.blocked, true, 'Building collider did not engage');
  assert.ok(result.centerDistance > 1 && result.centerDistance < 9);
  assert.equal(result.modelVisible, true);
  assert.equal(result.fly, true);
  assert.equal(result.restored, true);
  assert.ok(result.clips >= 5);
  assert.deepEqual(errors, []);
  console.log('PASS: production/development entry points, GLB, movement, animations, landing and collisions.');
} finally {
  if (browser) await browser.close();
  await dev.close();
  await new Promise(resolve => prod.httpServer.close(resolve));
}
