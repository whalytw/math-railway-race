import {CLOUD_EVENTS, cloudLaunchDecision} from '../src/cloud-schedule.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {raceStandings} from '../src/straight-race.js';
import {QuizLane,DEFAULT_CAPS} from '../src/quiz-race.js';
const json=async f=>JSON.parse(await readFile(new URL('../question-bank/'+f+'.json',import.meta.url)));
const books=await json('books'), pool=await json('number');
const newLane=i=>new QuizLane([{label:'數與數線',questions:pool}],45,DEFAULT_CAPS,i);
const run=(lane,seconds,length=5000)=>{for(let i=0;i<Math.round(seconds*120);i++)lane.tick(1/120,length);};
import {DEFAULT_RIFT_CHANCE, inRift, portalDistance, RIFT_CHANCES, RIFT_ENTRY, RIFT_EXIT, RiftDraw} from '../src/rift-rules.js';
import {createRiftTracks} from '../src/rift-track.js';

test('all 42 book units offer at least 36 distinct prompts at each level',async()=>{
  assert.equal(books.flatMap(b=>b.units).length,42);
  for(const unit of books.flatMap(b=>b.units)){const rows=await json(unit.topic);
    for(const level of [1,2,3]){const items=rows.filter(q=>q.level===level);assert.ok(new Set(items.map(q=>q.prompt)).size>=36);assert.ok(items.every(q=>Number.isFinite(q.answer)&&q.hint));}}
});
test('three independent lanes, timed queue, tier speeds and feedback',()=>{
 const lanes=[0,1,2].map(newLane);lanes.forEach(l=>run(l,8));
 assert.equal(new Set(lanes.map(l=>l.question.prompt)).size,3);
 const [a,b,c]=lanes; a.settle(a.question.answer);a.settle(a.question.answer);b.settle(null);c.hint();c.hint();
 assert.equal(a.correct,1);assert.equal(b.ends.length,0);assert.ok(Math.abs(c.until-c.clock-35)<1e-6);
 for(const cap of [75,90,100]){run(a,1.5);assert.ok(Math.abs(a.speed-cap)<1e-6);if(cap<100){run(a,3.5);a.settle(a.question.answer);}}
 run(a,37);assert.equal(a.tier,2);run(a,45);assert.equal(a.tier,1);run(a,46);assert.equal(a.tier,0);run(a,10);assert.equal(a.speed,60);
 run(c,36);assert.equal(c.phase,'feedback');assert.equal(c.correct,0);
});
test('boosted rider finishes first and remains at finish',()=>{const fast=newLane(0),slow=newLane(1);
 for(const l of [fast,slow]){run(l,8,3000);if(l===fast)l.settle(l.question.answer);run(l,230,3000);assert.equal(l.distance,3000);assert.equal(l.phase,'finished');}
 assert.ok(fast.finished<slow.finished);
});

test('next question follows each rider’s streak and timeout resets it', () => {
  const lane=newLane(0), other=newLane(1);
  lane.next(); other.next();
  for (const level of [1,2,3,3]) {
    lane.settle(lane.question.answer); lane.next();
    assert.equal(lane.question.level,level);
    assert.equal(lane.options.length,level+3);
    assert.equal(new Set(lane.options).size,lane.options.length);
    assert.ok(lane.options.includes(lane.question.answer));
    assert.equal(other.question.level,1);
  }
  lane.settle(lane.question.answer + 1); lane.next();
  assert.equal(lane.question.level,1);
  lane.settle(lane.question.answer); lane.next();
  lane.settle(lane.question.answer); lane.next();
  run(lane,45); run(lane,5.01);
  assert.equal(lane.question.level,1);
});
test('coasting preserves crossing time and stops after ten seconds', () => {
  const lane=newLane(0);
  while(lane.finished===null) lane.tick(1/120,100);
  const finish=lane.finished, speed=lane.finishSpeed;
  assert.ok(speed>0);
  lane.tick(5-lane.coastTime,100);
  assert.ok(Math.abs(lane.speed-speed/2)<1e-6);
  lane.tick(5,100);
  assert.equal(lane.speed,0);
  assert.ok(Math.abs(lane.coastDistance-speed*10/7.2)<1e-6);
  assert.equal(lane.finished,finish); assert.equal(lane.distance,100);
});

