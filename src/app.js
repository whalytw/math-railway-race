import {setupQuestions, startQuestions, drawQuestions, stopQuizEffects} from './quiz-ui.js?v=22';
import {shakeAnswerCamera} from './answer-effects.js?v=20';
import {setupRaceAudio, prepareRaceAudio, startRaceAudio, playRaceSound, pauseRaceAudio, stopRaceAudio} from './race-audio.js?v=20';
import { COAST_SECONDS } from './quiz-race.js?v=18';
import * as THREE from 'three';
import { Airshow } from './airshow.js?v=22';
import { CameraDrone } from './camera-drone.js?v=22';
import { AssetStore, RailWorld, createAtmosphere, PALETTES } from './world.js?v=22';
import { createPhysics, stepPhysics, FIXED_STEP, DEPARTURE_COUNTDOWN, clamp, lerp, wrap, resolveBiomes, randomGenerator, nextStation, biomeMix, createElevationProfile, leverReference, leverForSpeed, RATED_POWER, CART_MASS, MAX_GRADE, MIN_VERTICAL_RADIUS } from './core.js?v=13.0.0';
import { riverProfile, riverPoint } from './route-features.js?v=13.0.0';
import { copyMotion, interpolateMotion, zoomView, anchorCamera, partitionViewports } from './presentation.js?v=13.0.0';
import { DENSITY_OPTIONS, SCENERY_VERSION } from './scenery-plan.js?v=13.0.0';
import { chooseDriver } from './drivers.js?v=13.0.0';
import { MixControls } from './mix-controls.js?v=13.0.0';
import { BIOME_COLORS, DEFAULT_MIX } from './biome-blend.js?v=13.0.0';
import { initRapier, RapierRailPhysics, RAPIER_VERSION } from './rapier-rail.js?v=13.0.0';
import { FLYOVER_RAIL_SEPARATION, turnIndexAt } from './circuit-route.js?v=13.0.0';
import { checkRaceBoundary, raceStandings } from './straight-race.js?v=22';

const $ = id => document.getElementById(id);
const GAME_VERSION = '22.0.0';
const flightSettings = {
  'camera-drone': 'cameraDrone',
  'drone-shadow': 'droneShadow',
  'airshow-plane': 'airshowPlane',
  'plane-shadow': 'planeShadow',
};
let renderer, scene, camera, atmosphere, manifest, store, world;
let mode = 'loading', physics = createPhysics(), cameraMode = 'chase', buildEpoch = 0;
let accumulator = 0, lastTime = 0, hudElapsed = 0, visibilityElapsed = 0, titleTime = 0;
let orbitYaw = 0, orbitPitch = 0.20, orbitDistance = 18;
let cabYaw = 0, cabPitch = 0;
let views = [], renderMotion = copyMotion(physics), turboOn = false, finishAnimationTime = 0;
let dragging = null, previewChangeTimer, notificationTimer;
let frameSamples = [], fpsHistory = [], metricTime = 0, metricFrames = 0, sessionConfig = null;
let longFrameCount = 0, countdownFinished = false;
let filteredFrameTime = 1 / 60;
let titleDriver = null, driverUIRequest = 0, mixControls, railPhysics, lastCollisionCount = 0, lastImpactNs = 0;
const desiredCamera = new THREE.Vector3(), lookTarget = new THREE.Vector3(), eyePosition = new THREE.Vector3(), viewDirection = new THREE.Vector3(), bufferSize = new THREE.Vector2();
const startButton = $('start-button'), loading = $('loading');
const minimap = $('minimap'), mapContext = minimap.getContext('2d');
const profileCanvas = $('elevation-profile'), profileContext = profileCanvas.getContext('2d'), slopeSample = {};
const menu = $('title-screen'), hud = $('game-hud');
const biomeNames = ['Forest', 'Hills', 'Pastoral', 'Desert', 'Rural', 'Lakeside', 'Snow', 'Volcano'];
const cartLabels = ['左車', '中車', '右車'], cartColours = ['#83d6e5', '#ffc487', '#f1a8a0'];
const percentFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const fleetFields = [], randomFleetDrivers = [];
const preferencesKey = 'rail-loop-lab:preferences:v19';
const previousGraphicsDefaults = {
  density: '2000',
  'view-distance': '550',
  resolution: '1',
  shadows: 'off',
  'scenery-shadows': 'off',
  'shadow-quality': 'near',
};
const mixLabel = row => `${manifest.biomes[row.biome].name} ${percentFormat.format(row.percent)}%`;
const mainPass = { calls: 0, triangles: 0 }, shadowPass = { drawCalls: 0, triangles: 0, maps: 0 };
const viewShadow = { drawCalls: 0, triangles: 0 };
let drawCallsBeforeShadow = 0, trianglesBeforeShadow = 0;
let shadowCasterViews = null, sharedShadowFrame = null, allowSharedShadows = true;
function countShadowPass(renderer) {
  const info = renderer.info.render;
  viewShadow.drawCalls = info.calls - drawCallsBeforeShadow;
  viewShadow.triangles = info.triangles - trianglesBeforeShadow;
}
function setupViews(playable) {
  views.forEach(view => view.engine?.dispose());
  views = world.carts.map((rig, index) => {
    const state = createPhysics(); state.distance = rig.departure;
    const engine = playable ? new RapierRailPhysics(rig.track, { state }) : null;
    const camera = new THREE.PerspectiveCamera(57, 1, 0.12, 18000);
    camera.layers.enable(index + 1);
    const drone = playable && world.config.cameraDrone ? new CameraDrone(world, index, camera) : null;
    return {
      rig, state, engine, previous: copyMotion(state), motion: copyMotion(state), snapped: false, finishTime: null,
      camera, drone,
      offset: new THREE.Vector3(), lookOffset: new THREE.Vector3(), smoothLook: new THREE.Vector3(),
      colour: world.carts.length === 1 ? '#c26d40' : cartColours[index], main: {}, shadows: {}, cartVisible: true,
    };
  });
  world.airshow = playable && world.config.airshowPlane ? new Airshow(world) : null;
  const main = views[Math.floor(views.length / 2)];
  physics = main.state; renderMotion = main.motion; camera = main.camera; railPhysics = main.engine;
}
function resetCameras() {
  for (const view of views) view.snapped = false;
  visibilityElapsed = 100;
}
function renderFrame(dt = 0, snap = false) {
  mainPass.calls = mainPass.triangles = shadowPass.drawCalls = shadowPass.triangles = 0;
  const info = renderer.info.render;
  const split = views.length > 1;
  const updateVisibility = visibilityElapsed > 0.18 || snap;
  // Update airframes and carts before the shared scene's single matrix update.
  for (const view of views) view.drone?.update(world, view);
  world.airshow?.draw(Math.max(0, physics.elapsed - DEPARTURE_COUNTDOWN + finishAnimationTime), renderer.domElement.height);
  scene.updateMatrixWorld();
  const now = performance.now();
  for (const view of views) {
    updateCamera(view, dt, snap);
    if (mode === 'running') shakeAnswerCamera(view, now);
  }
  const shadowsEnabled = world.config.shadows || world.config.sceneryShadows;
  const canShare = allowSharedShadows && shadowsEnabled && split && cameraMode === 'chase' && views.every(view => view.cartVisible);
  sharedShadowFrame = canShare
    ? atmosphere.sharedShadowFor(views.map(view => view.rig.root.position), renderer.capabilities.maxTextureSize)
    : null;
  atmosphere.setShadowFrame(sharedShadowFrame);
  renderer.shadowMap.autoUpdate = !sharedShadowFrame;
  renderer.shadowMap.needsUpdate = Boolean(sharedShadowFrame);
  shadowPass.maps = shadowsEnabled ? (sharedShadowFrame ? 1 : views.length) : 0;
  renderer.setScissorTest(split);
  for (const [index, view] of views.entries()) {
    const { x, y, width, height } = view.viewport;
    renderer.setViewport(x, y, width, height);
    if (split) renderer.setScissor(x, y, width, height);
    applyViewEnvironment(view, shadowsEnabled);
    world.updateTrackFilter(mode === 'running' ? view.motion.speed : 0, filteredFrameTime);
    if (split || updateVisibility) world.setVisibility(view.camera, world.config.viewDistance, cameraMode === 'overview');
    view.rig.root.visible = view.cartVisible;
    drawCallsBeforeShadow = info.calls;
    trianglesBeforeShadow = info.triangles;
    viewShadow.drawCalls = viewShadow.triangles = 0;
    shadowCasterViews = sharedShadowFrame && index === 0 ? views.map(peer => peer.camera) : null;
    try { renderer.render(scene, view.camera); }
    finally { shadowCasterViews = null; view.rig.root.visible = true; }
    mainPass.calls += info.calls; mainPass.triangles += info.triangles;
    shadowPass.drawCalls += viewShadow.drawCalls; shadowPass.triangles += viewShadow.triangles;
    view.main.calls = info.calls; view.main.triangles = info.triangles;
    view.shadows.drawCalls = viewShadow.drawCalls; view.shadows.triangles = viewShadow.triangles;
  }
  if (updateVisibility) visibilityElapsed = 0;
  if (split) renderer.setScissorTest(false);
}

