import { clamp, DEPARTURE_COUNTDOWN, lerp } from './core.js?v=13.0.0';

export function checkRaceBoundary(view, beforeElapsed) {
  const { state, engine, previous, rig } = view;
  const finish = rig.track.length;
  let boundary;
  if (state.distance < 0) boundary = 0;
  else if (state.distance >= finish) {
    boundary = finish;
    const fraction = clamp((finish - previous.distance) / (state.distance - previous.distance), 0, 1);
    view.finishTime = Math.max(0, lerp(beforeElapsed, state.elapsed, fraction) - DEPARTURE_COUNTDOWN);
  } else return;
  state.odometer = Math.max(0, state.odometer - Math.abs(state.distance - boundary));
  engine.holdAt(state, boundary);
}

export function raceStandings(finishTimes, distances = []) {
  const sorted = finishTimes.map((time, lane) => ({
    time, lane,
    finishTime: time == null ? Infinity : Number(time.toFixed(3)),
    distance: time == null ? (distances[lane] ?? 0) : 0,
  })).sort((a, b) => {
    if (a.finishTime !== b.finishTime) return a.finishTime - b.finishTime;
    return b.distance - a.distance;
  });
  let rank = 1;
  return sorted.map(({time, lane, finishTime, distance}, index) => {
    const previous = sorted[index - 1];
    if (previous && (previous.finishTime !== finishTime || previous.distance !== distance)) rank = index + 1;
    return {time, lane, rank};
  });
}