test('answer feedback reports the boost awarded immediately and ignores expired segments', () => {
  const lane = newLane(0);
  for (const tier of [1, 2, 3, 3]) {
    lane.next();
    const result = lane.settle(lane.question.answer);
    assert.equal(result.tier, tier);
    assert.equal(result.bonus, 45);
    assert.equal(lane.boostTier, tier);
    assert.ok(result.ok);
  }
  lane.clock = lane.ends.at(-1);
  lane.next();
  const result = lane.settle(lane.question.answer);
  assert.equal(result.tier, 1);
  assert.equal(lane.ends.at(-1), lane.clock + 45);
  assert.equal(lane.settle(lane.question.answer), undefined);
});

test('live ranks compare progress until each cart finishes and preserve ties', () => {
  const ranks = (times, distances) => raceStandings(times, distances).map(({lane, rank}) => [lane, rank]);
  assert.deepEqual(ranks([null, null, null], [0, 0, 0]), [[0, 1], [1, 1], [2, 1]]);
  assert.deepEqual(ranks([null, null, null], [.45, .31, .47]), [[2, 1], [0, 2], [1, 3]]);
  assert.deepEqual(ranks([null, 108, null], [.98, 1, .98]), [[1, 1], [0, 2], [2, 2]]);
  assert.deepEqual(ranks([111.0001, 108, 111.0002], [1, 1, 1]), [[1, 1], [0, 2], [2, 2]]);
});

test('cloud bonuses add immediately without altering the JET timeline', () => {
  for (const [bonus, duration] of [[10, 3], [5, 5], [10, 7]]) {
    const lane = newLane(0), opponent = newLane(1);
    lane.ends = [50, 55, 60];
    run(lane, 6);
    run(opponent, 6);
    assert.equal(lane.speed, 100);
    const distance = lane.distance;
    lane.grantCloudBoost(bonus, duration);
    assert.equal(lane.speed, 100 + bonus);
    assert.equal(lane.cloudBonus, bonus);
    assert.equal(opponent.speed, 60);
    run(lane, duration);
    assert.equal(lane.cloudBonus, 0);
    assert.equal(lane.speed, 100);
    assert.ok(Math.abs(lane.distance - distance - duration * (100 + bonus) / 3.6) < 1e-6);
    assert.deepEqual(lane.ends, [50, 55, 60]);
  }
});

test('a cloud bonus expires during a tick and preserves the finish speed', () => {
  const lane = newLane(0);
  run(lane, 6);
  lane.grantCloudBoost(10, .025);
  const initial = lane.distance;
  const length = initial + 1;
  lane.tick(.08, length);
  assert.ok(lane.finished !== null);
  assert.equal(lane.cloudBonus, 0);
  assert.equal(lane.finishSpeed, 60);
  const speed = lane.speed;
  lane.grantCloudBoost(10, 7);
  assert.equal(lane.speed, speed);
});

test('a cart that finishes during a cloud bonus starts the coast at its boosted speed', () => {
  const lane = newLane(0);
  run(lane, 6);
  lane.grantCloudBoost(10, 3);
  lane.tick(.1, lane.distance + .5);
  assert.equal(lane.finishSpeed, 70);
  assert.equal(lane.cloudBonus, 0);
});