function showError(error) {
  console.error(error); $('error-message').textContent = error.message || String(error); $('error-overlay').hidden = false;
  loading.hidden = true; startButton.disabled = false;
}
window.addEventListener('error', event => { if (event.error) showError(event.error); });
window.addEventListener('unhandledrejection', event => showError(event.reason));
$('retry-button').addEventListener('click', () => location.reload());

function notify(message) {
  $('notification').textContent = message; $('notification').hidden = false;
  clearTimeout(notificationTimer); notificationTimer = setTimeout(() => $('notification').hidden = true, 3500);
}
function loadingProgress(progress, message) {
  $('loading-progress').style.width = `${Math.max(2, progress * 100)}%`;
  $('loading-status').textContent = message;
}
function seedValue() {
  const entered = $('seed').value.trim();
  if (entered) return entered;
  const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0].toString(36).toUpperCase();
}
function selectedVehicle() { return document.querySelector('input[name="vehicle"]:checked')?.value || manifest.vehicles[0]; }
function selectedDriverChoice() { return $('driver-select').value || 'random'; }
function selectedFleet() {
  return fleetFields.map(({ vehicle, driver }, i) => ({
    vehicle: vehicle.value, driverChoice: driver.value,
    driver: driver.value === 'random'
      ? randomFleetDrivers[i] ?? (randomFleetDrivers[i] = chooseDriver('random', manifest.drivers))
      : chooseDriver(driver.value, manifest.drivers)
  }));
}
function populateFleet() {
  const defaults = ['Animal_CubePet_Bunny_001', 'Animal_CubePet_Fox_001', 'Animal_CubePet_Deer_001'];
  const defaultVehicles = [manifest.vehicles[1], manifest.vehicles[0], manifest.vehicles[2]];
  for (const [i, label] of cartLabels.entries()) {
    const card = document.createElement('fieldset'), legend = document.createElement('legend');
    card.className = 'fleet-choice'; card.style.setProperty('--cart-colour', cartColours[i]); legend.textContent = label;
    card.append(legend);
    function select(field, text, options, selected) {
      const wrapper = document.createElement('label'), control = document.createElement('select');
      wrapper.textContent = text; control.id = `fleet-${field}-${i}`; control.setAttribute('aria-label', label + text);
      for (const id of options) control.add(new Option(id === 'random' ? '隨機動物' : manifest.models[id].name, id));
      control.value = selected;
      control.addEventListener('change', () => { randomFleetDrivers[i] = null; schedulePreview(); });
      wrapper.append(control); card.append(wrapper);
      return control;
    }
    const vehicle = select('vehicle', '礦車', manifest.vehicles, defaultVehicles[i]);
    const driver = select('driver', '動物駕駛', ['random', ...manifest.drivers], defaults[i]);
    fleetFields.push({ vehicle, driver }); $('fleet-choices').append(card);
  }
}
const chooseStraight = () => $('route-mode').value === 'straight';
const chooseFleet = () => chooseStraight() || $('track-turns').value === '3';
function courseSettings() {
  const straight = chooseStraight();
  return { routeMode: straight ? 'straight' : 'loop', turns: straight ? 1 : Number($('track-turns').value),
    length: Number($('race-length').value) };
}
function courseLabel(config) {
  return config.routeMode === 'straight' ? `每道 ${config.length} km` : `${config.length} km · ${config.turns} 圈`;
}
function updateFleetControls() {
  const split = chooseFleet(), straight = chooseStraight();
  $('fleet-loadout').hidden = !split;
  $('single-loadout').hidden = split;
  $('ring-turns-field').hidden = straight;
  $('course-headline').textContent = straight ? '直線競速' : '環形競速';
  $('course-intro').textContent = '答對心算題，把剩餘作答秒數換成加速時間。';
  $('start-label').textContent = split ? '三車同時出發' : '單車出發';
}
function titleDriverId() {
  const choice = selectedDriverChoice();
  if (choice !== 'random') return chooseDriver(choice, manifest.drivers);
  if (!manifest.drivers.includes(titleDriver)) titleDriver = chooseDriver('random', manifest.drivers);
  return titleDriver;
}
function updateDriverCard(id, pending = false) {
  const info = manifest.models[id];
  $('driver-preview').src = info.preview; $('driver-preview').alt = info.name;
  $('driver-name').textContent = info.name;
  $('driver-status').textContent = pending ? '正在換駕駛…' : selectedDriverChoice() === 'random' ? '隨機選出，開始試車沿用這隻' : '已指定，站在礦車椅墊上';
  if (!pending) document.body.dataset.driver = id;
}
async function updateTitleDriver() {
  if (mode !== 'title' || !world || chooseFleet()) return;
  const request = ++driverUIRequest, activeWorld = world, id = titleDriverId();
  updateDriverCard(id, true);
  const applied = await activeWorld.setDriver(id);
  if (applied && request === driverUIRequest && mode === 'title' && world === activeWorld) {
    updateDriverCard(id); updatePreviewCaption(world.config);
  }
}
function formConfig() {
  const seed = seedValue();
  const routeFields = chooseStraight() ? ['race-length'] : ['race-length', 'track-turns'];
  for(const id of [...routeFields,'station-count','elevation-limit','density','view-distance','resolution','sleeper-spacing']) {
    if(!$(id).selectedOptions.length || !Number.isFinite(Number($(id).value))) throw new Error('設定值已失效，請重新選擇路線與畫面設定。');
  }
  const biomeMix = mixControls.value(), course = courseSettings();
  const fleet = chooseFleet() ? selectedFleet() : undefined;
  const leading = fleet?.[1] ?? { vehicle: selectedVehicle(), driver: titleDriverId(), driverChoice: selectedDriverChoice() };
  return { biomeMix, biomeA: biomeMix[0].biome, biomeB: biomeMix[1]?.biome || biomeMix[0].biome, ...course,
    stations: Number($('station-count').value), ...leading, fleet, playable: true,
    ...Object.fromEntries(Object.entries(flightSettings).map(([id, name]) => [name, $(id).checked])),
    density: Number($('density').value), viewDistance: Number($('view-distance').value), resolution: Number($('resolution').value),
    shadows: $('shadows').value === 'on', sceneryShadows: $('scenery-shadows').value === 'on', shadowQuality: $('shadow-quality').value,
    elevationLimit: Number($('elevation-limit').value),
    features: $('features').value === 'on', skyline: $('skyline').value === 'on', sleeperFilter: $('sleeper-filter').value === 'on', sleeperSpacing: Number($('sleeper-spacing').value), seed };
}
function savePreferences() {
  try {
    const values = Object.fromEntries(Object.keys(flightSettings).map(id => [id, $(id).checked]));
    for (const id of ['route-mode', 'race-length', 'track-turns', 'station-count', 'elevation-limit', 'density', 'view-distance', 'resolution', 'shadows', 'scenery-shadows', 'shadow-quality', 'features', 'skyline', 'sleeper-filter', 'sleeper-spacing', 'seed', 'driver-select']) values[id] = $(id).value;
    for (const { vehicle, driver } of fleetFields) { values[vehicle.id] = vehicle.value; values[driver.id] = driver.value; }
    values.vehicle = selectedVehicle(); values.biomeMix = mixControls.value(); localStorage.setItem(preferencesKey, JSON.stringify(values));
  } catch { /* Private browsing may disable local storage. */ }
}
function restorePreferences() {
  try {
    const current = localStorage.getItem(preferencesKey);
    const values = JSON.parse(current || localStorage.getItem('rail-loop-lab:preferences:v13') ||
      localStorage.getItem('rail-loop-lab:preferences:v11') || localStorage.getItem('rail-loop-lab:preferences:v10') ||
      localStorage.getItem('rail-loop-lab:preferences:v8') || '{}');
    if (!current && Object.entries(previousGraphicsDefaults).every(([id, value]) => values[id] === value)) {
      for (const id of Object.keys(previousGraphicsDefaults)) delete values[id];
    }
    for (const [id, value] of Object.entries(values)) {
      if (id === 'biomeMix') mixControls.set(value);
      else if (Object.hasOwn(flightSettings, id) && typeof value === 'boolean') $(id).checked = value;
      else if (id === 'vehicle') { const input = [...document.querySelectorAll('input[name="vehicle"]')].find(el => el.value === value); if (input) input.checked = true; }
      else if ($(id) && (id === 'seed' || [...$(id).options].some(option => option.value === value))) $(id).value = value;
    }
  } catch { /* Preferences are optional. */ }
}
function populateForm() {
  $('density').replaceChildren(...DENSITY_OPTIONS.map(count => {
    const option = document.createElement('option'); option.value = String(count);
    const label = count === 1000 ? '入門' : count <= 3500 ? '輕量' : count <= 5000 ? '中量' : count <= 10000 ? '標準' : count <= 16000 ? '進階' : count <= 30000 ? '加壓' : '極限';
    option.textContent = `${label} · ${count.toLocaleString()}`; option.selected = count === DENSITY_OPTIONS[0]; return option;
  }));
  mixControls = new MixControls($('mix-slots'), Object.fromEntries(biomeNames.map(id=>[id,manifest.biomes[id]])), schedulePreview);
  for (let km = 3; km <= 7; km++) {
    const option = document.createElement('option'); option.value = String(km); option.textContent = `${km} 公里`; option.selected = km === 5; $('race-length').append(option);
  }
  for (let height = 0; height <= 500; height += 25) {
    const option = document.createElement('option'); option.value = String(height); option.textContent = height === 0 ? '0 m · 平坦' : `${height} 公尺`;
    option.selected = height === 75; $('elevation-limit').append(option);
  }
  for (const [index, id] of manifest.vehicles.entries()) {
    const label = document.createElement('label'); label.className = 'vehicle-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'vehicle'; input.value = id; input.checked = index === 0;
    const image = document.createElement('img'); image.src = manifest.models[id].preview || `assets/previews/${id}.png`; image.alt = ''; image.loading = 'eager';
    const text = document.createElement('span'); text.textContent = manifest.models[id].name;
    label.append(input, image, text); $('vehicle-choices').append(label);
    input.addEventListener('change', schedulePreview);
  }
  for (const id of manifest.drivers) {
    const option = document.createElement('option'); option.value = id; option.textContent = manifest.models[id].name;
    $('driver-select').append(option);
  }
  populateFleet(); restorePreferences(); updateFleetControls(); updatePresetHint(); updateReliefHint(); buildLeverScale();
  $('driver-select').addEventListener('change', () => {
    if (selectedDriverChoice() === 'random') titleDriver = null;
    updateTitleDriver().catch(error => notify(error.message));
  });
  $('random-driver').addEventListener('click', () => {
    const previous = world?.config.driver || titleDriver;
    $('driver-select').value = 'random'; titleDriver = chooseDriver('random', manifest.drivers, Math.random, previous);
    updateTitleDriver().catch(error => notify(error.message));
  });
  for (const id of ['route-mode', 'race-length', 'track-turns', 'station-count', 'elevation-limit']) $(id).addEventListener('change', () => { updateFleetControls(); updateReliefHint(); schedulePreview(); });
  for (const id of ['features', 'skyline', 'seed']) $(id).addEventListener('change', schedulePreview);
  $('density').addEventListener('change', updatePresetHint);
  $('randomize').addEventListener('click', () => mixControls.randomize(false));
  $('randomize-ratios').addEventListener('click', () => mixControls.randomize(true));
}
function updatePresetHint() { $('preset-hint').textContent = `${$('density').selectedOptions[0].textContent.split(' · ')[0]} / ${Number($('density').value).toLocaleString()} 物件`; }
function updateReliefHint() {
  const field = $('elevation-limit'), { routeMode, turns, length } = courseSettings(), requested = Number(field.value);
  field.options[0].textContent = turns > 1 ? '0 m · 僅跨線坡' : '0 m · 平坦';
  if (routeMode === 'straight') {
    $('relief-hint').textContent = `競賽 ${length} 公里，每道實鋪 ${length+1} 公里。縱坡 ≤25‰，到達終點即記錄用時。`;
    return;
  }
  if (turns > 1) {
    $('relief-hint').textContent = `全線 ${length+1} 公里（競賽 ${length} 公里）繞 ${turns} 圈。高架交會保留 ${FLYOVER_RAIL_SEPARATION} m 軌面高差，縱坡 ≤25‰。`;
    return;
  }
  if (!requested) { $('relief-hint').textContent = '軌道完全平坦；沿線山丘景觀仍保留。'; return; }
  const profile = createElevationProfile((length + 1) * 1000, requested, Number($('station-count').value));
  $('relief-hint').textContent = `縱坡 ≤25‰、站區水平；預估實際高差 ${profile.range.toFixed(1)} m${profile.range < requested - 0.1 ? '（依路長限縮）' : ''}。`;
}
function buildLeverScale() {
  for (const kmh of [120, 90, 60, 30, 0, -15, -30]) {
    const u = leverForSpeed(kmh), reference = leverReference(u);
    const left = document.createElement('span'), right = document.createElement('span');
    left.className = `speed-tick${kmh === 0 ? ' neutral' : ''}`; right.className = `power-tick${kmh === 0 ? ' neutral' : ''}`;
    left.dataset.lever = right.dataset.lever = String(u);
    left.textContent = kmh === 0 ? 'N / 0' : kmh < 0 ? `−${-kmh}` : String(kmh);
    right.textContent = `${reference.powerPercent < 10 ? reference.powerPercent.toFixed(1) : reference.powerPercent.toFixed(0)}%`;
    $('lever-speed-ticks').append(left); $('lever-power-ticks').append(right);
  }
}
function schedulePreview() {
  if (mode !== 'title') return;
  clearTimeout(previewChangeTimer);
  previewChangeTimer = setTimeout(async () => {
    if (mode !== 'title') return;
    try {
      const config = previewConfig();
      const loaded = await loadWorld(config, false);
      if (loaded && mode === 'title') updatePreviewCaption(world.config);
    } catch (error) { notify(error.message); }
  }, 300);
}
function previewConfig() {
  const biomeMix = mixControls.value();
  const selection = chooseFleet() ? selectedFleet()[1] : { vehicle: selectedVehicle(), driver: titleDriverId(), driverChoice: selectedDriverChoice() };
  return { biomeMix, biomeA: biomeMix[0].biome, biomeB: biomeMix[1]?.biome || biomeMix[0].biome, ...courseSettings(),
    stations: Number($('station-count').value), elevationLimit: Number($('elevation-limit').value),
    ...selection, density: DENSITY_OPTIONS[0],
    features: $('features').value === 'on', skyline: $('skyline').value === 'on', sleeperFilter: true, sleeperSpacing: 0.75, viewDistance: 300, resolution: 0.75, shadows: false, sceneryShadows: false, seed: $('seed').value.trim() || 'LOOP-PREVIEW' };
}

