import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMotion, motionState, WALK_SPEED, RUN_SPEED, WORLD_EDGE,
} from '../src/player/physics.js';

const flat = { height: () => 0, blocked: () => false };
function steps(s, input, count = 120, world = flat) {
  for (let i = 0; i < count; i++) advanceMotion(s, input, 1 / 60, world);
}

test('character walking and running move at physically bounded speeds in metres', () => {
  const walk = motionState(0, 0, 0);
  steps(walk, { forward: 1, yaw: 0 });
  assert.ok(walk.z < -5 && walk.z > -WALK_SPEED * 2 - 0.1);
  assert.equal(walk.y, 0);
  assert.equal(walk.grounded, true);

  const run = motionState(0, 0, 0);
  steps(run, { forward: 1, yaw: 0, run: true });
  assert.ok(run.z < walk.z * 1.7 && Math.abs(run.vz) <= RUN_SPEED + 0.01);

  const diagonal = motionState(0, 0, 0);
  steps(diagonal, { forward: 1, right: 1, yaw: 0 });
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - Math.abs(walk.z)) < 0.1);
});

test('space launches a jump once; gravity and ground snap complete the landing', () => {
  const s = motionState(0, 0, 0);
  const first = advanceMotion(s, { jump: true }, 1 / 60, flat);
  assert.equal(first.jumped, true);
  assert.equal(s.grounded, false);
  let highest = s.y;
  for (let i = 0; i < 120; i++) {
    const event = advanceMotion(s, { jump: true }, 1 / 60, flat);
    assert.equal(event.jumped, false);
    highest = Math.max(highest, s.y);
  }
  assert.ok(highest > 1 && highest < 2);
  assert.ok(Math.abs(s.y) < 1e-5 && s.grounded);
  advanceMotion(s, { jump: false }, 1 / 60, flat);
  assert.equal(advanceMotion(s, { jump: true }, 1 / 60, flat).jumped, true);
});

test('solid walls block the character, even with sprinting and a 60ms frame', () => {
  const wall = { height: () => 0, blocked: (_x, z) => z <= -1 };
  const s = motionState(0, 0, 0);
  steps(s, { forward: 1, run: true }, 120, wall);
  assert.ok(s.z > -1 && s.z < -0.6);
  assert.equal(s.grounded, true);
  assert.ok(s.vz <= 0);
});

test('step height, deep drops and world bounds are resolved without penetration', () => {
  const ledge = { height: (_x, z) => z < -0.5 ? 1.3 : 0, blocked: () => false };
  const s = motionState(0, 0, 0);
  steps(s, { forward: 1, run: true }, 120, ledge);
  assert.ok(s.z > -0.5);
  assert.ok(s.y >= 0);

  const falling = motionState(0, 0, 0);
  const gap = { height: (_x, z) => z < -0.5 ? -3 : 0, blocked: () => false };
  steps(falling, { forward: 1 }, 120, gap);
  assert.ok(falling.y <= 0 && falling.y >= -3.01);

  const edge = motionState(WORLD_EDGE - 0.02, 0, 0);
  steps(edge, { right: 1, run: true }, 120);
  assert.ok(edge.x <= WORLD_EDGE);
});

test('movement is stable with a zero delta and long frames are capped', () => {
  const a = motionState(0, 0, 0);
  assert.equal(advanceMotion(a, { forward: 1 }, 0, flat).jumped, false);
  assert.equal(a.z, 0);
  advanceMotion(a, { forward: 1 }, 10, flat);
  assert.ok(a.z > -0.6);
});
