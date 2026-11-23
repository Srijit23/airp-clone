import { Box3, Group, Vector3 } from 'three';
import { buildingAt } from '../places/records.js';
import { BODY_RADIUS } from '../player/physics.js';
import { VehicleWorld } from './world.js';
import { CAR_LENGTH, CAR_WIDTH, advanceVehicle, offset, vehicleState } from './physics.js';

const eye = new Vector3(), target = new Vector3(), desired = new Vector3(), probe = new Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class VehicleController {
  constructor(scene, assets, player) {
    this.scene = scene;
    this.assets = assets;
    this.player = player;
    this.world = new VehicleWorld(player.world);
    this.root = new Group();
    this.root.name = 'AIRP Sports Car';
    this.driving = false;
    this.parked = false;
    this.cameraDistance = 8.2;
    this.cameraOrbit = 0;
    this.cameraPitch = 0;
    this.rotation = { pitch: 0, roll: 0 };
    this.wheels = [];
  }

  async load() {
    const handle = await this.assets.acquire('city-car');
    try {
      const model = handle.value.instantiate();
      // Authored 80s Wedge: real-world metres, nose along local +Z.
      // Align to AIRP's -Z forward without creating/replacing any mesh.
      const bounds = new Box3().setFromObject(model);
      const center = bounds.getCenter(new Vector3());
      model.rotation.y = Math.PI;
      model.position.set(-center.x, -bounds.min.y, -center.z);
      model.updateMatrixWorld(true);
      model.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        // The source defaults to near-black. A metallic deep-blue finish
        // reads clearly against AIRP's dark roads without replacing geometry.
        for (const material of [].concat(node.material || [])) {
          if (material.name !== 'Wedge_Paint') continue;
          material.color.set('#538dbb');
          material.metalness = 0.42;
          material.roughness = 0.28;
        }
      });
      // Each wheel comprises three independently authored source objects.
      // Reparent them around the shared tyre centre as one movable assembly.
      for (const corner of ['FL', 'FR', 'RL', 'RR']) {
        const parts = ['Cover', 'Lip', 'Tyre'].map(piece =>
          model.getObjectByName('Wedge_Wheel_' + corner + '_' + piece));
        if (parts.some(part => !part?.isMesh))
          throw Error('Wedge source GLB is missing wheel parts: ' + corner);
        const tyre = parts[2];
        const pivot = new Group();
        pivot.name = 'wheel_' + corner.toLowerCase();
        pivot.position.copy(tyre.position);
        pivot.rotation.order = 'YXZ'; // front-steer, then rolling axle motion
        tyre.parent.add(pivot);
        model.updateMatrixWorld(true);
        for (const part of parts) pivot.attach(part);
        if (!tyre.geometry.boundingBox) tyre.geometry.computeBoundingBox();
        const b = tyre.geometry.boundingBox;
        const radius = 0.5 * Math.max(b.max.y - b.min.y, b.max.z - b.min.z);
        this.wheels.push({ mesh: pivot, radius, front: corner.startsWith('F') });
      }
      this.root.add(model);
      this.model = model;
      this.handle = handle;
      this.scene.add(this.root);
    } catch (error) {
      handle.release();
      this.root.removeFromParent();
      throw error;
    }
  }

  // Spawn beside the character, checking the *complete* car footprint.
  spawnNear(playerMotion, controls) {
    if (!playerMotion) return;
    const yaw = controls.yaw;
    let location = null;
    for (const distance of [6.2, 7.4, 9, 11, 14]) {
      // Prefer parking directly ahead, in sight and on clear road surface.
      for (const [lateral, ahead] of [
        [2.1, distance * 0.96], [-2.1, distance * 0.96],
        [0, distance], [-1.25, distance], [1.25, distance],
        [-distance, 0], [distance, 0],
        [-distance * 0.6, distance * 0.7],
        [distance * 0.6, distance * 0.7],
        [0, -distance],
      ]) {
        const position = offset(playerMotion.x, playerMotion.z, yaw, lateral, ahead);
        if (!this.world.blocked(position.x, position.z, yaw)) {
          location = position;
          break;
        }
      }
      if (location) break;
    }
    if (!location)
      throw Error('No clear road or open space for the car near the spawn location');
    this.motion = vehicleState(location.x, location.z, yaw);
    this.parked = true;
    this.updateTransform(0);
  }

  occupies(x, z, radius = 0) {
    if (!this.parked || !this.motion) return false;
    const dx = x - this.motion.x, dz = z - this.motion.z;
    const sideways = dx * Math.cos(this.motion.yaw) - dz * Math.sin(this.motion.yaw);
    const forward = -dx * Math.sin(this.motion.yaw) - dz * Math.cos(this.motion.yaw);
    return Math.abs(sideways) < CAR_WIDTH * 0.5 + radius &&
      Math.abs(forward) < CAR_LENGTH * 0.5 + radius;
  }

  canEnter() {
    const p = this.player.motion, car = this.motion;
    if (!p || !car || !this.player.enabled || this.driving || !p.grounded) return false;
    return Math.hypot(p.x - car.x, p.z - car.z) <= 4.8 &&
      Math.abs(p.y - this.root.position.y) < 2.6;
  }

  toggle(controls) {
    if (this.driving) return this.exit(controls);
    if (!this.canEnter()) return false;
    this.driving = true;
    this.player.enable(false);
    controls.keys.clear();
    controls.mode = 'drive';
    controls.yaw = this.motion.yaw;
    controls.pitch = -0.2;
    this.cameraOrbit = 0;
    this.cameraPitch = 0;
    this.placeCamera(controls, 0);
    controls.changed();
    return true;
  }

  exit(controls) {
    if (!this.driving) return false;
    this.driving = false;
    this.motion.speed = 0;
    this.motion.steer = 0;
    controls.keys.clear();
    const m = this.motion;
    let destination = null;
    for (const gap of [CAR_WIDTH * 0.5 + 1.0, CAR_WIDTH * 0.5 + 1.8, 4.2, 6.1]) {
      for (const side of [-1, 1]) {
        const p = offset(m.x, m.z, m.yaw, side * gap, -0.25);
        const floor = this.world.height(p.x, p.z);
        if (this.occupies(p.x, p.z, BODY_RADIUS) ||
            this.player.world.blocked(p.x, p.z, floor, true)) continue;
        destination = p;
        break;
      }
      if (destination) break;
    }
    if (!destination) {
      for (const gap of [4.5, 6.5, 9]) {
        for (let i = 0; i < 16; i++) {
          const angle = i / 16 * Math.PI * 2;
          const p = { x: m.x + Math.cos(angle) * gap, z: m.z + Math.sin(angle) * gap };
          if (!this.occupies(p.x, p.z, BODY_RADIUS) &&
              !this.player.world.blocked(p.x, p.z, this.world.height(p.x, p.z), true)) {
            destination = p;
            break;
          }
        }
        if (destination) break;
      }
    }
    if (!destination) destination = offset(m.x, m.z, m.yaw, CAR_WIDTH * 0.5 + 2.0, 0);
    controls.mode = 'player';
    this.player.enable(true);
    controls.yaw = m.yaw;
    controls.pitch = -0.24;
    this.player.warp(destination.x, destination.z, controls, true);
    controls.changed();
    return true;
  }

  teleport(station, controls) {
    if (!this.driving || !this.motion) return;
    const yaw = station.yaw;
    if (this.world.blocked(station.x, station.z, yaw)) {
      // Respect any station's occupied parcel and find nearby navigable ground.
      for (const radius of [4, 8, 12, 18]) {
        let found = false;
        for (let i = 0; i < 16; i++) {
          const x = station.x + Math.cos(i * Math.PI / 8) * radius;
          const z = station.z + Math.sin(i * Math.PI / 8) * radius;
          if (this.world.blocked(x, z, yaw)) continue;
          this.motion.x = x; this.motion.z = z; found = true; break;
        }
        if (found) break;
      }
    } else {
      this.motion.x = station.x;
      this.motion.z = station.z;
    }
    this.motion.yaw = yaw;
    this.motion.speed = this.motion.steer = 0;
    controls.yaw = yaw;
    controls.pitch = -0.2;
    this.cameraOrbit = 0;
    this.updateTransform(0);
    this.placeCamera(controls, 0);
  }

  look(dx, dy) {
    this.cameraOrbit = clamp(this.cameraOrbit - dx * 0.0022, -1.0, 1.0);
    this.cameraPitch = clamp(this.cameraPitch + dy * 0.002, -0.48, 0.44);
  }

  updateTransform(dt) {
    if (!this.motion) return;
    const m = this.motion;
    const contact = this.world.surface(m.x, m.z, m.yaw);
    this.root.position.x = m.x;
    this.root.position.z = m.z;
    const gain = dt === 0 ? 1 : 1 - Math.exp(-dt * 9);
    this.root.position.y += (contact.height - this.root.position.y) * gain;
    this.rotation.pitch += (clamp(contact.pitch, -0.35, 0.35) - this.rotation.pitch) * gain;
    this.rotation.roll += (clamp(contact.roll, -0.35, 0.35) - this.rotation.roll) * gain;
    this.root.rotation.set(this.rotation.pitch, m.yaw, this.rotation.roll, 'YXZ');
  }

  placeCamera(controls, dt) {
    if (!this.motion) return;
    const camera = controls.camera, m = this.motion;
    controls.yaw = m.yaw;
    const speedLook = Math.min(3.2, Math.abs(m.speed) * 0.11);
    const focus = offset(m.x, m.z, m.yaw, 0, speedLook);
    target.set(focus.x, this.root.position.y + 1.35, focus.z);
    const yaw = m.yaw + this.cameraOrbit;
    desired.set(
      m.x + Math.sin(yaw) * this.cameraDistance,
      this.root.position.y + 3.15 + this.cameraPitch * 4,
      m.z + Math.cos(yaw) * this.cameraDistance,
    );
    const ground = this.player.world;
    // An obstructed camera stays ahead of walls and terrain instead of clipping.
    for (let n = 1; n <= 16; n++) {
      probe.copy(target).lerp(desired, n / 16);
      const building = buildingAt(probe.x, probe.z, 0.15);
      if (probe.y <= ground.height(probe.x, probe.z) + 0.35 ||
          (building && probe.y > building.position.y &&
           probe.y < building.position.y + building.height)) {
        eye.copy(desired);
        desired.copy(target).lerp(eye, Math.max(0.22, (n - 1) / 16));
        break;
      }
    }
    desired.y = Math.max(desired.y, ground.height(desired.x, desired.z) + 0.42);
    if (dt === 0) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 7.5));
    camera.lookAt(target);
  }

  update(dt, controls) {
    if (!this.driving || !this.motion) return;
    const k = controls.keys;
    const before = this.motion.travel;
    advanceVehicle(this.motion, {
      drive: Number(k.has('KeyW') || k.has('ArrowUp')) -
        Number(k.has('KeyS') || k.has('ArrowDown')),
      steer: Number(k.has('KeyA') || k.has('ArrowLeft')) -
        Number(k.has('KeyD') || k.has('ArrowRight')),
      brake: k.has('Space'),
    }, dt, this.world);
    this.updateTransform(dt);
    for (const { mesh, radius, front } of this.wheels) {
      mesh.rotation.x += (this.motion.travel - before) / Math.max(radius, 0.1);
      if (front) mesh.rotation.y = this.motion.steer;
    }
    this.cameraOrbit *= Math.exp(-dt * 0.8);
    this.placeCamera(controls, dt);
  }

  get speedKmh() {
    return Math.round(Math.abs(this.motion?.speed || 0) * 3.6);
  }

  get shadowDirty() {
    return this.driving && Math.abs(this.motion?.speed || 0) > 0.2;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.clear();
    this.handle?.release();
    this.handle = null;
  }
}
