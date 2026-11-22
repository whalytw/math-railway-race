import {DEFAULT_CAPS, QuizLane, shuffle} from './quiz-race.js?v=17';
const $ = id => document.getElementById(id);
const storageKey = 'math-railway-classroom-v1';
const names = ['基礎', '進階', '挑戰'];
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
  books.forEach(b => selector.add(new Option(b.name + ' · ' + b.source, b.id)));
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
function bindPress(panel, onAction) {
  const active = new Set();
  const button = e => e.target.closest('button[data-action]');
  panel.addEventListener('pointerdown', e => {
    const b=button(e); if (!b || b.disabled || e.button!==0 || active.has(e.pointerId)) return;
    e.preventDefault(); active.add(e.pointerId); panel.setPointerCapture(e.pointerId); onAction(b.dataset.action);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) panel.addEventListener(type,e=>active.delete(e.pointerId));
  window.addEventListener('blur',()=>active.clear(),{signal:panel.abortSignal});
  panel.addEventListener('click',e=>{ const b=button(e); if(b&&!b.disabled && (e.detail===0 || !window.PointerEvent)) onAction(b.dataset.action); });
  panel.oncontextmenu=e=>e.preventDefault();
}
let bindings;
export function startQuestions(views) {
  bindings?.abort(); bindings=new AbortController();
  const b=books.find(b=>b.id===settings.book);
  const units=shuffle(b.units.filter(u=>settings.units.includes(u.topic))).map(u=>({...u, questions:shuffle(bank[u.topic])}));
  const grid=$('quiz-grid');grid.replaceChildren();grid.style.setProperty('--lanes',views.length);panes=[];
  const map=$('race-map'), instruments=$('race-instruments');
  map.replaceChildren(); instruments.replaceChildren();
  instruments.style.setProperty('--lanes',views.length);
  laneList=views.map((view,i)=>{
    const historyKey = 'rail-quiz-recent:' + i;
    let recent = {};
    try { recent = JSON.parse(sessionStorage.getItem(historyKey)) || {}; } catch {}
    const lane=new QuizLane(units,settings.seconds,settings.caps,i,recent);
    const panel=document.createElement('section');panel.abortSignal=bindings.signal;panel.className='quiz-card';
    panel.style.setProperty('--team', ['#88dece','#ffbc80','#a3caff'][i]);
    panel.innerHTML='<header><b class="seat"></b><span class="meter"></span></header><div class="progress"><i></i></div><div class="q-info"><span class="unit"></span><b class="clock"></b></div><p class="prompt"></p><div class="answers"></div><div class="hint-row"><button data-action="hint">提示 −10 秒</button><span class="note"></span></div>';
    panel.querySelector('.seat').textContent=['一號車','二號車','三號車'][i];
    const buttons=[];
    for (let j=0;j<6;j++){const btn=document.createElement('button');btn.dataset.action=String(j);panel.querySelector('.answers').append(btn);buttons.push(btn);}
    const part=sel=>panel.querySelector(sel);
    const pane={panel,buttons,recent,historyKey,lastNumber:0,revision:-1,prompt:part('.prompt'),unit:part('.unit'),clock:part('.clock'),meter:part('.meter'),bar:part('.progress i'),hint:part('[data-action=hint]'),note:part('.note'),answers:part('.answers')};
    const team=panel.style.getPropertyValue('--team');
    const row=document.createElement('div');
    row.className='map-row'; row.style.setProperty('--team',team);
    row.innerHTML='<b></b><div class="map-track"><i class="cart-marker"><i></i></i></div>';
    row.querySelector('b').textContent=String(i+1);
    pane.marker=row.querySelector('.cart-marker');
    const vehicle=view.rig.vehicle;
    pane.marker.style.setProperty('--paint',vehicle.includes('AzureLake')?'#28beb6':vehicle.includes('GoldenOak')?'#ffbb43':'#ec694b');
    map.append(row);
    const dash=document.createElement('section');
    dash.className='race-dash'; dash.style.setProperty('--team',team);
    dash.innerHTML='<div class="dial elapsed"><small>用時</small><div><b></b> 秒</div></div><div class="dial speed"><em hidden></em><div><b></b> km/h</div></div>';
    pane.time=dash.querySelector('.elapsed b'); pane.speed=dash.querySelector('.speed b'); pane.jet=dash.querySelector('em');
    instruments.append(dash);
    panes.push(pane);grid.append(panel);
    bindPress(panel, action=>{if(!isLive() || lane.phase!=='question')return;if(action==='hint')lane.hint();else lane.settle(lane.options[Number(action)]);drawQuestions(views);});
    view.quiz=lane; return lane;
  });
  drawQuestions(views);
}
export function drawQuestions(views) {
  laneList.forEach((lane,i)=>{
    const p=panes[i], length=views[i].rig.raceLength, remaining=Math.max(0,lane.until-lane.clock);
    const progress=Math.min(1,Math.max(0,lane.distance/length));
    p.marker.style.left=(100*progress)+'%';
    p.time.textContent=(lane.finished ?? lane.clock).toFixed(1);
    p.speed.textContent=Math.round(lane.speed);
    p.jet.hidden=!lane.tier;
    p.jet.dataset.tier=lane.tier;
    p.jet.textContent=lane.tier?'JET '+lane.tier+' · '+Math.ceil(Math.max(0,lane.ends.at(-1)-lane.clock))+' 秒':'';
    p.meter.textContent=(lane.distance/1000).toFixed(2)+' / '+(length/1000).toFixed(1)+' km';
    p.bar.style.width=(100*lane.distance/length)+'%';
    p.clock.textContent=lane.phase==='finished'?'完賽':Math.ceil(remaining)+' 秒';
    if (p.revision===lane.revision) return;
    p.revision=lane.revision;
    p.panel.dataset.effect=lane.phase==='feedback' ? (lane.feedback.startsWith('答對')?'correct':'miss') : lane.phase;
    p.unit.textContent=lane.number?'第 '+lane.number+' 題 · LV '+lane.level+' '+names[lane.level-1]+' · '+lane.unit:'準備出發';
    p.answers.hidden=lane.phase!=='question';p.hint.hidden=lane.phase!=='question';p.hint.disabled=lane.hinted;
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
      p.prompt.textContent='抵達終點 · '+lane.finished.toFixed(2)+' 秒';p.note.textContent='本場答對 '+lane.correct+' 題';
    }else p.prompt.textContent='出發後第 8 秒出題';
  });
}
