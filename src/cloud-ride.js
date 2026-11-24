import * as THREE from 'three';
import {smoothstep} from './core.js?v=13.0.0';
import {shuffle} from './quiz-race.js?v=23';
import {createCloudRider} from './drivers.js?v=23';
import {AircraftShadow} from './aircraft-shadow.js?v=24';
import {AirshowSmoke} from './airshow-smoke.js?v=23';
import {CloudPath, cloudFlightDuration, chooseCloudManeuvers, MIN_CLOUD_FLIGHT_SECONDS} from './cloud-path.js?v=28';
import {CLOUD_EVENTS, cloudLaunchDecision, cloudProgress} from './cloud-schedule.js?v=25';
import {CloudStars, STAR_COUNT, STAR_DROP_SECONDS, starReleaseDelay} from './cloud-stars.js?v=23';

export const CLOUD_ASSET = 'CloudPlatform';
const SCALE = 2.48;
const CLEARANCE_BUDGET_MS = 2;

export function pickCloudRiders(drivers, activeDrivers, random = Math.random) {
  const used = new Set(activeDrivers);
  return shuffle(drivers.filter(id => !used.has(id)), random).slice(0, CLOUD_EVENTS.length);
}

function makePose() {
  return {position: new THREE.Vector3(), rotation: new THREE.Quaternion(), yaw: 0};
}

export class CloudRide {
  constructor(world, views, random = Math.random) {
    this.world = world;
    this.views = views;
    this.random = random;
    this.riders = world.cloudRiders;
    this.roll = 0;
    this.next = 0;
    this.plannedDuration = null;
    this.root = new THREE.Group();
    this.root.name = 'FlyingCloud';
    this.root.visible = false;
    const {root, bounds} = world.store.get(CLOUD_ASSET);
    const platform = root.clone(true);
    platform.scale.multiplyScalar(SCALE);
    this.deck = bounds.max.y * SCALE + .025;
    this.root.add(platform);
    world.group.add(this.root);

    this.materialCopies = new Map();
    this.platformMaterials = this.bindMaterials(platform);
    const tail = new THREE.Vector3(0, this.deck * .50, bounds.min.z * SCALE * .86);
    this.smoke = new AirshowSmoke(world, [tail], {
      lifetime: 1.18, spacing: .027, colors: ['#fffdf8'], sizes: [1.18, 3.75], opacity: .51, range: 72,
    });
    this.smoke.mesh.name = 'CloudWhiteTrail';
    this.stars = new CloudStars(world);
    this.shadow = world.config.cloudShadow ? new AircraftShadow(world, 5.5, 5.0, 'cloud') : null;
    this.pose = makePose();
    this.trailPose = makePose();
    this.sampleTrail = time => this.flight.path.sample(time, this.renderTime, true, this.trailPose);
  }

