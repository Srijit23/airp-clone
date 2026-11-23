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
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
  page.on('console', item => { if (item.type() === 'error') { errors.push(item.text()); console.error('BROWSER ERROR', item.text().slice(0, 1500)); } });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });

  async function loaded(label) {
    try {
      await page.waitForFunction(() => {
        const curtain = document.getElementById('curtain');
        const message = document.getElementById('status')?.textContent || '';
        return curtain?.hidden || message.startsWith('Survey unavailable.');
      }, null, { timeout: 80000 });
      const status = await page.locator('#status').textContent();
      if (status?.startsWith('Survey unavailable.')) throw Error(label + ': ' + status);
    } catch (error) {
      console.error(label + ' loading status:', await page.locator('#status').textContent());
      console.error(label + ' observed errors:', errors);
      await page.screenshot({ path: 'test-results/player/startup-diagnostics.jpg', quality: 80 });
      throw error;
    }
  }
  await page.goto(address(prod));
  await loaded('Production');
  assert.equal(await page.title(), 'AIRP');
  assert.equal(await page.locator('[data-mode="player"]').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'test-results/player/character-production.jpg', quality: 88 });
  await page.goto(address(dev));
  await loaded('Development');
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
    const placedSolid = e.places.lots.flatMap(lot => lot.parts).find(part =>
      part.asset === 'solid' && Math.abs(part.m.elements[5]) > 0.42 &&
      Math.hypot(part.m.elements[8], part.m.elements[10]) > 2
    );
    const propBlocked = placedSolid && p.world.solidProp(
      placedSolid.m.elements[12], placedSolid.m.elements[14], placedSolid.m.elements[13]
    );
    const visualHeight = Math.max(...worldBoxes.map(b => b.high[1])) -
      Math.min(...worldBoxes.map(b => b.low[1]));
    const meshesOnScreen = worldBoxes.filter(b => Math.abs(b.ndc[0]) < 0.95 &&
      Math.abs(b.ndc[1]) < 0.95 && b.ndc[2] > -1 && b.ndc[2] < 1).length;
    const centerDistance = Math.hypot(e.camera.position.x - p.motion.x, e.camera.position.z - p.motion.z);
    const modelVisible = p.root.visible && p.model.visible;
    const worldBoxes = [];
    p.model.updateMatrixWorld(true);
    p.model.traverse(node => {
      if (!node.isMesh) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const b = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      const center = b.min.clone().add(b.max).multiplyScalar(0.5);
      const projected = center.clone().project(e.camera);
      worldBoxes.push({name:node.name,
        low:b.min.toArray().map(x=>Number(x.toFixed(2))),
        high:b.max.toArray().map(x=>Number(x.toFixed(2))),
        ndc:projected.toArray().map(x=>Number(x.toFixed(2))),
      });
    });
    c.setMode('fly');
    const fly = c.mode === 'fly' && !p.root.visible;
    c.setMode('player');
    const restored = c.mode === 'player' && p.root.visible;
    return { start: [start.x,start.y,start.z], walked, ran, walkAnimation, runAnimation,
      jumpAnimation, peak, landed, blocked, propBlocked, centerDistance, modelVisible, fly, restored,
      clips: p.actions.size, assets: e.assets.entries.size,
      meshes:worldBoxes.length, visualHeight, meshesOnScreen,
      boxes:worldBoxes.slice(0,7),
      cameraPosition:e.camera.position.toArray().map(x=>Number(x.toFixed(2))),
      cameraTarget:[p.motion.x,p.motion.y+1.43,p.motion.z] };
  });
  console.log('Character browser metrics:', JSON.stringify(result));
  assert.ok(result.walked > 1.5, 'WASD walking did not move');
  assert.ok(result.ran > result.walked * 1.35, 'Sprint is not faster than walking');
  assert.equal(result.walkAnimation, 'Walking');
  assert.equal(result.runAnimation, 'Running');
  assert.ok(['Jump', 'WalkJump'].includes(result.jumpAnimation));
  assert.ok(result.peak > 0.85, 'Jump did not leave the terrain');
  assert.equal(result.landed, true, 'Character did not land on the surface');
  assert.equal(result.blocked, true, 'Building collider did not engage');
  assert.equal(result.propBlocked, true, 'Authored solid prop collider did not engage');
  assert.ok(result.centerDistance > 1 && result.centerDistance < 9);
  assert.equal(result.modelVisible, true);
  assert.ok(result.visualHeight > 1.2 && result.visualHeight < 2.5,
    'Actual rigged mesh is not human-sized: ' + result.visualHeight);
  assert.ok(result.meshesOnScreen >= 8, 'Character meshes are not visible in the camera frame');
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
