import {BASE_SPEED} from './quiz-race.js?v=23';

export const CLOUD_EVENTS = [{progress: .25, rewardSeconds: 3}, {progress: .50, rewardSeconds: 5}, {progress: .70, rewardSeconds: 7}];
const PROGRESS_MARGIN = .08;
const APPROACH_PADDING = 12;
const EXIT_PADDING = 20;
const EPS = 1e-8;

export function cloudProgress(view) {
  return view.quiz.distance / view.rig.raceLength;
}

function overlapsTunnel(tunnel, view, looping, delay, duration, rewardSeconds) {
  if (view.quiz.finished !== null || (!looping && tunnel.turnIndex !== view.rig.laneIndex)) return false;
  const {distance, speed} = view.state, {length} = view.rig.track;
  // The course cannot slow below base speed in this part of a race. Cover a
  // fresh JET answer or a cloud bonus even when neither is active at launch.
  const slow = Math.min(speed, BASE_SPEED / 3.6);
  const fast = Math.max(speed, BASE_SPEED / 3.6, ...view.quiz.caps.map(kmh => kmh / 3.6));
  const from = distance + slow * delay;
  const to = distance + fast * (delay + duration) + rewardSeconds * 10 / 3.6;
  const entry = tunnel.start - APPROACH_PADDING;
  const exit = tunnel.end + EXIT_PADDING;
  if (!looping) return from <= exit && to >= entry;
  const lap = Math.floor((from - entry) / length);
  return from <= exit + lap * length || to >= entry + (lap + 1) * length;
}

export function cloudLaunchDecision(views, tunnel, looping, event, preferredSeconds, minimumSeconds = preferredSeconds, blocksFlight) {
  const leader = views.reduce((a, b) => cloudProgress(a) >= cloudProgress(b) ? a : b);
  const current = cloudProgress(leader);
  const nominal = event.progress;
  if (current > nominal + PROGRESS_MARGIN + EPS) return {status: 'skip'};
  if (current < nominal - PROGRESS_MARGIN - EPS) return {status: 'wait'};

  const blocked = (delay, duration) => (tunnel && views.some(view =>
    overlapsTunnel(tunnel, view, looping, delay, duration, event.rewardSeconds)))
    || blocksFlight?.(delay, duration, event.rewardSeconds);
  if (blocked(0, minimumSeconds)) return {status: 'wait'};
  const preferredDelay = (nominal - current) * leader.rig.raceLength / Math.max(BASE_SPEED / 3.6, leader.state.speed);
  if (current + EPS < nominal && !blocked(preferredDelay, minimumSeconds)) return {status: 'wait'};

  const duration = preferredSeconds > minimumSeconds && blocked(0, preferredSeconds) ? minimumSeconds : preferredSeconds;
  return {status: 'launch', duration};
}
