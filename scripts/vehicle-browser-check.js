// Real Chromium smoke test for the *committed* GLB, E entry/exit and gameplay.
// Run after npm run build; AIRP_SOFTWARE_GL=1 uses software GL in CI.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const errors = [], local = { host: '127.0.0.1', port: 0 };
await mkdir('test-results/vehicles', { recursive: true });
const dev = await createServer({ server: { ...local, hmr: false, watch: null }, logLevel: 'error' });
await dev.listen();
const prod = await preview({ preview: local, logLevel: 'error' });
const url = server => 'http://127.0.0.1:' + server.httpServer.address().port;
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
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });
  page.on('console', e => {
    if (e.type() === 'error') { errors.push(e.text()); console.error('CONSOLE:', e.text().slice(0, 2000)); }
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(response.status() + ' ' + response.url());
  });
  async function ready(name) {
    try {
      await page.waitForFunction(() => {
        const curtain = document.querySelector('#curtain');
        const status = document.querySelector('#status')?.textContent || '';
        return curtain?.hidden || status.startsWith('Survey unavailable.');
      }, null, { timeout: 120000 });
      const message = await page.locator('#status').textContent();
      if (message?.startsWith('Survey unavailable.')) throw Error(message);
    } catch (error) {
      console.error(name + ' failed during loading:', await page.locator('#status').textContent(), errors);
      await page.screenshot({ path: 'test-results/vehicles/failed-startup.jpg' });
      throw error;
    }
  }

  await page.goto(url(prod));
  await ready('Production');
  assert.equal(await page.title(), 'AIRP');
  assert.equal(await page.locator('#vehicle-action').isVisible(), false);
  // Production GLB is actually available inside the bundled Netlify-style site.
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/vehicles/parked-production.jpg', quality: 84 });

  await page.goto(url(dev));
  await ready('Development');
  await page.waitForFunction(() => window.airp?.vehicle?.model && window.airp?.player?.motion);
  const parked = await page.evaluate(async () => {
    const e = window.airp, car = e.vehicle, c = e.controls;
    const { offset, CAR_WIDTH } = await import('/src/vehicles/physics.js');
    const spawn = { x: e.player.motion.x, z: e.player.motion.z };
    const d = Math.hypot(car.motion.x - spawn.x, car.motion.z - spawn.z);
    const wheels = car.wheels.map(w => ({ name: w.mesh.name, radius: w.radius, y: w.mesh.position.y }));
    const center = car.root.position.y;
    const carPosition = { ...car.motion };
    // Approach the actual driver's door with the in-game character.
    let door = null;
    for (const gap of [CAR_WIDTH * 0.5 + 1.0, 3.0, 3.6]) {
      for (const side of [-1, 1]) {
        const p = offset(car.motion.x, car.motion.z, car.motion.yaw, side * gap, 0);
        if (!e.player.world.blocked(p.x, p.z, e.player.world.height(p.x, p.z))) {
          door = p; break;
        }
      }
      if (door) break;
    }
    if (door) e.player.warp(door.x, door.z, c, true);
    return { d, wheels, center, parked: car.parked, visible: car.root.visible,
      mode: c.mode, door, canEnter: car.canEnter(), carPosition };
  });
  console.log('Parked car:', JSON.stringify(parked));
  assert.equal(parked.wheels.length, 4);
  assert.equal(new Set(parked.wheels.map(w => w.name)).size, 4);
  assert.ok(parked.wheels.every(w => w.radius > 0.2 && w.radius < 0.7));
  assert.ok(parked.d < 16 && parked.d > 2, 'Car must spawn near character');
  assert.equal(parked.parked, true);
  assert.equal(parked.visible, true);
  assert.equal(parked.mode, 'player');
  assert.equal(parked.canEnter, true, 'Player must be able to approach the driver's door');

  await page.locator('#world').focus();
  await page.keyboard.press('e');
  await page.waitForFunction(() => airp.vehicle.driving && airp.controls.mode === 'drive');
  assert.equal(await page.locator('#vehicle-hud').isVisible(), true);
  const movement = await page.evaluate(async () => {
    const car = airp.vehicle, c = airp.controls;
    const start = { x: car.motion.x, z: car.motion.z };
    const wheelStart = car.wheels.map(w => w.mesh.rotation.x);
    c.keys.add('KeyW');
    for (let i = 0; i < 75; i++) car.update(1 / 60, c);
    const afterAccelerate = { ...car.motion };
    const distance = Math.hypot(car.motion.x - start.x, car.motion.z - start.z);
    const wheelSpin = car.wheels.map((w, i) => w.mesh.rotation.x - wheelStart[i]);
    c.keys.add('KeyA');
    for (let i = 0; i < 30; i++) car.update(1 / 60, c);
    const steer = car.motion.steer;
    const frontSteering = car.wheels.filter(w => w.front).map(w => w.mesh.rotation.y);
    c.keys.clear();
    for (let i = 0; i < 50; i++) car.update(1 / 60, c);
    const coast = car.motion.speed;
    return {
      distance, speed: afterAccelerate.speed, coast, wheelSpin,
      steer, frontSteering, cameraDistance: Math.hypot(
        c.camera.position.x - car.motion.x, c.camera.position.z - car.motion.z),
      playerHidden: !airp.player.root.visible, carVisible: car.root.visible,
      carGroundGap: Math.abs(car.root.position.y -
        car.world.surface(car.motion.x, car.motion.z, car.motion.yaw).height),
      hit: car.motion.impact, mode: c.mode, kilometersPerHour: car.speedKmh,
    };
  });
  console.log('Car driving metrics:', JSON.stringify(movement));
  assert.ok(movement.distance > 0.7, 'Car failed to move on accelerator');
  assert.ok(movement.speed > 1, 'Car failed to accelerate');
  assert.ok(movement.wheelSpin.every(a => a > 0.1), 'Wheels did not spin when moving');
  assert.ok(movement.steer > 0.02, 'Left steering did not respond');
  assert.ok(movement.frontSteering.every(v => v > 0.02), 'Front wheel meshes did not steer');
  assert.ok(movement.cameraDistance > 3 && movement.cameraDistance < 15);
  assert.ok(movement.carGroundGap < 0.6, 'Vehicle did not follow terrain');
  assert.equal(movement.playerHidden, true);
  assert.equal(movement.carVisible, true);
  assert.equal(movement.mode, 'drive');
  await page.screenshot({ path: 'test-results/vehicles/driving-development.jpg', quality: 85 });

  await page.keyboard.press('e');
  await page.waitForFunction(() => !airp.vehicle.driving && airp.controls.mode === 'player');
  const exit = await page.evaluate(() => {
    const e = airp, car = e.vehicle, p = e.player.motion;
    return {
      visible: e.player.root.visible, carVisible: car.root.visible,
      playerClear: !e.player.world.blocked(p.x, p.z, p.y),
      outsideCar: !car.occupies(p.x, p.z, 0.38),
      speed: car.motion.speed,
    };
  });
  console.log('Exit:', exit);
  assert.equal(exit.visible, true);
  assert.equal(exit.carVisible, true);
  assert.equal(exit.playerClear, true);
  assert.equal(exit.outsideCar, true);
  assert.equal(exit.speed, 0);
  assert.equal(await page.locator('#vehicle-hud').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: bundled car model, wheels, E entry/exit, steering, chase camera, collision & terrain.');
} finally {
  if (browser) await browser.close();
  await dev.close();
  await new Promise(resolve => prod.httpServer.close(resolve));
}
