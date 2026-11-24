import {clamp, routeFromPolyline, TAU} from './core.js?v=13.0.0';
import {RIFT_ENTRY, RIFT_EXIT} from './rift-rules.js?v=27';

const STEPS = 640;
const BRAID_RADIUS = 18;
const GATE_LANE_SPACING = 24;
const ease = u => u ** 3 * (10 + u * (-15 + 6 * u));

function phase(u, start, end) {
  return clamp((u - start) / (end - start), 0, 1);
}

function hill(u) {
  return Math.sin(Math.PI * u) ** 4;
}

export function createRiftTracks(rigs, random) {
  const length = rigs[0].raceLength * (RIFT_EXIT - RIFT_ENTRY);
  const handedness = random() < .5 ? -1 : 1;
  const spread = .051 + random() * .014;
  const rise = .033 + random() * .013;
  const twist = (random() < .5 ? -1 : 1) * TAU;
  const laneRadius = rigs.length === 1 ? 0 : BRAID_RADIUS;
  const pointsFor = (angle, single) => Array.from({length: STEPS + 1}, (_, i) => {
    const u = i / STEPS;
    const before = hill(phase(u, .03, .28)), after = hill(phase(u, .76, .98));
    const centreX = handedness * length * (.072 * before - .056 * after);
    const centreY = length * rise * (before - .88 * after);
    const turn = phase(u, .28, .76);
    const spreadOut = hill(turn);
    const radius = laneRadius + length * spread * spreadOut;
    const bearing = angle + twist * ease(turn);
    return {
      x: centreX + radius * Math.cos(bearing), y: centreY + radius * Math.sin(bearing), z: length * u,
      bank: handedness * (.59 * before - .62 * after) + (single ? 1 : .8) * .68 * spreadOut * Math.sin(bearing + .55),
    };
  });

  return rigs.map((rig, index) => {
    const angle = 7 * Math.PI / 6 - TAU * index / rigs.length;
    const points = pointsFor(angle, rigs.length === 1);
    const distances = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      distances[i] = distances[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    // A common bend acts only while the lane offsets are fixed. During the
    // braid the three curves are rotations of each other about the same axis.
    const scale = length / distances.at(-1);
    // A rigid translation places the three gate approaches on the outdoor
    // rail spacing without changing the measured distance of each braid.
    const shiftX = (index - (rigs.length - 1) / 2) * GATE_LANE_SPACING - points[0].x * scale;
    const shiftY = -points[0].y * scale;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      point.x = point.x * scale + shiftX;
      point.y = point.y * scale + shiftY;
      point.z *= scale;
      distances[i] *= scale;
    }
    distances[STEPS] = length;
    const path = routeFromPolyline(points, distances, length, length, {}, {closed: false});
    const start = rig.departure + rig.raceLength * RIFT_ENTRY;
    return {
      rig, start, length, points,
      sample(distance, out = {}) {
        const metres = distance - start;
        const t = clamp(metres, 0, length);
        path.sample(t, out);
        const extra = metres - t;
        out.x += extra * out.tx3; out.y += extra * out.ty; out.z += extra * out.tz3;
        // Recover the authored parameter from z (the curve only advances).
        const parameter = clamp(out.z / points.at(-1).z, 0, 1) * STEPS;
        const i = Math.min(STEPS - 1, Math.floor(parameter));
        out.roll = points[i].bank + (points[i + 1].bank - points[i].bank) * (parameter - i);
        return out;
      },
    };
  });
}