test('cloud departures stay inside each progress window and move around tunnels', () => {
  const cart = (progress, laneIndex = 0, distance = progress * 3000) => ({
    quiz: {distance: progress * 3000, finished: null, caps: [75, 90, 100]},
    rig: {raceLength: 3000, laneIndex, track: {length: 4000}},
    state: {distance, speed: 60 / 3.6},
  });
  const first = CLOUD_EVENTS[0];
  const earlyTunnel = {start: 1045, end: 1125, turnIndex: 0};
  const passingTunnel = {start: 720, end: 800, turnIndex: 0};
  const launch = (progress, tunnel = null) => cloudLaunchDecision([cart(progress)], tunnel, false, first, 14).status;
  assert.equal(launch(.1699, earlyTunnel), 'wait');
  assert.equal(launch(.18, earlyTunnel), 'launch');
  assert.equal(launch(.24), 'wait');
  assert.equal(launch(.25), 'launch');
  assert.equal(launch(.25, passingTunnel), 'wait');
  assert.equal(launch(.27, passingTunnel), 'wait');
  assert.equal(launch(.28, passingTunnel), 'launch');
  assert.equal(launch(.33), 'launch');
  assert.equal(launch(.3301, passingTunnel), 'skip');
  assert.equal(cloudLaunchDecision([cart(.25, 1)], passingTunnel, false, first, 14).status, 'launch');
  assert.equal(cloudLaunchDecision([cart(.25, 1), cart(.249)], passingTunnel, false, first, 14).status, 'wait');
  assert.equal(cloudLaunchDecision([cart(.25, 2, 4078)], {start: 65, end: 145, turnIndex: 0}, true, first, 14).status, 'wait');
  const approaching = {start: 1162, end: 1242, turnIndex: 0};
  assert.deepEqual(cloudLaunchDecision([cart(.25)], approaching, false, first, 14.6, 13.2),
    {status: 'launch', duration: 13.2});
});

test('rift chance is checked once at half distance and rerolled for a new round', () => {
  assert.deepEqual(RIFT_CHANCES, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.equal(DEFAULT_RIFT_CHANCE, 20);
  const samples = [.19, .20];
  const draw = new RiftDraw(20, () => samples.shift());
  assert.equal(draw.update(.49999), null);
  assert.equal(samples.length, 2);
  assert.equal(draw.update(.5), true);
  assert.equal(draw.update(.8), true);
  assert.equal(samples.length, 1);
  draw.reset();
  assert.equal(draw.update(.51), false);
  assert.equal(draw.update(.95), false);
  assert.equal(samples.length, 0);
  assert.equal(new RiftDraw(0, () => assert.fail('0% should not draw')).update(.5), false);
});

test('rift tracks have the same measured length with separate lanes and aligned portal planes', () => {
  for (const raceLength of [3000, 5000, 7000]) for (const count of [1, 3]) {
    const rigs = Array.from({length: count}, (_, i) => ({raceLength, departure: i * 1423}));
    for (const random of [() => .01, () => .99]) {
      const tracks = createRiftTracks(rigs, random);
      const exits = tracks.map(track => track.sample(track.start + track.length));
      assert.ok(exits.every(point => Math.abs(point.z - exits[0].z) < 1e-6 && Math.abs(point.tx) < 1e-4 && Math.abs(point.ty) < 1e-4));
      for (const track of tracks) {
        let arc = 0;
        for (let i = 1; i < track.points.length; i++) {
          const a = track.points[i - 1], b = track.points[i];
          arc += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        }
        assert.ok(Math.abs(arc - raceLength * .30) < 1e-7);
        assert.ok(Math.max(...track.points.map(p => Math.abs(p.bank))) >= .55);
      }
      if (count === 3) for (let i = 0; i <= 100; i++) {
        const positions = tracks.map(track => track.sample(track.start + track.length * i / 100));
        for (const [a, b] of [[0,1],[0,2],[1,2]]) {
          const x = positions[a], y = positions[b];
          assert.ok(Math.hypot(x.x-y.x, x.y-y.y, x.z-y.z) > 17);
        }
      }
    }
    const entry = raceLength * RIFT_ENTRY, exit = raceLength * RIFT_EXIT;
    assert.equal(inRift(entry - .001, raceLength), false);
    assert.equal(inRift(entry, raceLength), true);
    assert.equal(inRift(exit - .001, raceLength), true);
    assert.equal(inRift(exit, raceLength), false);
    assert.equal(portalDistance(entry, raceLength), 0);
    assert.equal(portalDistance(exit, raceLength), 0);
  }
});
