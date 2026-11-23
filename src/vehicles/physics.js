// Signed-speed bicycle handling in metres/seconds; no physics-library timestep drift.
// +steering turns the car left; yaw=0 faces world north (-Z).
export const CAR_LENGTH = 3.65;
export const CAR_WIDTH = 2.72;
export const WHEELBASE = 2.42;
export const WHEEL_TRACK = 1.85;
export const WHEEL_RADIUS = 0.37;
export const MAX_FORWARD = 28;   // 101 km/h
export const MAX_REVERSE = 9;
export const MAX_STEER = 0.55;
export const DRIVE_LIMIT = 4864 - 2.5;
export const CAR_HEIGHT = 1.65;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const towardZero = (v, amount) => Math.sign(v) * Math.max(0, Math.abs(v) - amount);

export function vehicleState(x, z, yaw = 0) {
  return { x, z, yaw, speed: 0, steer: 0, travel: 0, impact: false };
}

export function offset(x, z, yaw, lateral, forward) {
  return {
    x: x + Math.cos(yaw) * lateral - Math.sin(yaw) * forward,
    z: z - Math.sin(yaw) * lateral - Math.cos(yaw) * forward,
  };
}

export function advanceVehicle(s, input, dt, world) {
  dt = clamp(dt, 0, 0.06);
  const drive = clamp(input.drive || 0, -1, 1);
  const turn = clamp(input.steer || 0, -1, 1);
  const brake = Boolean(input.brake);
  const oldSpeed = s.speed;

  const maxSteer = MAX_STEER / (1 + Math.abs(s.speed) * 0.031);
  const desired = turn * maxSteer;
  s.steer += (desired - s.steer) * (1 - Math.exp(-dt * 9));

  if (drive > 0.01) {
    if (s.speed < -0.15) s.speed = Math.min(0, s.speed + dt * (18 + 3 * drive));
    else s.speed += 10.3 * drive * dt;
  } else if (drive < -0.01) {
    if (s.speed > 0.15) s.speed = Math.max(0, s.speed - dt * (19 - 2 * drive));
    else s.speed += 6.7 * drive * dt;
  } else {
    s.speed = towardZero(s.speed, dt * (0.85 + 0.014 * s.speed * s.speed));
  }

  // Handbrake stays responsive without instant reversal or teleportation.
  if (brake) s.speed = towardZero(s.speed, dt * 19);
  s.speed = clamp(s.speed, -MAX_REVERSE, MAX_FORWARD);
  if (Math.abs(s.speed) < 0.02) s.speed = 0;
  s.impact = false;

  // Small spatial steps prevent a fast car crossing thin fences between frames.
  const steps = Math.max(1, Math.ceil(Math.abs(s.speed) * dt / 0.22));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (Math.abs(s.speed) < 1e-8) break;
    const turnRate = Math.tan(s.steer) * s.speed / WHEELBASE;
    const yaw = s.yaw + turnRate * h;
    const mid = (s.yaw + yaw) * 0.5;
    const nx = s.x - Math.sin(mid) * s.speed * h;
    const nz = s.z - Math.cos(mid) * s.speed * h;
    if (Math.max(Math.abs(nx), Math.abs(nz)) > DRIVE_LIMIT ||
        world.blocked(nx, nz, yaw)) {
      s.speed = 0;
      s.impact = true;
      break;
    }
    s.x = nx;
    s.z = nz;
    s.yaw = yaw;
    s.travel += s.speed * h;
  }

  return { speed: s.speed, steer: s.steer, moved: s.travel, impact: s.impact,
    accelerating: Math.abs(s.speed) > Math.abs(oldSpeed) + 0.01 };
}
