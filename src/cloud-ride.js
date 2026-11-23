import * as THREE from 'three';
import {smoothstep} from './core.js?v=13.0.0';
import {shuffle} from './quiz-race.js?v=23';
import {createCloudRider} from './drivers.js?v=23';
import {AircraftShadow} from './aircraft-shadow.js?v=23';
import {AirshowSmoke} from './airshow-smoke.js?v=23';
import {CloudPath, CLOUD_FLIGHT_SECONDS, CLOUD_VISITS, chooseCloudManeuvers} from './cloud-path.js?v=23';
import {CloudStars, STAR_COUNT, STAR_DROP_SECONDS, starReleaseDelay} from './cloud-stars.js?v=23';

export const CLOUD_ASSET = 'CloudPlatform';
const EVENTS = [{progress: .25, duration: 3}, {progress: .50, duration: 5}, {progress: .70, duration: 7}];
const SCALE = 2.48;

export function pickCloudRiders(drivers, activeDrivers, random = Math.random) {
  const used = new Set(activeDrivers);
  return shuffle(drivers.filter(id => !used.has(id)), random).slice(0, EVENTS.length);
}

function makePose() {
  return {position: new THREE.Vector3(), rotation: new THREE.Quaternion(), yaw: 0};
}

function progress(view) {
  return view.quiz.distance / view.rig.raceLength;
}

export class CloudRide {
  constructor(world, views, random = Math.random) {
    this.world = world;
    this.views = views;
    this.random = random;
    this.riders = world.cloudRiders;
    this.roll = 0;
    this.next = 0;
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
      lifetime: .56, spacing: .023, colors: ['#fffdf8'], sizes: [1.26, 3.25], opacity: .52, range: 47,
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
    this.next = 0; this.flight = null; this.burst = null;
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

  start(views, seconds, event, riderId) {
    const order = shuffle(views.filter(({quiz}) => quiz.finished === null), this.random)
      .sort((a, b) => progress(a) - progress(b));
    if (!order.length) return;
    const maneuvers = chooseCloudManeuvers(this.random);
    const side = this.random() < .5 ? -1 : 1;
    const path = new CloudPath(this.world, order, maneuvers, side);
    const gifts = [{at: CLOUD_VISITS[0], view: order[0], kmh: 10}];
    if (order.length === 3 && this.random() < .60) gifts.push({at: CLOUD_VISITS[1], view: order[1], kmh: 5});
    if (this.rider) this.root.remove(this.rider);
    this.rider = riderId ? createCloudRider(this.world.store.get(riderId), this.deck) : null;
    this.activeMaterials = new Set(this.platformMaterials);
    if (this.rider) {
      this.rider.userData.assetId = riderId;
      this.root.add(this.rider);
      for (const material of this.bindMaterials(this.rider)) this.activeMaterials.add(material);
    }
    this.smoke.clear();
    this.flight = {startsAt: seconds, event, order, maneuvers, gifts, nextGift: 0, path};
  }

  updateRace(views, seconds) {
    let rewarded = false;
    if (this.burst && seconds + 1e-8 >= this.burst.startsAt + STAR_DROP_SECONDS) {
      const {view, kmh, duration} = this.burst;
      if (view.quiz.finished === null) {
        view.quiz.grantCloudBoost(kmh, duration);
        rewarded = true;
      }
      this.burst = null;
    }
    const event = EVENTS[this.next];
    if (event && views.some(view => progress(view) >= event.progress)) {
      const rider = this.riders[this.next++];
      this.start(views, seconds, event, rider);
    }
    if (!this.flight) return rewarded;
    const elapsed = seconds - this.flight.startsAt;
    const gift = this.flight.gifts[this.flight.nextGift];
    if (gift && elapsed + 1e-8 >= gift.at) {
      this.flight.nextGift++;
      const origins = Array.from({length: STAR_COUNT}, (_, i) => {
        const point = new THREE.Vector3();
        this.flight.path.positionAt(gift.at + starReleaseDelay(i), elapsed, false, point);
        point.y += this.deck * .44;
        return point;
      });
      this.burst = {...gift, startsAt: seconds, origins, duration: this.flight.event.duration};
    }
    if (elapsed >= CLOUD_FLIGHT_SECONDS + this.smoke.lifetime) {
      this.flight = null;
      this.hide();
    }
    return rewarded;
  }

  flyoverFraming(view) {
    if (!this.flight) return 0;
    const visit = CLOUD_VISITS[this.flight.order.indexOf(view)];
    if (visit === undefined) return 0;
    const t = this.renderTime;
    return smoothstep(visit - .85, visit - .35, t) * (1 - smoothstep(visit + .32, visit + .87, t));
  }

  draw(seconds, viewportHeight) {
    if (!this.flight) return;
    const time = Math.max(0, seconds - this.flight.startsAt);
    this.renderTime = time;
    const pose = this.flight.path.sample(Math.min(time, CLOUD_FLIGHT_SECONDS), time, true, this.pose);
    this.root.visible = time < CLOUD_FLIGHT_SECONDS;
    if (this.root.visible) {
      this.root.position.copy(pose.position);
      this.root.quaternion.copy(pose.rotation);
      const fade = 1 - smoothstep(6.66, CLOUD_FLIGHT_SECONDS, time);
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
    this.smoke.update(time, CLOUD_FLIGHT_SECONDS, viewportHeight, this.sampleTrail);
    if (this.burst) this.stars.draw(this.burst, seconds);
    else this.stars.clear();
  }
}
