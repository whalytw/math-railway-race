export const COAST_SECONDS = 10;
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
  constructor(units, seconds, caps, index, recent = {}) {
    this.units = units; this.level = 1; this.streak = 0; this.limit = seconds; this.caps = caps;
    this.decks = units.map(u => [1, 2, 3].map(level => {
      const pool = u.questions.filter(q => q.level === level);
      const offset = Math.floor(pool.length / 3) * index;
      const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
      const seen = new Set(recent[u.topic + '/' + level] ?? []);
      return {pool, cards: [...rotated.filter(q => !seen.has(q.prompt)), ...rotated.filter(q => seen.has(q.prompt))]};
    }));
    this.coastTime = 0; this.coastDistance = 0; this.finishSpeed = 0;
    this.number = 0; this.correct = 0; this.phase = 'travel'; this.until = 8;
    this.clock = 0; this.ends = []; this.tier = 0; this.speed = 0; this.rate = 12;
    this.revision = 0; this.distance = 0; this.finished = null;
  }
  next() {
    this.level = this.streak >= 3 ? 3 : this.streak >= 2 ? 2 : 1;
    const i = this.number % this.units.length, deck = this.decks[i][this.level-1];
    if (!deck.cards.length) {
      deck.cards = shuffle(deck.pool);
      if (deck.cards.length > 1 && deck.cards[0] === deck.last) deck.cards.push(deck.cards.shift());
    }
    this.question = deck.last = deck.cards.shift(); this.topic = this.units[i].topic; this.unit = this.units[i].label;
    const {answer} = this.question;
    const wrong = shuffle([-1,1,2,-2,3,-3]).slice(0,this.level + 2).map(d => answer + d);
    this.options = shuffle([answer, ...wrong]); this.hinted = false;
    this.result = null;
    this.number++; this.phase = 'question'; this.until = this.clock + this.limit; this.revision++;
  }
  get boostTier() {
    if (this.finished !== null) return 0;
    const firstActive = this.ends.findIndex(end => end > this.clock + 1e-8);
    return firstActive < 0 ? 0 : Math.min(3, this.ends.length - firstActive);
  }
  settle(choice) {
    if (this.phase !== 'question' || this.finished !== null) return;
    const ok = choice === this.question.answer;
    this.streak = ok ? this.streak + 1 : 0;
    const bonus = ok ? Math.max(0, this.until - this.clock) : 0;
    if (ok) {
      this.correct++;
      if (bonus > 0) {
        const tail = Math.max(this.ends.at(-1) ?? this.clock, this.clock);
        this.ends.push(tail + bonus);
      }
    }
    this.result = {choice, ok, bonus, tier: this.boostTier};
    this.feedback = ok ? '答對！加速 +' + bonus.toFixed(1) + ' 秒' : (choice === null ? '時間到' : '答錯了') + ' · 正解 ' + this.question.answer;
    this.phase = 'feedback'; this.until = this.clock + 5; this.revision++;
    return this.result;
  }
  hint() {
    if (this.phase !== 'question' || this.hinted) return;
    this.hinted = true; this.until -= 10; this.revision++;
    if (this.until <= this.clock) this.settle(null);
  }
  coast(dt) {
    this.coastTime = Math.min(COAST_SECONDS, this.coastTime + dt);
    const fraction = this.coastTime / COAST_SECONDS;
    this.speed = this.finishSpeed * (1 - fraction);
    this.coastDistance = (this.finishSpeed + this.speed) * this.coastTime / 7.2;
  }
  tick(dt, length) {
    if (dt <= 0) return;
    if (this.finished !== null) { this.coast(dt); return; }
    while (this.ends.length && this.ends[0] <= this.clock + 1e-8) this.ends.shift();
    const tier = Math.min(3, this.ends.length);
    const target = tier ? this.caps[tier-1] : BASE_SPEED;
    if (tier > this.tier) this.rate = Math.max(0, target-this.speed)/1.5;
    this.tier = tier;
    const speed = this.speed < target ? Math.min(target, this.speed + this.rate * dt) : Math.max(target, this.speed - 5 * dt);
    const travel = (speed + this.speed) / 7.2 * dt;
    if (this.distance + travel >= length) {
      const crossing = dt * (length-this.distance)/travel;
      this.finished = this.clock + crossing;
      this.finishSpeed = this.speed + (speed-this.speed) * crossing/dt;
      this.phase = 'finished'; this.distance = length; this.coast(dt-crossing); this.tier = 0; this.revision++;
      return;
    }
    this.clock += dt; this.distance += travel; this.speed = speed;
    if (this.clock + 1e-8 >= this.until) {
      if (this.phase === 'question') this.settle(null);
      else this.next();
    }
  }
}
