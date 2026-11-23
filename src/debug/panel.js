import { district } from '../data/world.js';
import { Atlas } from './atlas.js';
import { PlanOverlay, layers } from './city-plan.js';
import { icons } from './icons.js';

const $ = (id) => document.getElementById(id);
export class InspectionPanel {
  constructor(engine) {
    this.engine = engine;
    const c = engine.controls;
    icons();
    this.overlay = new PlanOverlay(engine.scene);
    this.atlas = new Atlas(c, (station) => {
      this.close();
      engine.travel(station);
    });
    this.atlas.overlay = this.overlay;
    for (const [key, [name, color]] of Object.entries(layers)) {
      const label = document.createElement('label'),
        input = document.createElement('input'),
        swatch = document.createElement('i');
      input.type = 'checkbox';
      input.id = 'layer-' + key;
      swatch.style.background = color;
      label.append(input, swatch, document.createTextNode(name));
      $('city-layers').append(label);
      input.onchange = () => {
        this.overlay.toggle(key, input.checked);
        this.atlas.drawFull();
      };
    }
    this.dialog = $('panel');
    for (const t of ['atlas', 'settings', 'help'])
      $(t + '-btn').onclick = () => this.open(t);
    $('mini-btn').onclick = () => this.open('atlas');
    $('vehicle-action').onclick = () => {
      engine.vehicle?.toggle(c);
      this.refreshVehicle();
    };
    $('close').onclick = () => this.close();
    this.dialog.addEventListener('close', () => {
      c.suspend(false);
      engine.canvas.focus();
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog && !this.inside(e)) this.close();
    });
    document.querySelectorAll('[data-quality]').forEach(
      (b) =>
        (b.onclick = () => {
          engine.quality(b.dataset.quality);
          this.refresh();
        }),
    );
    document.querySelectorAll('[data-mode]').forEach(
      (b) =>
        (b.onclick = () => {
          c.setMode(b.dataset.mode);
          this.refresh();
        }),
    );
    $('speed-range').oninput = (e) => {
      c.speed = Number(e.target.value);
      this.refresh();
    };
    $('grid-check').onchange = (e) =>
      (engine.terrain.grid.value = Number(e.target.checked));
    $('debug-check').onchange = (e) => ($('debug').hidden = !e.target.checked);
    window.addEventListener(
      'keydown',
      (this.onKey = (e) => {
        if (e.repeat) return;
        if (e.code === 'KeyM' && (!this.dialog.open || !$('atlas').hidden)) {
          e.preventDefault();
          this.dialog.open ? this.close() : this.open('atlas');
        }
        if (this.dialog.open) return;
        if (e.key === '?') this.open('help');
        if (e.code === 'KeyE') {
          if (engine.vehicle?.toggle(c)) {
            e.preventDefault();
            this.refreshVehicle();
          }
        }
        if (e.code === 'KeyG' && c.mode !== 'drive')
          c.setMode(c.mode === 'fly' ? 'ground' : 'fly');
        if (e.code === 'KeyV')
          c.setMode(c.mode === 'drive' ? 'player' : c.mode === 'player' ? 'fly' : 'player');
        if (e.code === 'F3') {
          e.preventDefault();
          $('debug').hidden = !$('debug').hidden;
          this.refresh();
        }
      }),
    );
    document.querySelectorAll('[data-key]').forEach((b) => {
      b.onpointerdown = (e) => {
        b.setPointerCapture(e.pointerId);
        c.keys.add(b.dataset.key);
      };
      b.onpointerup = b.onpointercancel = () => c.keys.delete(b.dataset.key);
    });
    this.ticks = Array.from({ length: 13 }, () => {
      const el = document.createElement('span');
      $('compass-scale').append(el);
      return el;
    });
    this.refresh();
  }
  inside(e) {
    const r = this.dialog.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  }
  open(tab) {
    const e = this.engine;
    e.controls.suspend(true);
    for (const t of ['atlas', 'settings', 'help']) $(t).hidden = t !== tab;
    $('panel-title').textContent = {
      atlas: 'City atlas',
      settings: 'Explorer settings',
      help: 'Camera controls',
    }[tab];
    if (!this.dialog.open) this.dialog.showModal();
    if (tab === 'atlas') this.atlas.drawFull();
    this.refresh();
  }
  close() {
    this.dialog.close();
  }
  refresh() {
    const e = this.engine,
      c = e.controls;
    $('speed-range').value = c.speed;
    $('speed-label').value = Math.round(c.speed) + ' m/s';
    $('debug-check').checked = !$('debug').hidden;
    document
      .querySelectorAll('[data-mode]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', b.dataset.mode === c.mode),
      );
    document
      .querySelectorAll('[data-quality]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', b.dataset.quality === e.presetName),
      );
    document.body.classList.toggle('locked', c.active);
    this.refreshVehicle();
  }
  refreshVehicle() {
    const car = this.engine.vehicle;
    const driving = !!car?.driving;
    $('vehicle-hud').hidden = !driving;
    $('vehicle-speed').textContent = car?.speedKmh ?? 0;
    const interaction = $('vehicle-action');
    interaction.hidden = !(driving || car?.canEnter());
    $('vehicle-action-text').textContent = driving ? 'Exit car' : 'Enter car';
  }

  update(fps, ms) {
    const e = this.engine,
      c = e.controls,
      p = e.camera.position;
    $('alt').textContent = Math.round(p.y);
    $('speed').textContent = Math.round(c.travelSpeed);
    this.refreshVehicle();
    const bearing = ((((-c.yaw * 180) / Math.PI) % 360) + 360) % 360;
    $('heading').textContent =
      String(Math.round(bearing) % 360).padStart(3, '0') + '°';
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const base = Math.floor(bearing / 15);
    this.ticks.forEach((el, i) => {
      const tick = (base + i - 6) * 15,
        norm = ((tick % 360) + 360) % 360;
      el.textContent = norm % 45 === 0 ? labels[norm / 45] : '';
      el.style.left = 50 + (tick - bearing) * 0.64 + '%';
    });
    this.atlas.drawMini();
    if (this.dialog.open && !$('atlas').hidden) this.atlas.drawFull();
    if (!$('debug').hidden) {
      const r = e.renderer.info,
        s = e.streamer;
      $('debug').textContent = [
        'AIRP  /  ' + e.presetName,
        'XYZ  ' + [p.x, p.y, p.z].map((n) => n.toFixed(1)).join('  ') + ' m',
        fps.toFixed(1) + ' FPS    ' + ms.toFixed(1) + ' ms/frame',
        r.render.calls +
          ' draws    ' +
          r.render.triangles.toLocaleString() +
          ' triangles',
        s.tiles.size +
          ' detail chunks    ' +
          s.sectors.size +
          ' horizon sectors',
        e.roads.meshes.size + ' road batches',
        e.places.bodies+' buildings    '+e.places.plants+' plants',
        e.assets.entries.size +
          ' assets    ' +
          r.memory.geometries +
          ' GPU geometries',
        r.memory.textures +
          ' GPU textures    DPR ' +
          e.renderer.getPixelRatio().toFixed(2),
        ...(e.forest.stats ? [
          e.forest.stats.instances.toLocaleString() + ' forest trees in ' + e.forest.stats.chunks + ' resident tiles',
          e.forest.stats.near + ' near meshes    ' + e.forest.stats.mid + ' mid meshes    ' +
            e.forest.stats.workerMeanMs.toFixed(1) + ' ms/tile on worker',
        ] : []),
      ].join('\n');
    }
  }
  dispose() {
    this.overlay.dispose();
    window.removeEventListener('keydown', this.onKey);
    if (this.dialog.open) this.close();
  }
}
