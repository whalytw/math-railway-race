// The envelope rises before a high sample and descends gradually after it.
export function flightElevations(floors, climb, descent, spacing) {
  const elevations = floors.slice();
  const last = floors.length - 1;
  for (let i = 0; i <= last; i++) {
    // Each cubic control covers the obstacle samples within its spline span.
    for (let j = Math.max(0, i - 2); j <= Math.min(last, i + 2); j++) {
      elevations[i] = Math.max(elevations[i], floors[j]);
    }
  }
  for (let i = last - 1; i >= 0; i--) {
    const step = typeof spacing === 'number' ? spacing : spacing[i + 1];
    elevations[i] = Math.max(elevations[i], elevations[i + 1] - climb * step);
  }
  for (let i = 1; i <= last; i++) {
    const step = typeof spacing === 'number' ? spacing : spacing[i];
    elevations[i] = Math.max(elevations[i], elevations[i - 1] - descent * step);
  }
  return elevations;
}

// Uniform cubic B-spline with a continuous slope and no overshoot.
export function flightSample(samples, at) {
  const last = samples.length - 1;
  const index = Math.max(0, Math.min(last, at));
  const i = Math.floor(index), t = index - i;
  const a = samples[Math.max(0, i - 1)], b = samples[i];
  const c = samples[Math.min(last, i + 1)], d = samples[Math.min(last, i + 2)];
  const s = 1 - t;
  return (a * s ** 3 + b * (4 - 6 * t * t + 3 * t ** 3)
    + c * (1 + 3 * t + 3 * t * t - 3 * t ** 3) + d * t ** 3) / 6;
}