  bindMaterials(root) {
    const materials = new Set();
    root.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = object.receiveShadow = false;
      const material = object.material;
      if (!this.materialCopies.has(material)) {
        const copy = material.clone();
        this.materialCopies.set(material, copy);
        this.world.ownedMaterials.push(copy);
      }
      object.material = this.materialCopies.get(material);
      materials.add(object.material);
    });
    return materials;
  }

  hide() {
    this.root.visible = false;
    this.shadow?.hide();
    this.stars.clear();
    this.smoke.clear();
  }

  reset() {
    this.next = 0; this.plannedDuration = null; this.flight = null; this.burst = null;
    this.hide();
    const stamp = ++this.roll;
    const riders = pickCloudRiders(this.world.store.manifest.drivers,
      this.views.map(view => view.rig.driver?.userData.driver.id), this.random);
    // Prefetch the new draw while the next race begins. On a slow connection
    // the already loaded riders remain available for that race.
    this.world.store.load(riders).then(() => {
      if (!this.world.disposed && this.roll === stamp && this.next === 0) this.riders = riders;
    }).catch(() => {});
  }

  start(views, seconds, event, riderId, duration) {
    const order = shuffle(views.filter(({quiz}) => quiz.finished === null), this.random)
      .sort((a, b) => cloudProgress(a) - cloudProgress(b));
    if (!order.length) return;
    const maneuvers = chooseCloudManeuvers(this.random);
    const side = this.random() < .5 ? -1 : 1;
    const path = new CloudPath(this.world, order, maneuvers, side, duration);
    const gifts = [{at: path.visits[0], view: order[0], kmh: 10}];
    if (order.length === 3 && this.random() < .60) gifts.push({at: path.visits[1], view: order[1], kmh: 5});
    if (this.rider) this.root.remove(this.rider);
    this.rider = riderId ? createCloudRider(this.world.store.get(riderId), this.deck) : null;
    this.activeMaterials = new Set(this.platformMaterials);
    if (this.rider) {
      this.rider.userData.assetId = riderId;
      this.root.add(this.rider);
      for (const material of this.bindMaterials(this.rider)) this.activeMaterials.add(material);
    }
    this.smoke.clear();
    this.flight = {startsAt: seconds, event, order, maneuvers, gifts, nextGift: 0, path, clearance: path.planClearance()};
  }

  updateRace(views, seconds) {
    let rewarded = false;
    const rift = this.world.rift;
    if (this.burst && rift?.inside(this.burst.view)) this.burst = null;
    if (this.burst && seconds + 1e-8 >= this.burst.startsAt + STAR_DROP_SECONDS) {
      const {view, kmh, duration} = this.burst;
      if (view.quiz.finished === null) {
        view.quiz.grantCloudBoost(kmh, duration);
        rewarded = true;
      }
      this.burst = null;
    }
    if (this.flight && seconds >= this.flight.startsAt + this.flight.path.duration + this.smoke.lifetime) {
      this.flight = null;
      this.hide();
    }
    if (!this.flight) {
      const event = CLOUD_EVENTS[this.next];
      if (!event) return rewarded;
      const duration = this.plannedDuration ??= cloudFlightDuration(this.random);
      const tail = this.smoke.lifetime;
      const blocksFlight = rift?.active ? (delay, duration, reward) => rift.blocksFlight(views, delay, duration, reward) : null;
      const decision = cloudLaunchDecision(views, this.world.features.tunnel, !this.world.route.lanes,
        event, duration + tail, MIN_CLOUD_FLIGHT_SECONDS + tail, blocksFlight);
      if (decision.status === 'wait') return rewarded;
      const rider = this.riders[this.next++];
      this.plannedDuration = null;
      if (decision.status === 'launch') this.start(views, seconds, event, rider, decision.duration - tail);
      return rewarded;
    }
    const elapsed = seconds - this.flight.startsAt;
    const gift = this.flight.gifts[this.flight.nextGift];
    if (gift && elapsed + 1e-8 >= gift.at) {
      this.flight.nextGift++;
      if (rift?.inside(gift.view)) return rewarded;
      const origins = Array.from({length: STAR_COUNT}, (_, i) => {
        const point = new THREE.Vector3();
        this.flight.path.positionAt(gift.at + starReleaseDelay(i), elapsed, false, point);
        point.y += this.deck * .44;
        return point;
      });
      this.burst = {...gift, startsAt: seconds, origins, duration: this.flight.event.rewardSeconds};
    }
    return rewarded;
  }

  flyoverFraming(view) {
    if (!this.flight) return 0;
    const visit = this.flight.path.visits[this.flight.order.indexOf(view)];
    if (visit === undefined) return 0;
    const t = this.renderTime;
    return smoothstep(visit - .85, visit - .35, t) * (1 - smoothstep(visit + .32, visit + .87, t));
  }

  draw(seconds, viewportHeight) {
    if (!this.flight) return;
    // The live footprint remains active while the early flyby builds its
    // look-ahead envelope in short slices across successive frames.
    const until = performance.now() + CLEARANCE_BUDGET_MS;
    while (this.flight.clearance && performance.now() < until) {
      if (this.flight.clearance.next().done) this.flight.clearance = null;
    }
    const {path, startsAt} = this.flight;
    const time = Math.max(0, seconds - startsAt), {duration} = path;
    this.renderTime = time;
    this.root.visible = time < duration;
    if (this.root.visible) {
      const pose = path.sample(time, time, true, this.pose);
      this.root.position.copy(pose.position);
      this.root.quaternion.copy(pose.rotation);
      const fade = 1 - smoothstep(duration - 1.45, duration, time);
      for (const material of this.activeMaterials) {
        const transparent = fade < 1;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.depthWrite = !transparent;
          material.needsUpdate = true;
        }
        material.opacity = fade;
      }
      this.shadow?.update(this.world, pose.position, pose.yaw, fade);
    } else this.shadow?.hide();
    this.smoke.update(time, duration, viewportHeight, this.sampleTrail);
    if (this.burst) this.stars.draw(this.burst, seconds);
    else this.stars.clear();
  }
}
