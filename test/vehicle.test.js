import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAR_LENGTH, CAR_WIDTH, MAX_FORWARD, MAX_REVERSE,
  advanceVehicle, vehicleState, offset,
} from '../src/vehicles/physics.js';
import { VehicleWorld } from '../src/vehicles/world.js';

const clear = { blocked: () => false };
const step = (s, input, count = 60, world = clear) => {
  for (let i = 0; i < count; i++) advanceVehicle(s, input, 1 / 60, world);
};

test('car accelerates smoothly from rest, reaches speed limit and coast-friction slows it', () => {
  const v = vehicleState(0, 0, 0);
  assert.equal(v.speed, 0);
  step(v, { drive: 1 }, 60);
  assert.ok(v.speed > 9 && v.speed < 12);
  assert.ok(v.z < -3 && v.z > -8);
  step(v, { drive: 1 }, 400);
  assert.equal(v.speed, MAX_FORWARD);
  assert.ok(v.travel > 40);
  const before = v.speed;
  step(v, {}, 60);
  assert.ok(v.speed > 0 && v.speed < before);
});

test('reverse requires braking through zero and never exceeds the reverse limit', () => {
  const v = vehicleState(0, 0, 0);
  step(v, { drive: 1 }, 40);
  assert.ok(v.speed > 0);
  step(v, { drive: -1 }, 100);
  assert.ok(v.speed < 0);
  step(v, { drive: -1 }, 300);
  assert.equal(v.speed, -MAX_REVERSE);
  const previous = v.travel;
  step(v, {}, 15);
  assert.ok(v.travel < previous);
  step(v, { drive: 1 }, 100);
  assert.ok(v.speed > 0);
});

test('left/right steering is mirrored, smooth, and only turns a moving vehicle', () => {
  const left = vehicleState(0, 0, 0);
  const right = vehicleState(0, 0, 0);
  step(left, { drive: 1, steer: 1 }, 70);
  step(right, { drive: 1, steer: -1 }, 70);
  assert.ok(left.yaw > 0.1);
  assert.ok(right.yaw < -0.1);
  assert.ok(Math.abs(left.yaw + right.yaw) < 0.001);
  assert.ok(Math.abs(left.x + right.x) < 0.001);
  const staticCar = vehicleState(0, 0, 0);
  step(staticCar, { steer: 1 }, 100);
  assert.equal(staticCar.yaw, 0);
});

test('handbrake decelerates more strongly than coasting', () => {
  const a = vehicleState(0, 0, 0), b = vehicleState(0, 0, 0);
  step(a, { drive: 1 }, 90);
  step(b, { drive: 1 }, 90);
  step(a, { brake: true }, 25);
  step(b, {}, 25);
  assert.ok(a.speed < b.speed * 0.6);
});

test('car body stops at building-like wall using substeps, never tunnels through', () => {
  const fence = { blocked: (_x, z) => z <= -3 };
  const c = vehicleState(0, 0, 0);
  step(c, { drive: 1 }, 200, fence);
  assert.ok(c.z > -3 && c.z < -2);
  assert.equal(c.speed, 0);
  assert.equal(c.impact, true);
});

test('vehicle cannot escape the world boundary', () => {
  const s = vehicleState(0, -4861, 0);
  step(s, { drive: 1 }, 180);
  assert.ok(s.z > -4861.6);
});

test('4 wheel contacts are averaged and steep terrain and wide solid obstacles block', () => {
  const ground = { height: (x, z) => x * 0.05 - z * 0.08,
    blocked: () => false };
  const world = new VehicleWorld(ground);
  const surface = world.surface(0, 0, 0);
  assert.ok(Math.abs(surface.height) < 1e-6);
  assert.ok(surface.pitch > 0 && surface.roll > 0);
  assert.equal(world.blocked(0, 0, 0), false);

  const wall = new VehicleWorld({
    height: () => 0,
    blocked: (x, z) => x > CAR_WIDTH * 0.45 && z < 0.1,
  });
  assert.equal(wall.blocked(0, 0, 0), true);
  const cliff = new VehicleWorld({ height: (_x, z) => z < 0 ? 4 : 0, blocked: () => false });
  assert.equal(cliff.blocked(0, 0, 0), true);
});

test('side offsets and forward offsets follow yaw with physical dimensions', () => {
  assert.deepEqual(offset(0, 0, 0, 2, 3), { x: 2, z: -3 });
  const p = offset(0, 0, Math.PI / 2, CAR_WIDTH / 2, CAR_LENGTH / 2);
  assert.ok(p.x < -1);
  assert.ok(p.z < 0);
});
