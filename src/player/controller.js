import { AnimationMixer, Box3, Group, LoopOnce, Vector3 } from 'three';
import { buildingAt } from '../places/records.js';
import { advanceMotion, motionState, BODY_RADIUS } from './physics.js';
import { CharacterWorld } from './collision.js';

const focus = new Vector3();
const orbit = new Vector3();
const desired = new Vector3();
const point = new Vector3();

function turnTowards(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

export class CharacterController {
  constructor(scene, assets, places, forest, streamer) {
    this.scene = scene;
    this.assets = assets;
    this.places = places;
    this.forest = forest;
    this.streamer = streamer;
    this.root = new Group();
    this.root.name = 'AIRP Character';
    this.enabled = false;
    this.currentSpeed = 0;
    this.moving = false;
    this.shadowSeconds = 0;
    this.cameraDistance = 4.6;
  }

  async load() {
    this.handle = await this.assets.acquire('player-robot');
    try {
      const resource = this.handle.value;
      this.model = resource.instantiate();
      const bbox = new Box3().setFromObject(this.model);
      const dimensions = bbox.getSize(new Vector3());
      if (!Number.isFinite(dimensions.y) || dimensions.y < 0.01)
        throw Error('Animated character is missing valid mesh bounds');
      const scale = 1.78 / dimensions.y;
      this.model.scale.multiplyScalar(scale);
      this.model.position.y = -bbox.min.y * scale;
      this.model.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false; // Animated skin extends beyond its bind-pose box.
      });
      this.root.add(this.model);
      this.scene.add(this.root);
      this.mixer = new AnimationMixer(this.model);
      this.actions = new Map();
      // The source Jump and Running clips animate the Body bone vertically.
      // Keep their authored poses but remove most of that local root translation:
      // the collision capsule/physics already supplies actual world displacement.
      const bodyRestY = this.model.getObjectByName('Body')?.position.y;
      for (const source of resource.animations) {
        const clip = source.clone();
        const weight = ['Jump', 'WalkJump'].includes(clip.name) ? 0.1 :
          clip.name === 'Running' ? 0.28 : 1;
        if (bodyRestY !== undefined && weight !== 1) {
          for (const track of clip.tracks) {
            if (!track.name.endsWith('Body.position')) continue;
            for (let i = 1; i < track.values.length; i += 3)
              track.values[i] = bodyRestY + (track.values[i] - bodyRestY) * weight;
          }
        }
        this.actions.set(clip.name, this.mixer.clipAction(clip));
      }
      for (const name of ['Idle', 'Walking', 'Running', 'Jump', 'WalkJump'])
        if (!this.actions.has(name)) throw Error('Character animation missing: ' + name);
      for (const name of ['Jump', 'WalkJump']) {
        const action = this.actions.get(name);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.play('Idle', 0);
      this.root.visible = false;
    } catch (error) {
      this.root.removeFromParent();
      this.handle.release();
      this.handle = null;
      throw error;
    }
  }

  connect(controls) {
    this.controls = controls;
    this.world = new CharacterWorld(controls, this.forest, this.places, this.streamer);
  }

  play(name, fade = 0.16) {
    if (this.actionName === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    const prior = this.actionName && this.actions.get(this.actionName);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (prior && prior !== next) prior.crossFadeTo(next, fade, false);
    this.actionName = name;
  }

  enable(value) {
    this.enabled = value;
    this.root.visible = value;
    if (!value) {
      this.currentSpeed = 0;
      this.moving = false;
    }
  }

  // Teleport and spectator-to-player transitions share this safe placement path.
  warp(x, z, controls, immediate = true) {
    const safe = (a, b) => !this.world.blocked(a, b, this.world.height(a, b));
    if (!safe(x, z)) {
      const building = buildingAt(x, z, BODY_RADIUS);
      if (building) {
        x = building.entrance.x;
        z = building.entrance.z;
      }
    }
    if (!safe(x, z)) {
      const sx = x, sz = z;
      outer: for (const radius of [0.8, 1.5, 2.5, 4, 6, 9, 14]) {
        for (let n = 0; n < 24; n++) {
          const a = n * Math.PI / 12;
          const nx = sx + Math.cos(a) * radius;
          const nz = sz + Math.sin(a) * radius;
          if (safe(nx, nz)) {
            x = nx; z = nz;
            break outer;
          }
        }
      }
    }
    this.motion = motionState(x, this.world.height(x, z), z);
    this.heading = controls.yaw + Math.PI;
    this.root.position.set(x, this.motion.y, z);
    this.model.rotation.y = this.heading;
    this.play('Idle');
    this.currentSpeed = 0;
    this.moving = false;
    this.placeCamera(controls, immediate ? 0 : 1 / 60);
  }

  placeCamera(controls, dt) {
    const camera = controls.camera, s = this.motion;
    focus.set(s.x, s.y + 1.43, s.z);
    const yaw = controls.yaw;
    const pitch = Math.max(-0.85, Math.min(0.3, controls.pitch));
    desired.set(
      focus.x + Math.sin(yaw) * this.cameraDistance * Math.cos(pitch),
      focus.y - Math.sin(pitch) * this.cameraDistance,
      focus.z + Math.cos(yaw) * this.cameraDistance * Math.cos(pitch),
    );

    // Shorten the chase boom if hills, road embankments or buildings occlude it.
    let fraction = 1;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      point.copy(focus).lerp(desired, t);
      const obstacle = buildingAt(point.x, point.z, 0.16);
      if (point.y < this.world.height(point.x, point.z) + 0.22 ||
          (obstacle && point.y < obstacle.position.y + obstacle.height &&
            point.y > obstacle.position.y)) {
        fraction = Math.max(0.2, (i - 1) / 16);
        break;
      }
    }
    orbit.copy(focus).lerp(desired, fraction);
    orbit.y = Math.max(orbit.y, this.world.height(orbit.x, orbit.z) + 0.26);
    if (dt === 0) camera.position.copy(orbit);
    else camera.position.lerp(orbit, 1 - Math.exp(-dt * 10));
    camera.lookAt(focus);
  }

  update(dt, controls) {
    if (!this.enabled || !this.motion) return;
    const keys = controls.keys;
    const input = {
      forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
      right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
      yaw: controls.yaw,
      jump: keys.has('Space'),
      run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
    const result = advanceMotion(this.motion, input, dt, this.world);
    this.currentSpeed = result.speed;
    this.moving = result.moving;
    this.root.position.set(this.motion.x, this.motion.y, this.motion.z);
    if (result.moving) {
      const facing = Math.atan2(this.motion.vx, this.motion.vz);
      this.heading = turnTowards(this.heading, facing, 1 - Math.exp(-dt * 15));
      this.model.rotation.y = this.heading;
    }
    if (!this.motion.grounded) {
      if (result.jumped || !['Jump', 'WalkJump'].includes(this.actionName))
        this.play(result.moving ? 'WalkJump' : 'Jump', 0.11);
    } else {
      this.play(result.speed < 0.35 ? 'Idle' :
        input.run && result.speed > 4.5 ? 'Running' : 'Walking');
    }
    this.mixer.update(dt);
    this.placeCamera(controls, dt);
  }

  get shadowDirty() {
    return this.enabled && (this.moving || Boolean(this.motion && !this.motion.grounded));
  }

  dispose() {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.root.removeFromParent();
    this.root.clear();
    this.handle?.release();
    this.handle = null;
  }
}
