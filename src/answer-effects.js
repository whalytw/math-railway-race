import {playRaceSound} from './race-audio.js?v=18';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SHAKE_MS = 500;
const STAR_COUNT = 5;

export function showAnswerEffect(pane, view, answer, result, index, count) {
  if (!result.ok) {
    if (!reducedMotion.matches) view.answerShakeEnds = performance.now() + SHAKE_MS;
    playRaceSound('wrong', index, count);
    return;
  }

  playRaceSound('correct', index, count);
  if (!result.bonus || reducedMotion.matches || !pane.jetTime.getClientRects().length) return;
  const {effects, jetTime} = pane;
  const area = effects.getBoundingClientRect();
  const start = answer.getBoundingClientRect();
  const end = jetTime.getBoundingClientRect();
  const centerX = box => box.left + box.width / 2 - area.left;
  const centerY = box => box.top + box.height / 2 - area.top;
  const keepInside = x => Math.max(10, Math.min(area.width - 10, x));
  const x0 = keepInside(centerX(start)), y0 = centerY(start);
  const x1 = keepInside(centerX(end)), y1 = centerY(end);
  const arcSide = x0 < area.width / 2 ? 1 : -1;

  effects.dataset.tier = result.tier;
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElement('i');
    star.className = 'charge-star';
    effects.append(star);
    const launchX = keepInside(x0 + (i - 2) * 6);
    const arcX = keepInside((x0 + x1) / 2 + arcSide * (32 + 10 * i));
    const arcY = y1 - 52 - 8 * i;
    const frames = Array.from({length: 19}, (_, step) => {
      const t = step / 18, remaining = 1 - t;
      const x = remaining ** 2 * launchX + 2 * remaining * t * arcX + t ** 2 * x1;
      const y = remaining ** 2 * y0 + 2 * remaining * t * arcY + t ** 2 * y1;
      const scale = t < 0.25 ? 0.45 + t * 3 : 0.28 + remaining * 1.23;
      return {
        transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%) rotate(' + (t * 165 + i * 19) + 'deg) scale(' + scale + ')',
        opacity: Math.min(1, 0.3 + t * 7, remaining * 9),
      };
    });
    const flight = star.animate(frames, {duration: 520, delay: 70 + i * 75});
    flight.finished.then(() => {
      if (star.parentNode !== effects) return;
      star.remove();
      if (i === STAR_COUNT - 1 && jetTime.getClientRects().length) {
        jetTime.animate([{scale: 1}, {scale: 1.28, offset: 0.4}, {scale: 1}], {duration: 220});
        playRaceSound('charge', index, count);
      }
    }, () => star.remove());
  }
}

export function clearAnswerEffects(panes, views) {
  for (const {effects, jetTime} of panes) {
    for (const animation of effects.getAnimations({subtree: true})) animation.cancel();
    effects.replaceChildren();
    for (const animation of jetTime.getAnimations()) animation.cancel();
  }
  for (const view of views) view.answerShakeEnds = 0;
}

export function shakeAnswerCamera(view, now) {
  if (!(view.answerShakeEnds > now)) return;
  const remaining = Math.min(1, (view.answerShakeEnds - now) / SHAKE_MS);
  const phase = (1 - remaining) * Math.PI * 10;
  view.camera.rotateZ(Math.sin(phase) * 0.023 * remaining);
  view.camera.rotateY(Math.sin(phase * 1.22) * 0.013 * remaining);
}
