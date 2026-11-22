const tracks = new Map([
  ["racing-game-menu", "Racing Game Menu"],
  ["super-wreck-roadway", "Super Wreck Roadway"],
  ["hyper-ultra-racing", "Hyper Ultra-Racing"],
  ["hyperflight-racing", "Hyperflight Racing"],
  ["tech-rave-faster", "Tech Rave (Faster)"],
  ["determined-pursuit", "Determined Pursuit"],
  ["battle-rpg-theme", "Battle RPG Theme"],
  ["8bit-miniboss-battle", "8bit Action Miniboss Battle"],
  ["8bit-boss-climax", "8bit Action Boss Battle (Climax)"],
  ["retro-level-3", "Retro Game Music Pack · Level 3"],
]);
const effects = {
  correct: {file: 'correct', gain: 1},
  wrong: {file: 'wrong', gain: 0.82},
  charge: {file: 'charge', gain: 0.42},
  depart: {file: 'depart', gain: 0.72},
  finish: {file: 'finish', gain: 0.85},
};
const settingsKey = 'math-railway-audio-v2';
const $ = id => document.getElementById(id);

let context, musicGain, effectsGain, masterGain;
let race, lastTrack, cachedMusic, muted = false, settings;
const samples = new Map();
const voices = new Set();

export function setupRaceAudio() {
  let saved, preferredTrack;
  try {
    const current = localStorage.getItem(settingsKey);
    saved = JSON.parse(current || localStorage.getItem('math-railway-audio-v1'));
    if (current) preferredTrack = saved?.track;
  } catch {}
  const volume = (value, fallback) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
  settings = {
    track: preferredTrack === 'random' || tracks.has(preferredTrack) ? preferredTrack : 'off',
    music: volume(saved?.music, 32),
    effects: volume(saved?.effects, 68),
  };
  const musicSelect = $('audio-track');
  musicSelect.append(...Array.from(tracks, ([id, title]) => new Option(title, id)));
  musicSelect.value = settings.track;
  $('audio-music').value = settings.music;
  $('audio-effects').value = settings.effects;

  function syncSettings() {
    settings.track = $('audio-track').value;
    settings.music = $('audio-music').valueAsNumber;
    settings.effects = $('audio-effects').valueAsNumber;
    $('music-volume-value').textContent = settings.music + '%';
    $('effects-volume-value').textContent = settings.effects + '%';
    syncGains();
  }
  for (const id of ['audio-track', 'audio-music', 'audio-effects']) {
    $(id).addEventListener('input', syncSettings);
    $(id).addEventListener('change', () => {
      syncSettings();
      try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch {}
    });
  }
  $('audio-mute').addEventListener('click', () => {
    muted = !muted;
    $('audio-mute').setAttribute('aria-pressed', String(muted));
    syncGains();
  });
  syncSettings();
}

function syncGains() {
  if (!context) return;
  musicGain.gain.value = 0.42 * settings.music / 100;
  effectsGain.gain.value = 0.26 * settings.effects / 100;
  masterGain.gain.value = muted ? 0 : 1;
}

async function decode(file) {
  const response = await fetch('./assets/audio/' + file + '?v=19');
  if (!response.ok) throw new Error('Audio asset unavailable: ' + file);
  return context.decodeAudioData(await response.arrayBuffer());
}

// Call during the Start button's user gesture, before async scene loading.
export function prepareRaceAudio() {
  try {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      context = new AudioContextClass();
      masterGain = context.createGain();
      musicGain = context.createGain();
      effectsGain = context.createGain();
      musicGain.connect(masterGain);
      effectsGain.connect(masterGain);
      masterGain.connect(context.destination);
    }
    muted = false;
    $('audio-mute').setAttribute('aria-pressed', 'false');
    syncGains();
    context.resume().catch(() => {});
    for (const [cue, {file}] of Object.entries(effects)) {
      if (samples.has(cue)) continue;
      const pending = decode(file + '.wav');
      samples.set(cue, pending);
      pending.then(buffer => samples.set(cue, buffer), () => samples.delete(cue));
    }
  } catch {
    // Gameplay remains available when the browser has no audio output.
  }
}

export async function startRaceAudio() {
  if (!context) return;
  const active = {paused: false, music: null};
  race = active;
  if (settings.track === 'off' || !settings.music) return;
  let track = settings.track;
  if (track === 'random') {
    const candidates = [...tracks.keys()].filter(candidate => candidate !== lastTrack);
    track = candidates[Math.floor(Math.random() * candidates.length)];
  }
  lastTrack = track;
  try {
    if (cachedMusic?.track !== track) cachedMusic = {track, audio: decode(track + '.mp3')};
    const buffer = await cachedMusic.audio;
    if (race !== active) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(musicGain);
    source.start();
    active.music = source;
  } catch {
    if (cachedMusic?.track === track) cachedMusic = undefined;
  }
}

export function playRaceSound(cue, lane = 0, laneCount = 1) {
  if (!race || race.paused || muted || !settings.effects || context.state !== 'running') return;
  const buffer = samples.get(cue);
  if (!buffer || typeof buffer.then === 'function') return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  const volume = context.createGain();
  source.connect(volume);
  volume.gain.value = effects[cue].gain;
  let output = volume;
  if (laneCount > 1 && context.createStereoPanner) {
    const pan = context.createStereoPanner();
    pan.pan.value = 0.35 * (2 * lane / (laneCount - 1) - 1);
    volume.connect(pan);
    output = pan;
  }
  output.connect(effectsGain);
  voices.add(source);
  source.onended = () => {
    source.disconnect();
    volume.disconnect();
    if (output !== volume) output.disconnect();
    voices.delete(source);
  };
  source.start();
}

export function pauseRaceAudio(paused) {
  if (!race) return;
  race.paused = paused;
  if (paused) {
    for (const voice of voices) voice.stop();
    context.suspend().catch(() => {});
  } else context.resume().catch(() => {});
}

export function stopRaceAudio() {
  if (!race) return;
  if (race.music) {
    race.music.stop();
    race.music.disconnect();
  }
  race = undefined;
  for (const voice of voices) voice.stop();
}
