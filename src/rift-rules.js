export const RIFT_DRAW = .50;
export const RIFT_ENTRY = .65;
export const RIFT_EXIT = .95;
export const PORTAL_APPROACH = 25;
export const RIFT_CHANCES = Array.from({length: 11}, (_, i) => i * 5);
export const DEFAULT_RIFT_CHANCE = 40;
export const RIFT_NEBULAS = ['indigo', 'amber', 'ruby', 'turquoise', 'orchid', 'emerald', 'silver'];

export function chooseNebula(previous, random = Math.random) {
  const options = RIFT_NEBULAS.filter(name => name !== previous);
  return options[Math.floor(random() * options.length)];
}

export class RiftDraw {
  constructor(chance, random = Math.random) {
    this.chance = chance;
    this.random = random;
    this.reset();
  }

  reset() {
    this.result = this.chance === 0 ? false : null;
  }

  update(leaderProgress) {
    if (this.result === null && leaderProgress >= RIFT_DRAW) {
      this.result = this.random() * 100 < this.chance;
    }
    return this.result;
  }
}

export function inRift(distance, raceLength) {
  return distance >= raceLength * RIFT_ENTRY && distance < raceLength * RIFT_EXIT;
}

export function portalDistance(distance, raceLength) {
  const entry = distance - raceLength * RIFT_ENTRY;
  const exit = distance - raceLength * RIFT_EXIT;
  return Math.abs(entry) < Math.abs(exit) ? entry : exit;
}

export function spaceEncounters(count, random) {
  const shapes = [0, 1, 2];
  for (let i = shapes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
  }
  return Array.from({length: count}, (_, lane) => ({
    fleet: random() < .92 ? {
      count: 5 + Math.floor(random() * 2),
      start: .24 + random() * .37,
      side: random() < .5 ? -1 : 1,
      colour: random(),
    } : null,
    probe: random() < .60 ? {
      shape: shapes[lane],
      start: .075 + random() * .28,
      duration: 10 + random() * 5,
      side: random() < .5 ? -1 : 1,
      phase: random() * Math.PI * 2,
    } : null,
  }));
}
