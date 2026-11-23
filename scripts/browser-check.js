// A real browser runs both the production entry page and an instrumented development build.
// Install a browser with "npx playwright-core install chromium" or supply CHROME_PATH.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';

const out = 'test-results';
await mkdir(out, { recursive: true });
const local = { host: '127.0.0.1', port: 0 };
const dev = await createServer({
  server: { ...local, hmr: false, watch: null },
  logLevel: 'error',
});
await dev.listen();
const prod = await preview({ preview: local, logLevel: 'error' });
const address = (server) =>
  'http://127.0.0.1:' + server.httpServer.address().port;
const errors = [];
let browser;
try {
  const args = process.env.AIRP_SOFTWARE_GL
    ? [
        '--no-zygote',
        '--single-process',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
      ]
    : [];
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args,
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {errors.push(m.text());console.error(m.text().slice(0,1200));}
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());
  });
  async function ready() {
    await page.waitForSelector('#curtain[hidden]', {
      state: 'attached',
      timeout: 120000,
    });
  }
  async function debug() {
    return page.locator('#debug').innerText();
  }
  async function close() {
    await page.locator('#close').click();
  }
  await page.goto(address(prod));
  await ready();
  await page.keyboard.press('F3');
  await page.waitForFunction(() =>
    document
      .querySelector('#debug')
      .textContent.includes('49 detail chunks    25 horizon sectors'),
  );
  const baseline = await debug();
  const perf = await page.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 18; i++)
      times.push(
        await new Promise((resolve) => requestAnimationFrame(resolve)),
      );
    const elapsed = times.at(-1) - times[0];
    return {
      fps: Math.round(170000 / elapsed) / 10,
      msPerFrame: Math.round(elapsed / 17),
      dpr: document.querySelector('#world').width / innerWidth,
    };
  });
  console.log('Production junction\n' + baseline, 'Settled sample', perf);
  await page.keyboard.press('F3');
  const shot = await page.screenshot({
    path: out + '/junction.jpg',
    quality: 92,
  });
  const range = await page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = 'data:image/jpeg;base64,' + encoded;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 64, 48);
    const pixels = ctx.getImageData(12, 9, 40, 27).data;
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) values.push(pixels[i + 1]);
    return Math.max(...values) - Math.min(...values);
  }, shot.toString('base64'));
  assert.ok(
    range > 60,
    'Production map should contain visible sky and terrain',
  );
  await page.locator('#world').click({ position: { x: 470, y: 240 } });
  await page.waitForFunction(
    () => document.pointerLockElement === document.querySelector('#world'),
  );
  await page.mouse.move(520, 275);
  await page.keyboard.down('w');
  await page.waitForTimeout(850);
  await page.keyboard.up('w');
  await page.keyboard.press('F3');
  await page.waitForFunction((old) => {
    const value = document.querySelector('#debug').textContent;
    return value.split('\n')[1] !== old.split('\n')[1] && value.includes('XYZ');
  }, baseline);
  await page.evaluate(() => document.exitPointerLock());
  await page.keyboard.press('F3');
  await page.keyboard.press('m');
  await page.locator('#stations').getByText('Basin Boulevard').click();
  await ready();
  await page.keyboard.press('v'); // Leave the character view for the legacy spectator check.
  await page.keyboard.press('g');
  await page.waitForFunction(
    () => document.querySelector('[data-mode="ground"]').getAttribute('aria-pressed') === 'true',
  );
  await page.screenshot({ path: out + '/ground.jpg', quality: 90 });
  await page.locator('#atlas-btn').click();
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-out').click();
  await page.locator('#plan-tools summary').click();
  for (const name of [
    'center',
    'edges',
    'junction',
    'graph',
    'grade',
    'zone',
    'parcel','building','bounds','habitat',
  ]) {
    await page.locator('#layer-' + name).check();
    if (!['zone', 'parcel'].includes(name))
      await page.locator('#layer-' + name).uncheck();
  }
  await page.screenshot({ path: out + '/atlas.jpg', quality: 85 });
  await page.locator('#atlas-map').click({ position: { x: 255, y: 155 } });
  await ready();
  await page.locator('#settings-btn').click();
  await page.getByRole('button', { name: 'Low', exact: true }).click();
  await page.locator('#grid-check').check();
  await page.locator('#debug-check').check();
  await close();
  await page.waitForFunction(() =>
    document
      .querySelector('#debug')
      .textContent.includes('25 detail chunks    25 horizon sectors'),
  );
  await page.screenshot({ path: out + '/seams.jpg', quality: 90 });
  // Inspect the road geometry in the shipping build at multiple scales.
  await page.locator('#atlas-btn').click();
  for (const id of ['zone', 'parcel'])
    await page.locator('#layer-' + id).uncheck();
  await close();
  await page.locator('#settings-btn').click();
  await page.locator('#grid-check').uncheck();
  await page.locator('#debug-check').uncheck();
  await page.locator('[data-mode=fly]').click();
  await page.locator('[data-quality=medium]').click();
  await close();
  for (const [station, file] of [
    ['Orchard Circle', 'circle'],
    ['Juniper Heights', 'hill'],
    ['City overview','network'],['Linden Ward','residential'],['Villa Court','villa'],
    ['Alder Vale','alder'],['Silverpine Forest','forest'],['Saltwood Strand','coast'],['Port Mariner','harbor'],
  ]) {
    await page.locator('#atlas-btn').click();
    await page.locator('#stations').getByText(station).click();
    await ready();
    console.log('Inspecting '+station);
    await page.screenshot({ path: out + '/' + file + '.jpg', quality: 91 });
  }
  await page.setViewportSize({ width: 600, height: 380 });
  await page.goto(address(dev));
  await ready();
  await page.waitForFunction(() => window.airp?.streamer.settled, null, {
    timeout: 120000,
  });
  const route = await page.evaluate(async () => {
    const e = window.airp,
      s = e.streamer;
    const { groundHeight } = await import('/src/world/queries.js');
    const wait = async (pred) => {
      const start = performance.now();
      while (!pred()) {
        if (performance.now() - start > 60000)
          throw Error('Stream did not settle');
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    };
    const snapshots = [];
    const points = [
      [382, 688],
      [-950, -940],
      [-1815,-1533],
      [-247,2900],
      [382, 688],
    ];
    const startLoads = s.loads;
    for (const [x, z] of [...points, ...points.slice(1)]) {
      e.travel({ x, z, yaw: 0.37, pitch: -0.14, above: 92 });
      await wait(
        () =>
          !e.waitForTerrain &&
          s.settled && e.forest.settled &&
          e.roads.settled &&
          s.center === Math.floor(x / 256) + ',' + Math.floor(z / 256),
      );
      const forestGeometries=new Set(),forestTextures=new Set();
      for(const tile of e.forest.tiles.values())if(tile.mesh)forestGeometries.add(tile.mesh.geometry);
      for(const entry of e.forest.models.entries.values())for(const mesh of entry.root.children){
        forestGeometries.add(mesh.geometry);
        for(const v of Object.values(mesh.material))if(v?.isTexture)forestTextures.add(v);
      }
      snapshots.push([
        s.tiles.size,
        s.sectors.size,
        e.renderer.info.memory.geometries,
        e.renderer.info.memory.textures,
        e.roads.meshes.size,
        new Set([...e.places.models.values()].map(m=>m.geometry)).size,
        [...e.assets.entries.keys()].filter(id=>e.assets.manifest[id].type==='texture').length,
        forestGeometries.size,forestTextures.size+1,e.forest.stats.instances,
      ]);
    }
    e.controls.setMode('ground');
    let worst = 0;
    for (let i = 0; i < 45; i++) {
      e.controls.keys.add('KeyW');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const p = e.camera.position;
      worst = Math.max(
        worst,
        Math.abs(
          p.y -
            1.72 -
            e.roads.surfaceHeight(
              p.x,
              p.z,
              groundHeight(p.x, p.z, s.resolutionAt(p.x, p.z)),
            ),
        ),
      );
    }
    e.controls.keys.clear();
    e.quality('high');
    await wait(() => s.preset === e.preset && s.settled);
    const high = [s.tiles.size, s.sectors.size];
    e.quality('low');
    await wait(() => s.preset === e.preset && s.settled);
    const low = [s.tiles.size, s.sectors.size];
    const gl = e.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return {
      snapshots,
      high,
      low,
      worst,
      renderer,
      loads: s.loads - startLoads,cellCache:e.places.cells.size,
      unloads: s.unloads,
    };
  });
  console.log('Streaming route', JSON.stringify(route));
  assert.deepEqual(route.high, [81, 49]);
  assert.deepEqual(route.low, [25, 25]);
  assert.ok(
    route.worst < 0.06,
    'Ground camera diverged from the rendered surface',
  );
  assert.ok(route.loads > 150 && route.unloads > 150);
  // The renderer lazily uploads visible sectors. Compare two warmed round trips.
  assert.deepEqual(route.snapshots[4], route.snapshots.at(-1));
  assert.ok(
    route.snapshots.every(
      (p) => p[2] <= p[0]+p[1]+p[4]+p[5]+2+p[7] && p[3] <= p[6]+6+p[8],
    ),
  );
  assert.ok(route.cellCache<=140);
  assert.ok(route.snapshots.every((p) => p[0] === 49 && p[1] === 25));
  await page.evaluate(() => {
    airp.controls.setMode('fly');
    airp.controls.speed = 160;
    airp.travel({ x: 249, z: 28, above: 90, yaw: -Math.PI / 2, pitch: 0 });
  });
  await ready();
  await page.locator('#world').focus();
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForFunction(() => airp.camera.position.x > 810);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => airp.streamer.settled);
  assert.ok(
    await page.evaluate(
      () =>
        airp.camera.position.y >
        airp.controls.height(airp.camera.position.x, airp.camera.position.z),
    ),
  );
  const dive=await page.evaluate(async()=>{
    const e=airp;e.controls.setMode('fly');e.travel({x:102,z:3890,above:2,yaw:0,pitch:0});
    await new Promise(resolve=>{const poll=()=>!e.waitForTerrain && e.streamer.settled?resolve():requestAnimationFrame(poll);poll();});
    return {wet:e.water.underwater,visible:e.water.mesh.visible,y:e.camera.position.y};
  });
  assert.ok(dive.wet && dive.visible && dive.y<0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: production and development WebGL2, inputs, atlas, graphics presets, seams, round-trip resource counts.',
  );
} finally {
  if (browser) await browser.close();
  await dev.close();
  await new Promise((resolve) => prod.httpServer.close(resolve));
}
