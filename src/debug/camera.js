import { Vector3 } from 'three';
import { clamp, plannedHalfSize } from '../data/world.js';
import { groundHeight } from '../world/queries.js';

export class InspectionCamera {
  constructor(camera, canvas, streamer, onChange) {
    this.camera = camera;
    this.canvas = canvas;
    this.streamer = streamer;
    this.changed = onChange;
    this.mode = 'fly';
    this.speed = 48;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.delta = new Vector3();
    this.active = false;
    this.drag = false;
    this.blocked = false;
    this.abort = new AbortController();
    const listen = (target, event, fn, options = {}) =>
      target.addEventListener(event, fn, {
        ...options,
        signal: this.abort.signal,
      });
    listen(document, 'pointerlockchange', () => {
      this.active = document.pointerLockElement === canvas;
      this.keys.clear();
      this.changed();
    });
    listen(canvas, 'pointerdown', (e) => {
      if (this.blocked || e.button !== 0) return;
      canvas.focus();
      this.drag = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'mouse' && !this.active) this.capture();
    });
    listen(canvas, 'pointerup', () => (this.drag = false));
    listen(canvas, 'pointercancel', () => (this.drag = false));
    listen(document, 'mousemove', (e) => {
      if (this.blocked || !this.active) return;
      this.look(e.movementX, e.movementY);
    });
    listen(canvas, 'pointermove', (e) => {
      if (this.blocked || this.active || !this.drag) return;
      this.look(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    listen(window, 'keydown', (e) => {
      if (this.blocked || e.target.closest?.('input,select,button,dialog'))
        return;
      const controls = [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'Space',
        'KeyC',
        'ControlLeft',
        'ControlRight',
        'ShiftLeft',
        'ShiftRight',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
      ];
      if (controls.includes(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
      }
    });
    listen(window, 'keyup', (e) => this.keys.delete(e.code));
    listen(window, 'blur', () => {
      this.keys.clear();
      this.drag = false;
    });
    listen(
      canvas,
      'wheel',
      (e) => {
        if (this.blocked) return;
        e.preventDefault();
        if (this.mode === 'drive' && this.vehicle)
          this.vehicle.cameraDistance = clamp(this.vehicle.cameraDistance *
            (e.deltaY < 0 ? 0.86 : 1.14), 5.1, 13.5);
        else if (this.mode === 'player' && this.player)
          this.player.cameraDistance = clamp(this.player.cameraDistance *
            (e.deltaY < 0 ? 0.85 : 1.15), 2.3, 7.4);
        else
          this.speed = clamp(this.speed * (e.deltaY < 0 ? 1.25 : 0.8), 4, 160);
        this.changed();
      },
      { passive: false },
    );
  }
  capture() {
    this.canvas.focus();
    try {
      this.canvas.requestPointerLock?.()?.catch(() => {});
    } catch {}
  }
  look(dx, dy) {
    if (this.mode === 'drive' && this.vehicle) {
      this.vehicle.look(dx, dy);
      return;
    }
    this.yaw -= dx * 0.00215;
    this.pitch = clamp(this.pitch - dy * 0.00215, -1.48, 1.48);
  }
  teleport(station) {
    this.keys.clear();
    if (this.mode === 'drive' && this.vehicle) {
      this.vehicle.teleport(station, this);
      this.changed();
      return;
    }
    if (this.mode === 'player' && this.player) {
      this.yaw = station.yaw;
      this.pitch = clamp(Math.min(-0.18, station.pitch), -0.85, 0.3);
      this.player.warp(station.x, station.z, this, true);
      this.changed();
      return;
    }
    if(this.mode==='ground'){
      const b=this.obstacle?.(station.x,station.z);
      if(b)station={...station,x:b.entrance.x,z:b.entrance.z};
    }
    this.yaw = station.yaw;
    this.pitch = station.pitch;
    this.camera.position.set(
      station.x,
      this.height(station.x, station.z) +
        (this.mode === 'ground' ? 1.72 : station.above),
      station.z,
    );
    this.orient();
    this.changed();
  }
  get travelSpeed() {
    return this.mode === 'drive' ? Math.abs(this.vehicle?.motion?.speed || 0) :
      this.mode === 'player' ? (this.player?.currentSpeed ?? 0) :
      this.mode === 'fly' ? this.speed : clamp(this.speed / 12, 1, 12);
  }
  height(x, z) {
    const base = groundHeight(x, z, this.streamer.resolutionAt(x, z));
    return this.streetSurface ? this.streetSurface(x, z, base) : base;
  }
  orient() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  setMode(mode) {
    if (this.mode === mode) return;
    // Preserve a safe exit when switching from driving to a spectator view.
    if (this.mode === 'drive' && mode !== 'drive') {
      this.vehicle?.exit(this);
      if (mode === 'player') return;
    }
    if (mode === 'drive' && !this.vehicle?.driving) return;
    this.mode = mode;
    this.keys.clear();
    if (mode === 'player' && this.player) {
      this.pitch = clamp(Math.min(this.pitch, -0.18), -0.85, 0.3);
      this.player.enable(true);
      this.player.warp(this.camera.position.x, this.camera.position.z, this, true);
    } else {
      this.player?.enable(false);
      this.orient();
    }
    if (mode === 'ground') {
      const b=this.obstacle?.(this.camera.position.x,this.camera.position.z);
      if(b){this.camera.position.x=b.entrance.x;this.camera.position.z=b.entrance.z;}
      this.camera.position.y =
        this.height(this.camera.position.x, this.camera.position.z) + 1.72;
      this.pitch = clamp(this.pitch, -0.5, 0.5);
    }
    this.changed();
  }
  update(dt) {
    const p = this.camera.position,
      k = this.keys;
    if (this.mode === 'drive' && this.vehicle) {
      this.vehicle.update(dt, this);
      return;
    }
    if (this.mode === 'player' && this.player) {
      if (!this.blocked) {
        this.yaw += (Number(k.has('ArrowLeft')) - Number(k.has('ArrowRight'))) * dt * 1.55;
        this.pitch = clamp(this.pitch + (Number(k.has('ArrowUp')) - Number(k.has('ArrowDown'))) * dt, -0.85, 0.3);
      }
      this.player.update(dt, this);
      return;
    }
    if (!this.blocked) {
      this.yaw +=
        (Number(k.has('ArrowLeft')) - Number(k.has('ArrowRight'))) * dt * 1.55;
      this.pitch = clamp(
        this.pitch +
          (Number(k.has('ArrowUp')) - Number(k.has('ArrowDown'))) * dt,
        -1.48,
        1.48,
      );
      const f = Number(k.has('KeyW')) - Number(k.has('KeyS')),
        r = Number(k.has('KeyD')) - Number(k.has('KeyA'));
      const fly = this.mode === 'fly',
        y = fly ? this.pitch : 0;
      const up =
        Number(k.has('Space')) -
        Number(k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight'));
      const d = this.delta.set(
        -Math.sin(this.yaw) * Math.cos(y) * f + Math.cos(this.yaw) * r,
        fly ? Math.sin(y) * f + up : 0,
        -Math.cos(this.yaw) * Math.cos(y) * f - Math.sin(this.yaw) * r,
      );
      const speed = this.travelSpeed, oldX=p.x,oldZ=p.z;
      p.addScaledVector(
        d.normalize(),
        speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1) * dt,
      );
      if(!fly && this.obstacle?.(p.x,p.z)){
        if(!this.obstacle(oldX,p.z))p.x=oldX;
        else if(!this.obstacle(p.x,oldZ))p.z=oldZ;
        else {p.x=oldX;p.z=oldZ;}
      }
      const edge = plannedHalfSize - 0.01;
      p.x = clamp(p.x, -edge, edge);
      p.z = clamp(p.z, -edge, edge);
    }
    const floor = this.height(p.x, p.z);
    p.y = this.mode === 'ground' ? floor + 1.72 : clamp(p.y, floor + 1.4, 1550);
    this.orient();
  }
  suspend(value) {
    this.blocked = value;
    this.keys.clear();
    this.drag = false;
    if (value && this.active) document.exitPointerLock();
  }
  dispose() {
    this.suspend(true);
    this.abort.abort();
  }
}
