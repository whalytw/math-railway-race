import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {QuizLane,DEFAULT_CAPS} from '../src/quiz-race.js';
const json=async f=>JSON.parse(await readFile(new URL('../question-bank/'+f+'.json',import.meta.url)));
const books=await json('books'), pool=await json('number');
const newLane=i=>new QuizLane([{label:'數與數線',questions:pool}],1,45,DEFAULT_CAPS,i);
const run=(lane,seconds,length=5000)=>{for(let i=0;i<Math.round(seconds*120);i++)lane.tick(1/120,length);};
test('all 42 book units offer at least twelve distinct prompts at each level',async()=>{
  assert.equal(books.flatMap(b=>b.units).length,42);
  for(const unit of books.flatMap(b=>b.units)){const rows=await json(unit.topic);
    for(const level of [1,2,3]){const items=rows.filter(q=>q.level===level);assert.ok(new Set(items.map(q=>q.prompt)).size>=12);assert.ok(items.every(q=>Number.isFinite(q.answer)&&q.hint));}}
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
