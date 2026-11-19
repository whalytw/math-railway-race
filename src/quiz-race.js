export const BASE_SPEED = 60;
export const DEFAULT_CAPS = [75, 90, 100];
export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// All clocks advance with the race simulation. Pausing the race freezes each lane.
export class QuizLane {
  constructor(units, level, seconds, caps, index) {
    this.units = units; this.level = level; this.limit = seconds; this.caps = caps;
    this.decks = units.map(u => {
      const pool = u.questions.filter(q => q.level === level);
      const offset = Math.floor(pool.length / 3) * index;
      return {pool, cards: [...pool.slice(offset), ...pool.slice(0, offset)]};
    });
    this.number = 0; this.correct = 0; this.phase = 'travel'; this.until = 8;
    this.clock = 0; this.ends = []; this.tier = 0; this.speed = 0; this.rate = 12;
    this.revision = 0; this.distance = 0; this.finished = null;
  }
  next() {
    const i = this.number % this.units.length, deck = this.decks[i];
    if (!deck.cards.length) deck.cards = shuffle(deck.pool);
    this.question = deck.cards.shift(); this.unit = this.units[i].label;
    const {answer} = this.question;
    const wrong = shuffle([-1,1,2,-2,3,-3]).slice(0,3).map(d => answer + d);
    this.options = shuffle([answer, ...wrong]); this.hinted = false;
    this.number++; this.phase = 'question'; this.until = this.clock + this.limit; this.revision++;
  }
  settle(choice) {
    if (this.phase !== 'question' || this.finished !== null) return;
    const ok = choice === this.question.answer;
    const bonus = ok ? Math.max(0, this.until - this.clock) : 0;
    if (ok) { this.correct++; this.ends.push((this.ends.at(-1) ?? this.clock) + bonus); }
    this.feedback = ok ? '答對！加速 +' + bonus.toFixed(1) + ' 秒' : (choice === null ? '時間到' : '答錯了') + ' · 正解 ' + this.question.answer;
    this.phase = 'feedback'; this.until = this.clock + 5; this.revision++;
  }
  hint() {
    if (this.phase !== 'question' || this.hinted) return;
    this.hinted = true; this.until -= 10; this.revision++;
    if (this.until <= this.clock) this.settle(null);
  }
  tick(dt, length) {
    if (this.finished !== null || dt <= 0) return;
    while (this.ends.length && this.ends[0] <= this.clock + 1e-8) this.ends.shift();
    const tier = Math.min(3, this.ends.length);
    const target = tier ? this.caps[tier-1] : BASE_SPEED;
    if (tier > this.tier) this.rate = Math.max(0, target-this.speed)/1.5;
    this.tier = tier;
    const speed = this.speed < target ? Math.min(target, this.speed + this.rate * dt) : Math.max(target, this.speed - 5 * dt);
    const travel = (speed + this.speed) / 7.2 * dt;
    if (this.distance + travel >= length) {
      this.finished = this.clock + dt * (length-this.distance)/travel;
      this.phase = 'finished'; this.distance = length; this.speed = 0; this.tier = 0; this.revision++;
      return;
    }
    this.clock += dt; this.distance += travel; this.speed = speed;
    if (this.clock + 1e-8 >= this.until) {
      if (this.phase === 'question') this.settle(null);
      else this.next();
    }
  }
}