function updatePreviewCaption(config) {
  $('preview-caption').textContent = `${courseLabel(config)} · ${config.biomeMix.map(mixLabel).join(' / ')} · ${manifest.models[config.driver]?.name || ''}駕駛`;
  updateDriverCard(config.driver);
}

async function loadWorld(config, showLoading = true) {
  const epoch = ++buildEpoch;
  if (showLoading) { loading.hidden = false; loadingProgress(0, '開始建立新場景…'); }
  const nextWorld = new RailWorld(scene, store, config);
  nextWorld.group.visible = false;
  try {
    await nextWorld.build((p, text) => { if (showLoading && epoch === buildEpoch) loadingProgress(p, text); });
    if (epoch !== buildEpoch) { nextWorld.dispose(); return false; }
    if (world) world.dispose(); world = nextWorld;
    setupViews(config.playable);
    world.group.visible = true;
    world.group.traverse(object => { if (object.isMesh && object.castShadow) object.onAfterShadow = countShadowPass; });
    renderer.renderLists.dispose();
    renderer.shadowMap.enabled = config.shadows || config.sceneryShadows;
    atmosphere.setShadowProfile(world.shadowProfile);
    atmosphere.setTerrainHaze(world.skyColor());
    resetCameras(); titleTime = 0; resize();
    return true;
  } catch (error) { nextWorld.dispose(); throw error; }
}

async function startGame(event) {
  event.preventDefault();
  if (mode !== 'title') return;
  let config;
  try { config = formConfig(); } catch (error) { $('form-error').hidden = false; $('form-error').textContent = error.message; return; }
  prepareRaceAudio();
  $('form-error').hidden = true; startButton.disabled = true; clearTimeout(previewChangeTimer); savePreferences();
  mode = 'loading'; $('loading-title').textContent = `正在鋪設軌道 · ${courseLabel(config)}`;
  try {
    const loaded = await loadWorld(config, true); if (!loaded) return;
    sessionConfig = config;
    $('route-label').textContent = courseLabel(config);
    $('station-toast-label').textContent = world.route.lanes ? '直線競速' : '沿線下一站';
    $('biome-label').textContent = config.biomeMix.map(mixLabel).join(' / ');
    $('mix-legend').replaceChildren(...config.biomeMix.map(row => {
      const span = document.createElement('span'), dot = document.createElement('i');
      span.className = 'mix-legend'; dot.className = 'mix-dot'; dot.style.background = BIOME_COLORS[row.biome];
      span.append(dot, mixLabel(row)); return span;
    }));
    $('rapier-version').textContent = RAPIER_VERSION; $('clear-bumper').hidden = true; $('bumper-status').textContent = '沿軌受力、彈簧與碰撞求解';
    const nature=world.sceneryStats.naturePack;
    $('nature-count').textContent = `新模型 ${Object.keys(nature.modelCounts).length} / 63 款 · 依地形與水岸生境配置`;
    $('instances').textContent = world.sceneryCount.toLocaleString();
    $('model-variety').textContent = world.sceneryStats.uniqueModels.toLocaleString();
    const elevation = world.route.elevation;
    const elevationLabel = config.turns > 1 && !config.elevationLimit ? '含跨線' : `上限 ${config.elevationLimit} m`;
    $('relief-summary').textContent = `實際高差 ${elevation.range.toFixed(1)} m / ${elevationLabel}`;
    beginRound();
  } catch (error) { mode = 'title'; stopRaceAudio(); showError(error); }
  finally { startButton.disabled = false; }
}

