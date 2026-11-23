import {clearAnswerEffects, showAnswerEffect} from './answer-effects.js?v=19';
import {playRaceSound} from './race-audio.js?v=20';
import {raceStandings} from './straight-race.js?v=22';
import {DEFAULT_CAPS, JET_FLAME_COLORS, QuizLane, shuffle} from './quiz-race.js?v=23';
const $ = id => document.getElementById(id);
const storageKey = 'math-railway-classroom-v1';
const names = ['基礎', '進階', '挑戰'];
const ordinal = ['1st', '2nd', '3rd'];
let books, bank, settings, panes = [], laneList = [], isLive;
function save() { try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch {} }
async function json(file) {
  const response = await fetch('./question-bank/' + file + '.json?v=17');
  if (!response.ok) throw new Error('題庫載入失敗：' + file);
  return response.json();
}
export async function setupQuestions(live) {
  isLive = live; books = await json('books');
  const keys = [...new Set(books.flatMap(b => b.units.map(u => u.topic)))];
  bank = Object.fromEntries(await Promise.all(keys.map(async key => [key, await json(key)])));
  let old = {};
  try { old = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
  const book = books.find(b => b.id === old.book) || books[0];
  const selected = book.units.filter(u => old.units?.includes(u.topic)).map(u => u.topic);
  settings = {book:book.id, units:selected.length ? selected : [book.units[0].topic],
    seconds:[20,30,45,60].includes(old.seconds)?old.seconds:45, caps:validCaps(old.caps)?old.caps:[...DEFAULT_CAPS]};
  const dialog = $('teacher'), selector = $('book');
  books.forEach(b => selector.add(new Option(b.name, b.id)));
  function fillTopics(list) {
    const active = books.find(b => b.id === selector.value);
    $('units').replaceChildren(...active.units.map(u => {
      const label=document.createElement('label'), input=document.createElement('input');
      input.type='checkbox'; input.value=u.topic; input.checked=list.includes(u.topic);
      label.append(input, u.label); return label;
    }));
  }
  $('settings-open').onclick = () => {
    selector.value=settings.book; fillTopics(settings.units);
    $('time-limit').value=settings.seconds;
    settings.caps.forEach((v,i) => $('cap'+i).value=v);
    $('settings-error').textContent=''; dialog.showModal();
  };
  selector.onchange = () => fillTopics([books.find(b=>b.id===selector.value).units[0].topic]);
  $('select-all').onclick = () => document.querySelectorAll('#units input').forEach(el=>el.checked=true);
  $('select-none').onclick = () => document.querySelectorAll('#units input').forEach(el=>el.checked=false);
  $('cancel-settings').onclick=()=>dialog.close();
  $('teacher-form').onsubmit = e => {
    e.preventDefault();
    const units=Array.from(document.querySelectorAll('#units input:checked'),el=>el.value);
    const caps=[0,1,2].map(i=>Number($('cap'+i).value));
    if (!units.length || !validCaps(caps)) {
      $('settings-error').textContent=!units.length?'請至少勾選一個單元。':'三級速度須逐級增加，介於 61 到 120 km/h。';return;
    }
    settings={book:selector.value,units,seconds:Number($('time-limit').value),caps};
    save(); summary(); dialog.close();
  };
  summary();
}
function validCaps(c) { return Array.isArray(c) && c.length===3 && c.every((v,i)=>Number.isInteger(v)&&v>(i?c[i-1]:60)&&v<=120); }
function summary() {
  const b=books.find(b=>b.id===settings.book);
  const units=b.units.filter(u=>settings.units.includes(u.topic));
  $('scope-summary').textContent=b.name+' · '+units.map(u=>u.label).join('、')+' ｜ '+'連答自動升級'+' · 每題 '+settings.seconds+' 秒';
}
function bindPress(panel, onAction, signal) {
  const active = new Set();
  const button = e => e.target.closest('button[data-action]');
  panel.addEventListener('pointerdown', e => {
    const b=button(e); if (!b || b.disabled || e.button!==0 || active.has(e.pointerId)) return;
    e.preventDefault(); active.add(e.pointerId); panel.setPointerCapture(e.pointerId); onAction(b);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) panel.addEventListener(type,e=>active.delete(e.pointerId));
  window.addEventListener('blur', () => active.clear(), {signal});
  document.addEventListener('visibilitychange', () => { if (document.hidden) active.clear(); }, {signal});
  panel.addEventListener('click',e=>{ const b=button(e); if(b&&!b.disabled && (e.detail===0 || !window.PointerEvent)) onAction(b); });
  panel.oncontextmenu=e=>e.preventDefault();
}
let bindings;
export function startQuestions(views) {
  bindings?.abort(); bindings=new AbortController();
  const b=books.find(b=>b.id===settings.book);
  const units=shuffle(b.units.filter(u=>settings.units.includes(u.topic))).map(u=>({...u, questions:shuffle(bank[u.topic])}));
  const grid=$('quiz-grid');grid.replaceChildren();grid.style.setProperty('--lanes',views.length);panes=[];
  const instruments=$('race-instruments'), effectsGrid=$('quiz-effects');
  instruments.replaceChildren(); effectsGrid.replaceChildren();
  instruments.style.setProperty('--lanes',views.length);
  effectsGrid.style.setProperty('--lanes',views.length);
  laneList=views.map((view,i)=>{
    const historyKey = 'rail-quiz-recent:' + i;
    let recent = {};
    try { recent = JSON.parse(sessionStorage.getItem(historyKey)) || {}; } catch {}
    const lane=new QuizLane(units,settings.seconds,settings.caps,i,recent);
    const panel=document.createElement('section');panel.className='quiz-card';
    panel.style.setProperty('--team', ['#88dece','#ffbc80','#a3caff'][i]);
    panel.innerHTML='<header><b class="seat"></b><strong class="rank"></strong><span class="meter"></span></header><div class="progress" role="progressbar" aria-label="賽程進度"></div><div class="q-info"><span class="unit"></span><b class="clock"></b></div><p class="prompt" aria-live="polite"></p><div class="answers"></div><div class="hint-row"><button data-action="hint">提示 −10 秒</button><span class="note"></span></div>';
    panel.querySelector('.seat').textContent=['一號車','二號車','三號車'][i];
    const buttons=[];
    for (let j=0;j<6;j++){const btn=document.createElement('button');btn.dataset.action=String(j);panel.querySelector('.answers').append(btn);buttons.push(btn);}
    const part=sel=>panel.querySelector(sel);
    const pane={panel,buttons,recent,historyKey,lastNumber:0,revision:-1,prompt:part('.prompt'),unit:part('.unit'),clock:part('.clock'),meter:part('.meter'),bar:part('.progress'),rank:part('.rank'),hint:part('[data-action=hint]'),note:part('.note'),answers:part('.answers')};
    const team=panel.style.getPropertyValue('--team');
    const dash=document.createElement('section');
    dash.className='race-dash'; dash.style.setProperty('--team',team);
    dash.innerHTML='<div class="dial elapsed"><small>用時</small><div><b></b> 秒</div></div><div class="dial speed"><small class="cloud-boost" hidden></small><em hidden>JET <span class="jet-level"></span> · <span class="jet-time"></span> 秒</em><div><b></b> km/h</div></div>';
    pane.time=dash.querySelector('.elapsed b'); pane.speed=dash.querySelector('.speed b'); pane.jet=dash.querySelector('em');
    pane.jetLevel=dash.querySelector('.jet-level'); pane.jetTime=dash.querySelector('.jet-time');
    pane.cloud=dash.querySelector('.cloud-boost');
    pane.effects=document.createElement('div');
    effectsGrid.append(pane.effects);
    instruments.append(dash);
    panes.push(pane);grid.append(panel);
    bindPress(panel, button => {
      if (!isLive() || lane.phase !== 'question') return;
      const action = button.dataset.action;
      if (action === 'hint') {
        lane.hint();
        drawQuestions(views);
        return;
      }
      const result = lane.settle(lane.options[Number(action)]);
      drawQuestions(views);
      if (result) showAnswerEffect(pane, view, button, result, i, views.length);
    }, bindings.signal);
    view.quiz=lane; return lane;
  });
  drawQuestions(views);
}
export function stopQuizEffects(views) { clearAnswerEffects(panes, views); }

export function drawQuestions(views) {
  const distances = laneList.map((lane, i) => lane.distance / views[i].rig.raceLength);
  for (const {lane, rank} of raceStandings(laneList.map(lane => lane.finished), distances)) {
    const label = panes[lane].rank;
    if (label.dataset.rank !== String(rank)) {
      label.dataset.rank = rank;
      label.textContent = ordinal[rank - 1];
      label.setAttribute('aria-label', '第 ' + rank + ' 名');
    }
  }
  laneList.forEach((lane,i)=>{
    const p=panes[i], length=views[i].rig.raceLength, remaining=Math.max(0,lane.until-lane.clock);
    const progress = (100 * Math.min(1, Math.max(0, distances[i]))).toFixed(2);
    p.bar.style.setProperty('--progress', progress + '%');
    if (p.progress !== Math.round(progress)) {
      p.progress = Math.round(progress);
      p.bar.setAttribute('aria-valuenow', p.progress);
    }
    p.time.textContent=(lane.finished ?? lane.clock).toFixed(1);
    p.speed.textContent=Math.round(lane.speed);
    const tier = lane.boostTier;
    const cloud = lane.cloudBonus;
    const outline = cloud ? '#57e767' : JET_FLAME_COLORS[tier - 1]?.[0];
    if (outline !== p.outline) {
      p.outline = outline;
      p.speed.toggleAttribute('data-boost', Boolean(outline));
      if (outline) p.speed.style.setProperty('--speed-outline', outline);
      else p.speed.style.removeProperty('--speed-outline');
    }
    p.cloud.hidden = !cloud;
    if (cloud) {
      const label = '雲朵 +' + cloud + ' · ' + Math.ceil(lane.cloudUntil - lane.clock) + ' 秒';
      if (p.cloud.textContent !== label) p.cloud.textContent = label;
    }
    p.jet.hidden = !tier;
    if (tier) {
      const seconds = String(Math.ceil(Math.max(0, lane.ends.at(-1) - lane.clock)));
      if (p.jet.dataset.tier !== String(tier)) {
        p.jet.dataset.tier = tier;
        p.jetLevel.textContent = tier;
      }
      if (p.jetTime.textContent !== seconds) p.jetTime.textContent = seconds;
    }
    p.meter.textContent=(lane.distance/1000).toFixed(2)+' / '+(length/1000).toFixed(1)+' km';
    p.clock.textContent=lane.phase==='finished'?'完賽':Math.ceil(remaining)+' 秒';
    if (p.revision===lane.revision) return;
    p.revision=lane.revision;
    p.panel.dataset.effect=lane.phase==='feedback' ? (lane.result.ok?'correct':'miss') : lane.phase;
    p.unit.textContent=lane.number?'第 '+lane.number+' 題 · LV '+lane.level+' '+names[lane.level-1]+' · '+lane.unit:'準備出發';
    const asking = lane.phase === 'question';
    const submitted = lane.phase === 'feedback' && lane.result.choice !== null;
    p.answers.hidden = !asking && !submitted;
    p.hint.hidden = !asking;
    p.hint.disabled = lane.hinted;
    p.buttons.forEach((button, index) => {
      button.setAttribute('aria-disabled', String(!asking));
      if (submitted && lane.options[index] === lane.result.choice) {
        button.dataset.mark = lane.result.ok ? 'correct' : 'wrong';
      } else delete button.dataset.mark;
    });
    p.note.textContent='';
    if(lane.phase==='question'){
      if (p.lastNumber !== lane.number) {
        const key = lane.topic + '/' + lane.level;
        p.recent[key] = [...(p.recent[key] ?? []).filter(text => text !== lane.question.prompt), lane.question.prompt].slice(-12);
        p.lastNumber = lane.number;
        try { sessionStorage.setItem(p.historyKey, JSON.stringify(p.recent)); } catch {}
      }
      p.prompt.textContent=lane.question.prompt;p.answers.style.setProperty('--choices', lane.options.length);
      p.buttons.forEach((btn,j) => {
        btn.hidden = j >= lane.options.length;
        btn.textContent = btn.hidden ? '' : lane.options[j];
      });
      if(lane.hinted)p.note.textContent=lane.question.hint;
    }else if(lane.phase==='feedback'){
      p.prompt.textContent=lane.feedback;p.note.textContent=lane.question.hint+'　下一題即將進站。';
    }else if(lane.phase==='finished'){
      playRaceSound('finish', i, views.length);
      p.prompt.textContent='抵達終點 · '+lane.finished.toFixed(2)+' 秒';p.note.textContent='本場答對 '+lane.correct+' 題';
    }else p.prompt.textContent='出發後第 8 秒出題';
  });
}
