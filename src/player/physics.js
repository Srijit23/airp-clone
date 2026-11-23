// Deterministic, renderer-independent capsule-foot movement in world metres.
// The caller supplies heights from AIRP's actual streamed terrain/road queries.
export const BODY_RADIUS = 0.38;
export const BODY_HEIGHT = 1.8;
export const WALK_SPEED = 3.5;
export const RUN_SPEED = 7.1;
export const JUMP_SPEED = 8.1;
export const GRAVITY = 23.5;
export const STEP_HEIGHT = 0.48;
export const MAX_SLOPE = 1.12; // max allowed rise per horizontal metre
export const WORLD_EDGE = 9728 / 2 - BODY_RADIUS - 0.1;

export function motionState(x, y, z) {
  return { x, y, z, vx: 0, vz: 0, vy: 0, grounded: true, jumpHeld: false };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function advanceMotion(s, input, dt, world) {
  dt = clamp(dt, 0, 0.06);
  const f = clamp(input.forward || 0, -1, 1);
  const r = clamp(input.right || 0, -1, 1);
  const n = Math.hypot(f, r) || 1;
  const angle = input.yaw || 0;
  const dx = (-Math.sin(angle) * f + Math.cos(angle) * r) / n;
  const dz = (-Math.cos(angle) * f - Math.sin(angle) * r) / n;
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const gain = Math.min(1, dt * (s.grounded ? 12 : 3.5));
  s.vx += (dx * speed - s.vx) * gain;
  s.vz += (dz * speed - s.vz) * gain;
  const jumpPressed = Boolean(input.jump) && !s.jumpHeld;
  s.jumpHeld = Boolean(input.jump);
  let jumped = false;
  let landed = false;
  if (jumpPressed && s.grounded) {
    s.grounded = false;
    s.vy = JUMP_SPEED;
    jumped = true;
  }

  // Substeps ensure a fast runner cannot tunnel through a thin collision proxy.
  const steps = Math.max(1, Math.ceil(Math.hypot(s.vx, s.vz) * dt / 0.18));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    let ground = world.height(s.x, s.z);
    for (const axis of ['x', 'z']) {
      const velocity = axis === 'x' ? s.vx : s.vz;
      if (!velocity) continue;
      const nx = axis === 'x' ? clamp(s.x + velocity * h, -WORLD_EDGE, WORLD_EDGE) : s.x;
      const nz = axis === 'z' ? clamp(s.z + velocity * h, -WORLD_EDGE, WORLD_EDGE) : s.z;
      const nextFloor = world.height(nx, nz);
      const delta = Math.hypot(nx - s.x, nz - s.z);
      const climb = nextFloor - ground;
      // Allow small kerbs and pavement lips; block tall, near-vertical terrain rises.
      const tooSteep = s.grounded && climb > 0.24 && climb / Math.max(delta, 0.001) > MAX_SLOPE;
      const tooHigh = nextFloor - s.y > (s.grounded ? STEP_HEIGHT : 0.05);
      if (tooSteep || tooHigh || world.blocked(nx, nz, s.y)) {
        if (axis === 'x') s.vx = 0;
        else s.vz = 0;
      } else {
        s.x = nx;
        s.z = nz;
        ground = nextFloor;
      }
    }
    const floor = world.height(s.x, s.z);
    if (s.grounded) {
      if (s.y - floor <= 0.22) {
        s.y = floor;
      } else {
        s.grounded = false;
        s.vy = 0;
      }
    }
    if (!s.grounded) {
      s.vy -= GRAVITY * h;
      s.y += s.vy * h;
      if (s.vy <= 0 && s.y <= floor) {
        s.y = floor;
        s.vy = 0;
        s.grounded = true;
        landed = true;
      }
    }
  }
  return { jumped, landed, moving: Math.hypot(s.vx, s.vz) > 0.18, speed: Math.hypot(s.vx, s.vz) };
}
