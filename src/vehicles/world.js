import { CAR_WIDTH, CAR_LENGTH, WHEELBASE, WHEEL_TRACK, CAR_HEIGHT, offset } from './physics.js';

// Probe the actual world collision index, never the instanced render batches.
// Points cover both bumpers, the centre and side skirts so walls, buildings,
// vegetation, pool rims and the shoreline block the *whole* car, not its centre.
const halfW = CAR_WIDTH * 0.5 - 0.08;
const halfL = CAR_LENGTH * 0.5 - 0.10;
const probes = [
  [0, 0], [0, halfL], [0, -halfL],
  [-halfW, halfL], [halfW, halfL],
  [-halfW, -halfL], [halfW, -halfL],
  [-halfW, 0], [halfW, 0],
  [-halfW, halfL * 0.5], [halfW, halfL * 0.5],
  [-halfW, -halfL * 0.5], [halfW, -halfL * 0.5],
  [-halfW * 0.5, halfL], [halfW * 0.5, halfL],
  [-halfW * 0.5, -halfL], [halfW * 0.5, -halfL],
];

export class VehicleWorld {
  constructor(characterWorld) {
    this.world = characterWorld;
  }

  height(x, z) {
    return this.world.height(x, z);
  }

  surface(x, z, yaw) {
    const f = WHEELBASE / 2;
    const t = WHEEL_TRACK / 2;
    const lf = offset(x, z, yaw, -t, f);
    const rf = offset(x, z, yaw, t, f);
    const lr = offset(x, z, yaw, -t, -f);
    const rr = offset(x, z, yaw, t, -f);
    const a = this.height(lf.x, lf.z);
    const b = this.height(rf.x, rf.z);
    const c = this.height(lr.x, lr.z);
    const d = this.height(rr.x, rr.z);
    const front = (a + b) * 0.5;
    const back = (c + d) * 0.5;
    const left = (a + c) * 0.5;
    const right = (b + d) * 0.5;
    return {
      height: (a + b + c + d) * 0.25,
      pitch: Math.atan2(front - back, WHEELBASE),
      roll: Math.atan2(right - left, WHEEL_TRACK),
      roughness: Math.max(a, b, c, d) - Math.min(a, b, c, d),
    };
  }

  blocked(x, z, yaw) {
    const terrain = this.surface(x, z, yaw);
    // Reject cliffs and tall vertical jumps without preventing gradual hills.
    if (Math.abs(terrain.pitch) > 0.40 || Math.abs(terrain.roll) > 0.41 ||
        terrain.roughness > 1.75) return true;
    for (const [lateral, forward] of probes) {
      const p = offset(x, z, yaw, lateral, forward);
      const y = this.height(p.x, p.z);
      if (y > terrain.height + 0.86) return true;
      if (this.world.blocked(p.x, p.z, Math.max(y, terrain.height - 0.65), true))
        return true;
    }
    return false;
  }
}