function beginRound() {
  lastCollisionCount = 0; lastImpactNs = 0; accumulator = 0; lastTime = 0;
  fpsHistory = []; frameSamples = []; metricTime = 0; metricFrames = 0; longFrameCount = 0;
  hudElapsed = 0; countdownFinished = false; finishAnimationTime = 0;
  orbitYaw = 0; orbitPitch = 0.20; orbitDistance = 18; cabYaw = 0; cabPitch = 0;
  menu.hidden = true; hud.hidden = false; loading.hidden = true;
  $('pause-overlay').hidden = true; $('race-results').hidden = true; $('notification').hidden = true;
  $('pause-label').textContent = '暫停'; $('pause-icon').textContent = 'Ⅱ';
  setDrivingEnabled(true);
  mode = 'running';
  document.body.dataset.state = mode;
  document.body.dataset.ready = 'true';
  document.body.dataset.driver = sessionConfig.driver;
  startQuestions(views);
  setTurbo(false); setCamera('chase'); resize();
  updateCartMotion(1); updateHUD(); renderFrame(0, true);
  startRaceAudio();
}

function replayRound() {
  if (mode !== 'finished') return;
  prepareRaceAudio();
  for (const view of views) {
    const {state, rig, engine} = view;
    Object.assign(state, createPhysics(), {distance: rig.departure});
    engine.reset(state);
    copyMotion(state, view.previous);
    view.finishTime = null;
    if (rig.smile) {
      rig.smile.visible = false;
      rig.driver.position.y = 0;
    }
    rig.turbo?.reset();
    view.drone?.reset();
  }
  world.airshow?.reset();
  world.showTestBumper(null);
  $('clear-bumper').hidden = true;
  beginRound();
}

function pauseGame(force) {
  if (!['running', 'paused'].includes(mode)) return;
  const paused = force ?? mode === 'running';
  mode = paused ? 'paused' : 'running'; lastTime = 0;
  pauseRaceAudio(paused);
  if (paused) {
    stopQuizEffects(views);
    world.updateEnvironment(0, 0, 1 / 60);
  }
  $('pause-overlay').hidden = !paused; $('countdown').hidden = paused || physics.countdown <= 0;
  $('pause-label').textContent = paused ? '繼續' : '暫停'; $('pause-icon').textContent = paused ? '▷' : 'Ⅱ';
  document.body.dataset.state = mode;
}
async function returnToTitle() {
  if (!['running', 'paused', 'finished'].includes(mode)) return;
  stopRaceAudio(); stopQuizEffects(views);
  mode = 'loading'; $('scene').style.height='100%'; hud.hidden = true; $('countdown').hidden = true; $('pause-overlay').hidden = true;
  $('loading-title').textContent = '返回軌道試驗場';
  if (selectedDriverChoice() === 'random') titleDriver = null;
  try {
    const config = previewConfig(); await loadWorld(config, true);
    accumulator = 0; mode = 'title'; menu.hidden = false; loading.hidden = true; lastTime = 0;
    orbitYaw = 0; orbitPitch = 0.20; orbitDistance = 18; cabYaw = 0; cabPitch = 0; cameraMode = 'chase'; resetCameras();
    updatePreviewCaption(config); document.body.dataset.state = 'title'; resize();
  } catch (error) { showError(error); }
}

function placeBumper() {
  if(mode!=='running' || views.find(view => view.state === physics).finishTime !== null)return;
  const direction=physics.speed<-.1||Math.abs(physics.speed)<.1&&physics.throttle<0?-1:1;
  const distance=physics.distance+direction*80;
  if (world.route.lanes && (distance <= 0 || distance >= world.route.length)) {
    notify('這個方向的賽道剩餘不足 80 公尺。');
    return;
  }
  railPhysics.placeBumper(distance);world.showTestBumper(distance);
  world.testBumper.onAfterShadow = countShadowPass;
  lastImpactNs=0;$('clear-bumper').hidden=false;notify(`已在${direction>0?'前方':'倒車方向'} 80 m 放置測試擋車器。`);
}
function clearBumper() { if(!railPhysics)return;railPhysics.clearBumper();world.showTestBumper(null);$('clear-bumper').hidden=true;$('bumper-status').textContent='沿軌受力、彈簧與碰撞求解'; }

function setTurbo(enabled) {
  turboOn = enabled;
  for (const view of views) view.rig.turbo?.setEnabled(enabled && view.finishTime === null, view.state.elapsed);
  $('turbo-toggle').setAttribute('aria-pressed', String(enabled));
  $('turbo-status').textContent = enabled ? '開啟' : '關閉';
}
function labelViews() {
  const status = $('fleet-status');
  status.hidden = views.length === 1;
  hud.dataset.split = String(!status.hidden);
  status.replaceChildren();
  if (status.hidden) return;
  for (const [i, view] of views.entries()) {
    const pane = document.createElement('div'), reading = document.createElement('div');
    const label = document.createElement('b'), speed = document.createElement('strong');
    pane.className = 'fleet-pane'; reading.className = 'fleet-reading';
    pane.style.setProperty('--cart-colour', view.colour);
    label.textContent = cartLabels[i]; speed.textContent = '0';
    reading.title = `${manifest.models[view.rig.vehicle].name} · ${view.rig.driver.userData.driver.name}`;
    reading.append(label, speed, 'km/h'); pane.append(reading); status.append(pane);
    view.speedLabel = speed;
    if (world.route.lanes) {
      view.progressLabel = document.createElement('span'); view.progressLabel.className = 'race-progress';
      reading.append(view.progressLabel);
    }
  }
}

function setDrivingEnabled(enabled) {
  for (const id of ['pause-button', 'lever-handle', 'neutral-button', 'suspension-test', 'bumper-test']) $(id).disabled = !enabled;
}

function showRaceResults() {
  mode = 'finished'; finishAnimationTime = 0;
  stopRaceAudio(); stopQuizEffects(views);
  setTurbo(false); setThrottle(0); setDrivingEnabled(false);
  $('pause-overlay').hidden = true;
  $('notification').hidden = true;
  $('race-standings').replaceChildren(...raceStandings(views.map(view => view.finishTime)).map(({ rank, lane, time }) => {
    const row = document.createElement('li');
    const place = document.createElement('span'), name = document.createElement('span'), seconds = document.createElement('strong');
    place.textContent = `第 ${rank}`; name.textContent = ['一號車','二號車','三號車'][lane] + ' · 答對 ' + views[lane].quiz.correct + ' 題'; seconds.textContent = `${time.toFixed(3)} 秒`;
    row.append(place, name, seconds);
    return row;
  }));
  $('race-results').hidden = false;
  document.body.dataset.state = mode;
}

function setThrottle(value) {
  value = clamp(value, -1, 1); if (Math.abs(value) < 0.015) value = 0;
  for (const kmh of [120, 90, 60, 30, 0, -15, -30]) { const detent = leverForSpeed(kmh); if (Math.abs(value - detent) < 0.012) { value = detent; break; } }
  physics.throttle = value;
  for (const view of views) view.state.throttle = value;
  const reference = leverReference(value);
  const top = 15 + (1 - value) * 0.5 * ($('lever-track').clientHeight - 30);
  $('lever-handle').style.top = `${top}px`;
  $('lever-handle').setAttribute('aria-valuenow', String(Math.round(value * 100)));
  $('lever-handle').setAttribute('aria-valuetext', value ? `平地速度 ${reference.kmh.toFixed(0)} km/h，可用馬力 ${reference.powerPercent.toFixed(1)}%` : '中立滑行');
  $('throttle-value').textContent = value ? `${reference.kmh < 0 ? '−' : ''}${Math.abs(reference.kmh).toFixed(0)} km/h` : 'N · 滑行';
  $('power-value').textContent = `${reference.powerPercent < 10 ? reference.powerPercent.toFixed(1) : reference.powerPercent.toFixed(0)}%`;
  document.querySelectorAll('[data-lever]').forEach(tick => { tick.style.top = `${15 + (1 - Number(tick.dataset.lever)) * 0.5 * ($('lever-track').clientHeight - 30)}px`; });
  const arm = document.querySelector('.lever-arm');
  arm.style.top = `${Math.min(top, $('lever-track').clientHeight * 0.5)}px`;
  arm.style.height = `${Math.abs(top - $('lever-track').clientHeight * 0.5)}px`;
}
function leverFromPointer(event) {
  const rect = $('lever-track').getBoundingClientRect();
  const amount = 1 - (event.clientY - rect.top - 15) / (rect.height - 30) * 2;
  setThrottle(amount);
}
function installControls() {
  $('setup-form').addEventListener('submit', startGame);
  $('again').addEventListener('click', replayRound);
  $('results-title').addEventListener('click', returnToTitle);
  $('pause-button').addEventListener('click', () => pauseGame()); $('resume-button').addEventListener('click', () => pauseGame(false));
  $('title-button').addEventListener('click', returnToTitle); $('neutral-button').addEventListener('click', () => setThrottle(0));
  $('turbo-toggle').addEventListener('click', () => {
    if (mode === 'running' && physics.countdown <= 0) setTurbo(!turboOn);
  });
  const track = $('lever-track');
  track.addEventListener('pointerdown', event => { if (mode === 'finished') return; event.preventDefault(); track.setPointerCapture(event.pointerId); dragging = { type: 'lever', pointerId: event.pointerId }; leverFromPointer(event); });
  track.addEventListener('pointermove', event => { if (mode !== 'finished' && dragging?.type === 'lever') leverFromPointer(event); });
  track.addEventListener('pointerup', () => dragging = null); track.addEventListener('pointercancel', () => dragging = null);
  track.addEventListener('lostpointercapture', () => dragging = null);
  $('lever-handle').addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); setThrottle(1); }
    if (event.key === 'End') { event.preventDefault(); setThrottle(-1); }
  });
  window.addEventListener('keydown', event => {
    if (!['running', 'paused'].includes(mode) || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    
    
    
    if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); if (!event.repeat) pauseGame(); }
  });
  document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => setCamera(button.dataset.camera)));
  $('preview-camera').addEventListener('click', () => { cameraMode = cameraMode === 'overview' ? 'chase' : 'overview'; resetCameras(); });
  const canvas = $('scene');
  canvas.addEventListener('pointerdown', event => { if (mode !== 'title') return; canvas.setPointerCapture(event.pointerId); dragging = { type: 'camera', x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointermove', event => {
    if (mode !== 'title' || dragging?.type !== 'camera') return;
    if (cameraMode === 'cab') {
      cabYaw += (event.clientX - dragging.x) * 0.005;
      cabPitch = clamp(cabPitch - (event.clientY - dragging.y) * 0.004, -1.25, 1.25);
    } else {
      orbitYaw -= (event.clientX - dragging.x) * 0.006;
      orbitPitch = clamp(orbitPitch + (event.clientY - dragging.y) * 0.004, -0.02, 1.05);
    }
    dragging.x = event.clientX; dragging.y = event.clientY;
  });
  canvas.addEventListener('pointerup', () => dragging = null); canvas.addEventListener('pointercancel', () => dragging = null); canvas.addEventListener('lostpointercapture', () => dragging = null);
  canvas.addEventListener('wheel', event => {
    if (mode !== 'title' || cameraMode === 'overview') return;
    event.preventDefault();
    const next = zoomView(cameraMode, orbitDistance, event.deltaY, mode === 'title');
    orbitDistance = next.distance;
    if (next.mode !== cameraMode) {
      if (next.mode === 'cab') { cabYaw = 0; cabPitch = 0; }
      setCamera(next.mode, false);
    }
  }, { passive: false });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && mode === 'running') { pauseGame(true); notify('分頁已切換，行駛與計時自動暫停。'); }
    lastTime = 0; metricTime = 0; metricFrames = 0;
  });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('目前的瀏覽器視窗不支援全螢幕。'); }
  });
  $('export-report').addEventListener('click', exportReport);
  $('suspension-test').addEventListener('click', () => { if(mode!=='running')return;railPhysics.applySuspensionImpulse(100);notify('已施加 100 N·s 垂直衝量，觀察車體回穩。'); });
  $('bumper-test').addEventListener('click', placeBumper);
  $('clear-bumper').addEventListener('click', clearBumper);
  window.addEventListener('resize', resize);
  $('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); if (mode === 'running') pauseGame(true); showError(new Error('GPU 渲染內容已中斷。請降低物件數、解析度或陰影設定後重新載入。')); });
}
function setCamera(next, snap = true) {
  if (mode !== 'title' && next !== 'chase') return;
  cameraMode = next; if (snap) resetCameras(); visibilityElapsed = 100;
  if (next === 'cab') { orbitDistance = 0; if (snap) { cabYaw = 0; cabPitch = 0; } }
  else if (next === 'chase' && snap && orbitDistance < 7) orbitDistance = 18;
  document.querySelectorAll('[data-camera]').forEach(button => button.classList.toggle('active', button.dataset.camera === next));
  $('camera-hint').textContent = next === 'cab' ? '拖曳自由轉頭 · 滾輪向下拉遠' : next === 'chase' ? '拖曳旋轉 · 滾輪最近進入駕駛' : '拖曳旋轉全景';
  if (mode === 'paused' && world) renderFrame(0, true);
}
function resize() {
  if (!renderer || !views.length) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, world.config.resolution);
  if (pixelRatio !== renderer.getPixelRatio()) renderer.setPixelRatio(pixelRatio);
  const quizHeight = ['running','paused','finished'].includes(mode) ? $('quiz-grid').offsetHeight : 0;
  const visibleHeight = Math.max(120, innerHeight - quizHeight);
  renderer.setSize(innerWidth, visibleHeight, false); $('scene').style.height = visibleHeight+'px';
  const panelWidth = mode === 'title' && innerWidth > 760 ? document.querySelector('.setup-panel').getBoundingClientRect().right : 0;
  renderer.getDrawingBufferSize(bufferSize);
  const viewports = partitionViewports(bufferSize.x, bufferSize.y, renderer.getPixelRatio(), views.length, panelWidth);
  for (const [i, view] of views.entries()) {
    view.viewport = viewports[i];
    view.camera.aspect = view.viewport.width / view.viewport.height;
    view.camera.updateProjectionMatrix();
  }
  
}
function updateCamera(view, dt, snap = false) {
  const { camera, rig, motion, offset, lookOffset, smoothLook } = view;
  const p = rig.sample, cart = rig.root.position, distanceAlong = motion.distance;
  const playing = mode === 'running' || mode === 'paused';
  const structure = playing ? world.structureAt(distanceAlong, 17, rig) : null;
  let targetFov;
  eyePosition.set(cart.x + p.tx3 * 0.35 + p.upX * 1.60, cart.y + p.ty * 0.35 + p.upY * 1.60, cart.z + p.tz3 * 0.35 + p.upZ * 1.60);
  if (cameraMode === 'overview') {
    const d = world.route.squareSize, angle = orbitYaw * 0.25;
    if (views.length > 1) {
      desiredCamera.set(Math.sin(angle + p.yaw) * d * 0.32, d * 0.59, Math.cos(angle + p.yaw) * d * 0.32).add(cart);
      lookTarget.copy(cart);
    } else {
      const midHeight = world.route.elevation.range * 0.5;
      desiredCamera.set(Math.sin(angle) * d * 0.35, d * 1.18 + midHeight, d * 0.70);
      lookTarget.set(0, midHeight - 30, 0);
    }
    targetFov = 53; camera.far = 45000;
  } else if (cameraMode === 'cab') {
    const sign = motion.speed < -0.4 ? -1 : 1, horizontal = Math.cos(cabPitch);
    viewDirection.set(sign * Math.sin(cabYaw) * horizontal, Math.sin(cabPitch), sign * Math.cos(cabYaw) * horizontal).applyQuaternion(rig.root.quaternion);
    desiredCamera.copy(eyePosition); lookTarget.copy(eyePosition).addScaledVector(viewDirection, 45);
    targetFov = 72; camera.far = 18000;
  } else {
    const arrival = view.quiz?.finished != null && mode !== 'title';
    const turn = arrival ? THREE.MathUtils.smoothstep(view.quiz.coastTime, 0, 4) : 0;
    const angle = p.yaw + Math.PI * turn + orbitYaw + (mode === 'title' ? 0.58 : 0);
    const distance = lerp(orbitDistance, 5.8, turn);
    desiredCamera.set(cart.x - Math.sin(angle) * distance, cart.y + lerp(3.6 + Math.sin(orbitPitch) * distance * 0.8, 2.7, turn), cart.z - Math.cos(angle) * distance);
    const ahead = rig.track.sample(distanceAlong + 8);
    lookTarget.set(ahead.x, ahead.y + 1.4, ahead.z);
    if (arrival) lookTarget.lerp(eyePosition, turn);
    // Keep the selected animal and cart centred while inspecting them on the title screen.
    if (mode === 'title') lookTarget.set(cart.x, cart.y + 1.55, cart.z);
    const terrainY = world.heightAt(desiredCamera.x, desiredCamera.z); desiredCamera.y = Math.max(desiredCamera.y, terrainY + 2);
    targetFov = 57 + Math.min(6, Math.abs(motion.speed) * 0.13); camera.far = 18000;
    if (structure && !arrival) {
      const behind = rig.track.sample(distanceAlong - Math.min(7.5, distance)), ahead = rig.track.sample(distanceAlong + 5);
      const sideways = Math.sin(orbitYaw) * 0.62;
      desiredCamera.set(behind.x + behind.nx * sideways, behind.y + 2.28 + Math.sin(orbitPitch) * 0.38, behind.z + behind.nz * sideways);
      lookTarget.set(ahead.x, ahead.y + 1.3, ahead.z); targetFov = 64;
    }
    // Smoothly travel the last seven metres into the driver's eye position.
    const eyeBlend = arrival ? 0 : 1 - THREE.MathUtils.smoothstep(distance, 0, 7);
    desiredCamera.lerp(eyePosition, eyeBlend);
    viewDirection.set(p.tx3, p.ty, p.tz3);
    lookTarget.lerp(viewDirection.multiplyScalar(45).add(eyePosition), eyeBlend); targetFov = lerp(targetFov, 72, eyeBlend);
  }
  const reset = snap || !view.snapped, blend = reset ? 1 : 1 - Math.exp(-dt * 12);
  if (cameraMode === 'overview') {
    camera.position.lerp(desiredCamera, blend); smoothLook.lerp(lookTarget, blend); camera.lookAt(smoothLook);
  } else anchorCamera(camera, cart, desiredCamera, lookTarget, offset, lookOffset, dt, reset, cameraMode === 'cab' ? 30 : 10);
  camera.fov = lerp(camera.fov, targetFov, blend); camera.updateProjectionMatrix();
  view.snapped = true;
  view.cartVisible = cameraMode !== 'cab' && !(cameraMode === 'chase' && camera.position.distanceTo(cart) < 4.2);
}
function applyViewEnvironment(view, shadowsEnabled) {
  const { camera, rig, motion } = view;
  const overview = cameraMode === 'overview', far = world.config.viewDistance;
  const playing = mode === 'running' || mode === 'paused';
  scene.fog.near = overview ? world.route.squareSize * 2.5 : far * 0.36;
  scene.fog.far = overview ? world.route.squareSize * 6 : far;
  const insideTunnel = playing && !overview ? world.tunnelFactor(motion.distance - (cameraMode === 'cab' ? 0 : Math.min(7.5, orbitDistance)), rig) : 0;
  scene.fog.near = lerp(scene.fog.near, 3, insideTunnel); scene.fog.far = lerp(scene.fog.far, 68, insideTunnel);
  atmosphere.update(camera, rig.root.position, shadowsEnabled, insideTunnel);
  atmosphere.sun.updateMatrixWorld();
  atmosphere.sky.updateMatrixWorld();
}
function updateHUD() {
  drawQuestions(views);
  $('countdown').hidden = mode === 'paused' || physics.countdown <= 0;
  if (physics.countdown > 0) $('countdown').querySelector('strong').textContent = Math.ceil(physics.countdown);
  else if (mode === 'running' && !countdownFinished) {
    countdownFinished = true;
    playRaceSound('depart');
  }
}
function drawMinimap() {
  if (!world) return;
  if (world.route.lanes) {
    drawStraightMinimap();
    drawElevationProfile();
    return;
  }
  const ctx = mapContext, w = minimap.width, h = minimap.height, d = world.route.squareSize;
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min((w - 30) / (2 * d), (h - 20) / d);
  const mx = x => w / 2 + x * scale, mz = z => h / 2 + z * scale;
  // Cache the same continuous spatial biome field used by terrain and plants.
  if (!world.minimapBase) {
    const base=document.createElement('canvas');base.width=w;base.height=h;const b=base.getContext('2d');
    for(let py=Math.floor(mz(-d/2));py<mz(d/2);py+=4)for(let px=Math.floor(mx(-d));px<mx(d);px+=4){const weights=world.weightsAt((px-w/2)/scale,(py-h/2)/scale);let r=0,g=0,bl=0;for(const row of world.config.biomeMix){const color=BIOME_COLORS[row.biome],v=weights[row.biome]||0;r+=parseInt(color.slice(1,3),16)*v;g+=parseInt(color.slice(3,5),16)*v;bl+=parseInt(color.slice(5,7),16)*v;}b.fillStyle=`rgb(${Math.round(lerp(r,241,.58))},${Math.round(lerp(g,242,.58))},${Math.round(lerp(bl,227,.58))})`;b.fillRect(px,py,4,4);}
    world.minimapBase=base;
  }
  ctx.save();ctx.beginPath();ctx.roundRect(mx(-d),mz(-d/2),2*d*scale,d*scale,12);ctx.clip();ctx.drawImage(world.minimapBase,0,0);ctx.restore();
  if(world.lake){ctx.beginPath();ctx.ellipse(mx(world.lake.x),mz(world.lake.z),world.lake.radius*scale,world.lake.radius*world.lake.depthScale*scale,0,0,Math.PI*2);ctx.fillStyle='#77aeb7';ctx.fill();}
  const bridge = world.features.bridge;
  if (bridge) {
    ctx.beginPath();
    const rows = Math.ceil((bridge.river.end - bridge.river.start) / 5);
    for (const side of [-1, 1]) for (let j = 0; j <= rows; j++) {
      const i = side < 0 ? j : rows - j, b = lerp(bridge.river.start, bridge.river.end, i / rows);
      const p = riverPoint(bridge, b, side * Math.max(10, riverProfile(bridge, b).halfWidth));
      if (side < 0 && j === 0) ctx.moveTo(mx(p.x), mz(p.z)); else ctx.lineTo(mx(p.x), mz(p.z));
    }
    ctx.closePath(); ctx.fillStyle = '#77aeb7'; ctx.fill();
  }
  for (const farm of world.sceneryPlan?.farms || []) {
    ctx.save(); ctx.translate(mx(farm.x), mz(farm.z)); ctx.rotate(-farm.yaw);
    ctx.fillStyle = '#b99e63'; ctx.fillRect(-farm.halfWidth * scale, -farm.halfLength * scale, farm.halfWidth * 2 * scale, farm.halfLength * 2 * scale); ctx.restore();
  }
  const route = world.route, occupiedTurns = new Set(views.map(view => turnIndexAt(route, view.motion.distance)));
  if (!world.minimapTracks) world.minimapTracks = route.turnStarts.map((start, turn) => {
    const end = route.turnStarts[turn + 1] ?? route.length, samples = Math.ceil((end - start) / 20);
    const outline = new Path2D(), sections = new Map();
    let a = route.sample(start);
    outline.moveTo(mx(a.x), mz(a.z));
    for (let i = 0; i < samples; i++) {
      const b = route.sample(lerp(start, end, (i + 1) / samples));
      const weights = world.biomeLayout.weightsAtDistance(lerp(start, end, (i + 0.5) / samples));
      const color = BIOME_COLORS[world.biomeLayout.dominant(weights)];
      if (!sections.has(color)) sections.set(color, new Path2D());
      const section = sections.get(color);
      section.moveTo(mx(a.x), mz(a.z)); section.lineTo(mx(b.x), mz(b.z));
      outline.lineTo(mx(b.x), mz(b.z));
      a = b;
    }
    return { outline, sections };
  });
  for (const [turn, track] of world.minimapTracks.entries()) {
    const active = occupiedTurns.has(turn);
    ctx.strokeStyle = '#f8f4df'; ctx.lineWidth = active ? 7 : 4; ctx.stroke(track.outline);
    ctx.globalAlpha = active ? 1 : 0.68;
    ctx.lineWidth = active ? 3.5 : 2;
    for (const [color, section] of track.sections) {
      ctx.strokeStyle = color; ctx.stroke(section);
    }
    ctx.globalAlpha = 1;
  }
  for (const station of world.stations) {
    ctx.beginPath(); ctx.arc(mx(station.x), mz(station.z), 10, 0, Math.PI * 2); ctx.fillStyle = '#f6f4e7'; ctx.fill();
    ctx.strokeStyle = '#82927a'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = '#54704f'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(station.index + 1), mx(station.x), mz(station.z));
  }
  for (const f of [world.features.bridge, world.features.tunnel, world.features.overpass].filter(Boolean)) {
    ctx.fillStyle = f.kind === 'bridge' ? '#427781' : f.kind === 'overpass' ? '#535f8a' : '#92724a';
    ctx.beginPath(); ctx.roundRect(mx(f.x) - 11, mz(f.z) - 11, 22, 22, 4); ctx.fill();
    ctx.fillStyle = '#fff8df'; ctx.font = 'bold 14px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f.kind === 'bridge' ? '橋' : f.kind === 'overpass' ? '跨' : '隧', mx(f.x), mz(f.z));
  }
  for (const view of views) {
    const p = view.rig.sample;
    ctx.beginPath(); ctx.arc(mx(p.x), mz(p.z), views.length > 1 ? 7 : 10, 0, Math.PI * 2);
    ctx.fillStyle = view.colour; ctx.fill(); ctx.strokeStyle = '#fff9de'; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(mx(p.x), mz(p.z)); ctx.rotate(-p.yaw);
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(-3, -3); ctx.lineTo(3, -3); ctx.closePath(); ctx.fillStyle = '#30514a'; ctx.fill();
    ctx.restore();
  }
  drawElevationProfile();
}
function drawStraightMinimap() {
  const ctx = mapContext, route = world.route, w = minimap.width, h = minimap.height;
  const x = distance => 48 + clamp(distance / route.length, 0, 1) * (w - 96);
  const y = lane => h * 0.34 + lane * h * 0.18;
  if (!world.minimapBase) {
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    const paint = base.getContext('2d');
    paint.fillStyle = '#e5e9d9';
    paint.beginPath(); paint.roundRect(8, 10, w - 16, h - 20, 12); paint.fill();
    const sample = {};
    for (const [i, track] of route.lanes.entries()) {
      paint.lineWidth = 5;
      for (let j = 0; j < 100; j++) {
        const a = route.length * j / 100, b = route.length * (j + 1) / 100;
        track.sample((a + b) / 2, sample);
        paint.strokeStyle = BIOME_COLORS[world.dominantBiomeAt(sample.x, sample.z)];
        paint.beginPath(); paint.moveTo(x(a), y(i)); paint.lineTo(x(b), y(i)); paint.stroke();
      }
    }
    paint.textAlign = 'center'; paint.font = '700 16px "Microsoft JhengHei", sans-serif';
    paint.lineWidth = 2; paint.strokeStyle = '#6b7e6d'; paint.fillStyle = '#355847';
    for (const station of world.stations) {
      const at = x(station.distance), edge = station.distance === 0 || station.distance === route.length;
      paint.setLineDash(edge ? [] : [3, 5]);
      paint.beginPath(); paint.moveTo(at, y(0) - 13); paint.lineTo(at, y(2) + 13); paint.stroke();
      paint.fillText(station.name, at, h * 0.225);
    }
    world.minimapBase = base;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(world.minimapBase, 0, 0);
  for (const view of views) {
    ctx.beginPath(); ctx.arc(x(view.motion.distance), y(view.rig.laneIndex), 8, 0, Math.PI * 2);
    ctx.fillStyle = view.colour; ctx.fill(); ctx.strokeStyle = '#38594b'; ctx.lineWidth = 2.5; ctx.stroke();
  }
}
function drawElevationProfile() {
  const ctx = profileContext, w = profileCanvas.width, h = profileCanvas.height, route = world.route;
  ctx.clearRect(0, 0, w, h);
  const range = Math.max(1, route.elevation.range), x = s => 8 + s / route.length * (w - 16);
  const y = altitude => h - 10 - (altitude - route.elevation.min) / range * (h - 24);
  ctx.beginPath(); ctx.moveTo(8, h - 3);
  for (let i = 0; i <= 200; i++) { const p = route.sample(i / 200 * route.length); ctx.lineTo(x(i / 200 * route.length), y(p.y)); }
  ctx.lineTo(w - 8, h - 3); ctx.closePath(); ctx.fillStyle = '#d7dfc8'; ctx.fill();
  for (const [lane, track] of (route.lanes ?? [route]).entries()) {
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) { const p = track.sample(i / 200 * route.length); if (!i) ctx.moveTo(x(0), y(p.y)); else ctx.lineTo(x(i / 200 * route.length), y(p.y)); }
    ctx.strokeStyle = route.lanes ? ['#438494', '#9f7350', '#ab675c'][lane] : '#7f956e';
    ctx.lineWidth = 2; ctx.stroke();
  }
  for (const distance of route.turnStarts.slice(1)) {
    ctx.beginPath(); ctx.moveTo(x(distance), 6); ctx.lineTo(x(distance), h - 4);
    ctx.strokeStyle = '#93a187'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const view of views) {
    const current = route.lanes ? view.motion.distance : wrap(view.motion.distance, route.length);
    ctx.beginPath(); ctx.arc(x(current), y(view.rig.sample.y), 5, 0, Math.PI * 2); ctx.fillStyle = view.colour; ctx.fill();
  }
}
function recordMetrics(dt) {
  if (!(dt > 0) || mode !== 'running') return;
  metricTime += dt; metricFrames++;
  frameSamples.push(dt * 1000); if (frameSamples.length > 600) frameSamples.shift();
  if (dt > 0.05) longFrameCount++;
  if (metricTime >= 1) {
    const fps = metricFrames / metricTime;
    const ordered = [...frameSamples].sort((a, b) => b - a);
    const worstCount = Math.max(1, Math.ceil(ordered.length * 0.01));
    const low = 1000 / (ordered.slice(0, worstCount).reduce((a, b) => a + b, 0) / worstCount);
    $('fps').textContent = fps.toFixed(0);
    $('low-fps').textContent = low.toFixed(1);
    const info = renderer.info;
    $('draw-calls').textContent = mainPass.calls.toLocaleString();
    $('triangles').textContent = mainPass.triangles >= 1e6 ? `${(mainPass.triangles / 1e6).toFixed(2)}M` : `${(mainPass.triangles / 1e3).toFixed(0)}K`;
    fpsHistory.push({ elapsedSeconds: Number(physics.elapsed.toFixed(3)), fps: Number(fps.toFixed(2)), frameTimeMs: Number((1000 / fps).toFixed(3)),
      onePercentLowFps: Number(low.toFixed(2)), drawCalls: mainPass.calls, triangles: mainPass.triangles,
      shadowDrawCalls: shadowPass.drawCalls, shadowTriangles: shadowPass.triangles, shadowMaps: shadowPass.maps, geometries: info.memory.geometries,
      cartSpeedsKmh: views.map(view => Number((view.state.speed * 3.6).toFixed(2))), turboOn,
      textures: info.memory.textures, speedKmh: Number((physics.speed * 3.6).toFixed(2)), flatReferenceKmh: Number(leverReference(physics.throttle).kmh.toFixed(2)),
      powerPercent: Number(leverReference(physics.throttle).powerPercent.toFixed(3)), gradePermille: Number((world.cartSample.grade * 1000).toFixed(3)), altitudeMetres: Number(world.cartSample.y.toFixed(3)), camera: cameraMode });
    // Bounded memory for genuinely unlimited runs: retain at most 4 hours of 1s samples.
    if (fpsHistory.length > 14400) fpsHistory.shift(); metricTime = 0; metricFrames = 0;
  }
}
function exportReport() {
  const samples = fpsHistory;
  const route = world.route, laneCount = route.lanes?.length ?? 0;
  const report = { application: 'LOOP · 軌道試驗場', version: GAME_VERSION, threeVersion: THREE.REVISION, generatedAt: new Date().toISOString(),
    settings: sessionConfig, actualTrackLengthMetres: route.length * (laneCount || 1), worldUnit: 'metre', elapsedSecondsIncludingCountdown: physics.elapsed,
    trackLayout: { mode: laneCount ? 'straight' : 'loop', lanes: laneCount || null, laneLengthMetres: laneCount ? route.length : null,
      turns: laneCount ? null : route.turns, turnStartsMetres: laneCount ? [] : route.turnStarts, crossings: route.crossings,
      stations: world.stations.map(s => ({ name: s.name, platformDistancesMetres: (s.passes ?? [s]).map(pass => pass.distance) })) },
    animalDriver: { selection: sessionConfig.driverChoice, ...world.driver?.userData.driver },
    carts: views.map((view, i) => ({ position: views.length === 1 ? 'single' : cartLabels[i], vehicle: view.rig.vehicle,
      driver: view.rig.driver?.userData.driver, departureMetres: view.rig.departure, distanceMetres: view.state.distance,
      odometerMetres: view.state.odometer, finishSeconds: view.finishTime, physics: view.engine.diagnostics(), turboKmh: view.state.turboKmh })),
    odometerMetres: physics.odometer, actualSceneryInstances: world.sceneryCount, trackSegments: world.trackInstances,
    sceneryComposition: { version: SCENERY_VERSION, ...world.sceneryStats,
      landmarks: world.sceneryPlan.landmarks.map(({ id, x, z, along }) => ({ id, x, z, along })),
      lod: 'Chunked main / LOD1 with distance hysteresis; overview uses LOD1.' },
    biomeDistribution: world.biomeReport,
    shadowSettings: { ...world.shadowProfile, widthMetres: world.shadowProfile.radius * 2 },
    elevation: world.route.elevation, physicsModel: { engine: 'Rapier', ...railPhysics.diagnostics(), suspensionYMetres: physics.suspensionY, suspensionVelocityMetresPerSecond: physics.suspensionVelocity, massKg: CART_MASS, ratedPowerWatts: RATED_POWER, ratedHorsepower: RATED_POWER / 745.699872, maximumGrade: MAX_GRADE, minimumVerticalRadiusMetres: MIN_VERTICAL_RADIUS },
    landscape: { version: '13.0.0', ...world.landscapeStats },
    landmarks: world.features, sleepers: { averagePitchMetres: world.sleeperPitch, instances: world.sleeperInstances, filterEnabled: world.config.sleeperFilter, exposureMetres: world.sleeperUniforms.exposure.value },
    presentation: { fixedPhysicsStepSeconds: FIXED_STEP, interpolatedMotion: true, chaseAnchoredToCart: true, camera: cameraMode, chaseDistanceMetres: orbitDistance, cabYawRadians: cabYaw, cabPitchRadians: cabPitch },
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: renderer.getPixelRatio(), viewCount: views.length },
    summary: { samples: samples.length, averageFps: samples.length ? Number((samples.reduce((sum, s) => sum + s.fps, 0) / samples.length).toFixed(2)) : null,
      minimumFps: samples.length ? Math.min(...samples.map(s => s.fps)) : null, longFramesOver50ms: longFrameCount },
    notes: ['以 requestAnimationFrame 實際呈現間隔計算 FPS，可能受螢幕更新率與瀏覽器垂直同步限制。', '暫停、載入與背景分頁不納入量測。', '1% low 為最近至多 600 幀中最慢 1% 幀時間的平均值換算。', '全景視角使用軌道線段 LOD；追車／駕駛使用原始 GLB 軌道。', '最多保留最近 14400 筆每秒量測。'], samples };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
  link.download = `LOOP-${sessionConfig.seed}-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`已匯出 ${samples.length} 筆實際效能量測。`);
}

function physicsTick() {
  for (const view of views) {
    const {state, quiz, rig} = view;
    copyMotion(state, view.previous);
    state.elapsed += FIXED_STEP;
    const waiting = Math.min(FIXED_STEP, state.countdown);
    state.countdown = Math.max(0, state.countdown - waiting);
    const previousTier = quiz.tier;
    quiz.tick(FIXED_STEP - waiting, rig.raceLength);
    state.odometer = quiz.distance + quiz.coastDistance;
    state.distance = rig.departure + state.odometer;
    state.speed = quiz.speed / 3.6;
    state.throttle = quiz.finished === null ? leverForSpeed(quiz.speed) : 0;
    state.turboKmh = Math.max(0, quiz.speed - 60);
    view.finishTime = quiz.finished;
    if (rig.smile) {
      rig.smile.visible = quiz.finished !== null;
      rig.driver.position.y = .45 * THREE.MathUtils.smoothstep(quiz.coastTime, 0, 1.2);
    }
    if (previousTier !== quiz.tier && quiz.tier) rig.turbo?.setTier(quiz.tier);
    if (Boolean(previousTier) !== Boolean(quiz.tier)) rig.turbo?.setEnabled(quiz.tier > 0, state.elapsed);
  }
  turboOn = views.some(v => v.quiz.tier > 0);
  world.airshow?.updateRace(views, physics.elapsed - DEPARTURE_COUNTDOWN);
  if (views.every(view => view.quiz.coastTime >= COAST_SECONDS)) showRaceResults();
}
function updateCartMotion(alpha) {
  for (const { state, previous, motion, rig } of views) {
    interpolateMotion(previous, state, alpha, motion);
    world.updateCart(motion.distance, motion.odometer, state.throttle, motion.suspensionY, rig);
    rig.turbo?.update(state.elapsed, state.throttle >= 0 && state.speed >= -0.05);
  }
}
function frame(time) {
  requestAnimationFrame(frame);
  if (!renderer || !world || mode === 'loading' || document.hidden) { lastTime = 0; return; }
  const realDt = lastTime ? (time - lastTime) / 1000 : 0; lastTime = time;
  const dt = Math.min(realDt, 0.1);
  if (mode === 'running') {
    // Fixed physical timestep. Keep every foreground second, including slow
    // stress-test frames; background tabs are explicitly paused separately.
    accumulator += realDt;
    while (accumulator >= FIXED_STEP && mode === 'running') {
      physicsTick(); accumulator -= FIXED_STEP;
    }
    updateCartMotion(mode === 'finished' ? 1 : accumulator / FIXED_STEP);
    hudElapsed += realDt;
    if (mode === 'finished' || hudElapsed > 0.09) { updateHUD(); hudElapsed = 0; }
  } else if (mode === 'finished') {
    finishAnimationTime += dt;
    for (const view of views) view.rig.turbo?.update(view.state.elapsed + finishAnimationTime, false);
  } else if (mode === 'title') {
    titleTime += dt;
    // Slow cinematic shunt remains close to the departure station.
    renderMotion.distance = (world.route.lanes ? 14 : 0) + Math.sin(titleTime * 0.022) * 14; renderMotion.speed = 0;
    world.updateCart(renderMotion.distance, titleTime * 1.0, 0);
  }
  if (mode !== 'paused') {
    filteredFrameTime = lerp(filteredFrameTime, clamp(realDt, 1 / 144, 1 / 20), 0.10);
    world.updateEnvironment(dt, mode === 'running' ? renderMotion.speed : 0, filteredFrameTime);
  }
  visibilityElapsed += dt;
  renderFrame(mode === 'paused' ? 0 : dt);
  recordMetrics(realDt);
}

async function boot() {
  if (location.protocol === 'file:') throw new Error('請透過 HTTP 開啟此專案：執行 START_LOCAL.cmd 後前往 http://127.0.0.1:4173，或使用 GitHub Pages 網址。');
  const response = await fetch('./asset-manifest.json?v=22'); if (!response.ok) throw new Error(`找不到資產清單（HTTP ${response.status}）。請完整解壓縮 ZIP。`);
  manifest = await response.json();
  loadingProgress(.02,'初始化本機 Rapier 物理引擎…'); await initRapier();
  await setupQuestions(()=>mode==='running'); setupRaceAudio(); populateForm(); installControls();
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const renderShadowMap = renderer.shadowMap.render.bind(renderer.shadowMap);
  // Three has assembled the main render list before this callback. Temporarily
  // include the other cameras' casters only while rendering the shared depth map.
  renderer.shadowMap.render = (lights, shadowScene, shadowCamera) => {
    const draw = () => renderShadowMap(lights, shadowScene, shadowCamera);
    return shadowCasterViews ? world.withSharedShadowCasters(shadowCasterViews, draw) : draw();
  };
  renderer.setClearColor('#b9cebd');
  scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = false;
  atmosphere = createAtmosphere(scene, renderer); store = new AssetStore(manifest);
  requestAnimationFrame(frame);
  const config = previewConfig(); await loadWorld(config, true);
  mode = 'title'; menu.hidden = false; loading.hidden = true; startButton.disabled = false;
  updatePreviewCaption(config); resize();
  document.body.dataset.ready = 'true'; document.body.dataset.state = 'title';
}

window.__LOOP_TEST__ = {
  snapshot: () => ({
    mode, version: GAME_VERSION, physics: { ...physics }, renderMotion: { ...renderMotion },
    config: world?.config, biomes: world?.biomeReport, scenery: world?.sceneryStats, rapier: railPhysics?.diagnostics(), turboOn,
    cart: world?.cart?.position.toArray(),
    camera: camera ? { position: camera.position.toArray(), direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      cartNDC: world.cart.position.clone().project(camera).toArray(), cartVisible: views[Math.floor(views.length / 2)].cartVisible,
      near: camera.near, far: camera.far, fog: [scene.fog.near, scene.fog.far], visibleGroups: world.cullGroups.filter(g => g.group.visible).length } : null,
    carts: views.map(view => ({ vehicle: view.rig.vehicle, driver: view.rig.driver?.userData.driver.id, departure: view.rig.departure,
      laneLength: view.rig.track.length, raceLength: view.rig.raceLength, finishSeconds: view.finishTime,
      state: { ...view.state }, position: view.rig.root.position.toArray(), viewport: view.viewport, camera: view.camera.position.toArray(),
      direction: view.camera.getWorldDirection(new THREE.Vector3()).toArray(), cartVisible: view.cartVisible,
      turboVisible: Boolean(view.rig.turbo?.root.visible),
      pods: view.rig.turbo?.pods.map(pod => ({ position: pod.mount.position.toArray(), scale: pod.mount.scale.x, exhaust: pod.exhaust.visible })) })),
    wheels: world?.wheels?.map(w => w.node.getWorldPosition(new THREE.Vector3()).toArray()),
    textures: renderer?.info.memory.textures, materials: store?.sharedMaterials.size,
  }),
  setMix:rows=>mixControls.set(rows,true),setThrottle,pause:pauseGame,placeBumper,clearBumper,
  inspectBiome:biome=>{const distance=world?.biomeLayout?.centerOf(biome);if(distance==null)return;renderMotion.distance=distance;world.updateCart(distance,distance,0);renderFrame(0,true);},
  report:()=>({biomes:world?.biomeReport,scenery:world?.sceneryStats,physics:railPhysics?.diagnostics()}),
};
// Deterministic foreground simulation is available only on an explicitly opened
// local QA URL. It runs the very same fixed-step function as requestAnimationFrame.
if(location.hostname==='127.0.0.1' && new URLSearchParams(location.search).get('qa')==='1') {
  window.__LOOP_TEST__.advance = seconds => {
    if(!['running','paused','finished'].includes(mode))throw new Error('Start a route before advancing QA simulation.');
    if(!Number.isFinite(seconds)||seconds<0||seconds>300)throw new Error('QA advancement must be within 0–300 seconds.');
    for(let i=0;i<Math.round(seconds/FIXED_STEP) && mode!=='finished';i++)physicsTick();
    for (const view of views) copyMotion(view.state, view.previous);
    accumulator=0;lastTime=0; updateCartMotion(1);
    updateHUD(); renderFrame(0, true);
    return window.__LOOP_TEST__.snapshot();
  };
  window.__LOOP_TEST__.renderCost = () => ({
    main: { ...mainPass },
    shadows: { ...shadowPass },
    shadowProfile: world.shadowProfile,
    sharedShadowSize: sharedShadowFrame ? [sharedShadowFrame.width, sharedShadowFrame.height] : null,
    views: views.map(view => ({ main: { ...view.main }, shadows: { ...view.shadows } })),
  });
  window.__LOOP_TEST__.setSharedShadows = enabled => {
    allowSharedShadows = Boolean(enabled);
    renderFrame(0, true);
  };
}

boot().catch(showError);
