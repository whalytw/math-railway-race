import * as THREE from 'three';
import {lerp, smoothstep, TAU} from './core.js?v=13.0.0';
import {ZODIAC_FIGURES} from './zodiac-figures.js?v=25';
import {ZODIAC_STARS} from './zodiac-stars.js?v=25';

const HUES = ['#9adfff', '#bdc7ff', '#a8e7ed', '#ced9ff', '#ffdfa9', '#c9dfff'];
const SLOTS = 3;
const FIGURE_CHANCE = .63;
const FADE_IN = .85;
const FADE_OUT = 1.08;
const newAttribute = (count) => new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);

function readStrokes(path) {
  return path.split('|').map(line => line.split(' ').map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return [(x - 50) / 48, (50 - y) / 48];
  }));
}

function segments(lines) {
  return lines.flatMap(line => line.slice(1).flatMap((point, i) => [line[i], point]));
}

const cards = ZODIAC_FIGURES.map(({id, body, joints}, index) => {
  const chart = ZODIAC_STARS[id];
  const stars = [...new Map(chart.flat().map(point => [point.join(','), point])).values()];
  return {
    id, colour: HUES[index % HUES.length], body: segments(readStrokes(body)),
    lines: segments(chart), stars, joints: joints.map(([x, y, amplitude, path]) => ({
      x: (x - 50) / 48, y: (50 - y) / 48, amplitude, vertices: segments(readStrokes(path)),
    })),
  };
});

const edgeCount = Math.max(...cards.map(card => card.body.length + card.lines.length + card.joints.reduce((n, joint) => n + joint.vertices.length, 0)));
const starCount = Math.max(...cards.map(card => card.stars.length));
const pulse = u => .5 + .5 * Math.sin(u);

class ZodiacSlot {
  constructor(parent, own, index) {
    this.index = index;
    this.group = new THREE.Group();
    this.group.name = 'ZodiacProjection';
    this.group.visible = false;
    this.pose = new THREE.Quaternion();
    this.anchor = new THREE.Vector3();
    this.drift = new THREE.Vector3();
    parent.add(this.group);

    const lines = own(new THREE.BufferGeometry());
    this.outline = newAttribute(edgeCount);
    this.lineColors = new THREE.BufferAttribute(new Float32Array(edgeCount * 3), 3);
    lines.setAttribute('position', this.outline);
    lines.setAttribute('color', this.lineColors);
    this.lineMaterial = own(new THREE.LineBasicMaterial({
      transparent: true, depthWrite: false, fog: false, toneMapped: false, vertexColors: true, blending: THREE.AdditiveBlending,
    }));
    this.lines = new THREE.LineSegments(lines, this.lineMaterial);
    this.lines.frustumCulled = false;

    const points = own(new THREE.BufferGeometry());
    this.points = newAttribute(starCount);
    points.setAttribute('position', this.points);
    this.starMaterial = own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: {tint: {value: new THREE.Color()}, alpha: {value: 0}, ratio: {value: 1}, phase: {value: 0}},
      vertexShader: `
        uniform float phase,ratio;
        varying float glow;
        void main(){
          glow=.65+.35*sin(phase+dot(position.xy,vec2(4.5,6.1)));
          vec4 mv=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*mv;
          gl_PointSize=max(2.2,ratio*(2.8+3.2*glow));
        }
      `,
      fragmentShader: `
        varying float glow;
        uniform float alpha;
        uniform vec3 tint;
        void main(){
          vec2 p=gl_PointCoord*2.-1.;
          float r=length(p);
          float light=exp(-5.8*r*r)*(1.-smoothstep(.76,1.,r));
          float ray=exp(-19.*min(abs(p.x),abs(p.y)))*exp(-3.*r);
          gl_FragColor=vec4(tint,alpha*(.71*light+.44*ray)*(.63+.37*glow));
          #include <colorspace_fragment>
        }
      `,
    }));
    const stars = new THREE.Points(points, this.starMaterial);
    stars.frustumCulled = false;
    this.group.add(this.lines, stars);
    this.stars = stars;
  }

  start(card, variant, camera, seconds, random) {
    const depth = lerp(240, 420, random());
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
    const size = Math.min(lerp(28, 50, random()) * (depth / 320) ** .36, depth * halfWidth * .25);
    const side = ((this.index - 1) * .49 + (random() - .5) * .12) * halfWidth;
    const elevation = lerp(.21, .37, random()) - .14 * (this.index % 2);
    this.drift.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.anchor.set(side * depth, elevation * depth, -depth).applyQuaternion(camera.quaternion).add(camera.position);
    this.pose.copy(camera.quaternion);
    this.size = size;
    this.card = card;
    this.variant = variant;
    this.starts = seconds;
    // The 6–10 second display includes the fade-in. The exit fades separately.
    this.ends = seconds + lerp(6, 10, random()) + FADE_OUT;
    this.next = this.ends + 1;
    this.group.visible = true;

    const colour = new THREE.Color(card.colour);
    const uniforms = this.starMaterial.uniforms;
    uniforms.tint.value.copy(colour);
    let index = 0;
    for (let i = 0; i < card.body.length; i++, index++) this.lineColors.setXYZ(index, colour.r, colour.g, colour.b);
    for (const joint of card.joints) for (const _vertex of joint.vertices) {
      this.lineColors.setXYZ(index++, colour.r, colour.g, colour.b);
    }
    for (const _vertex of card.lines) this.lineColors.setXYZ(index++, .42, .66, .9);
    this.lineColors.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, index);
    for (const [i, [x, y]] of card.stars.entries()) this.points.setXYZ(i, x, y, .035);
    this.points.needsUpdate = true;
    this.stars.geometry.setDrawRange(0, card.stars.length);
  }

  hide() {
    this.group.visible = false;
    this.card = null;
  }

  draw(seconds, ratio, reducedMotion) {
    const time = seconds - this.starts;
    const alpha = smoothstep(0, FADE_IN, time) * (1 - smoothstep(this.ends - FADE_OUT, this.ends, seconds));
    const t = reducedMotion ? 0 : time;
    const {body, joints, lines} = this.card;
    const style = this.variant;
    const wave = TAU * t / [3.1, 4, 2.7][style];

    this.group.position.copy(this.anchor).addScaledVector(this.drift, Math.sin(wave) * (style === 0 ? 2.4 : 1.3));
    this.group.quaternion.copy(this.pose);
    this.group.rotateZ(style === 1 ? .115 * Math.sin(wave) : .036 * Math.sin(wave));
    this.group.scale.setScalar(this.size * (style === 2 ? 1 + .037 * Math.sin(wave) : 1));

    let i = 0;
    for (const [x, y] of body) this.outline.setXYZ(i++, x, y, 0);
    for (const [joint, {x, y, amplitude, vertices}] of joints.entries()) {
      const angle = amplitude * [.42, .96, .76][style] * Math.sin(wave + joint * (style === 1 ? Math.PI : 1.1));
      const c = Math.cos(angle), s = Math.sin(angle);
      for (const [px, py] of vertices) this.outline.setXYZ(i++, x + (px-x)*c - (py-y)*s, y + (px-x)*s + (py-y)*c, 0);
    }
    for (const [x, y] of lines) this.outline.setXYZ(i++, x, y, .02);
    this.outline.needsUpdate = true;

    this.lineMaterial.opacity = alpha * (.63 + .13 * pulse(wave + 1));
    const uniforms = this.starMaterial.uniforms;
    uniforms.alpha.value = alpha * (.84 + .16 * pulse(wave));
    uniforms.ratio.value = ratio;
    uniforms.phase.value = style === 2 ? wave * 2 : wave * .64;
  }
}

export class ZodiacSky {
  constructor(parent, own, random = Math.random) {
    this.random = random;
    this.slots = Array.from({length: SLOTS}, (_, i) => new ZodiacSlot(parent, own, i));
    this.reset();
  }

  reset() {
    for (const slot of this.slots) {
      slot.hide();
      slot.next = null;
    }
    this.deck = [];
  }

  nextCard() {
    if (!this.deck.length) this.deck = [...cards];
    const choices = this.deck.filter(card => this.slots.every(slot => slot.card !== card));
    const card = choices[Math.floor(choices.length * this.random())];
    if (card) this.deck.splice(this.deck.indexOf(card), 1);
    return card;
  }

  update(seconds, cameras, ratio, reducedMotion) {
    if (!cameras.length) return;
    for (const slot of this.slots) {
      if (slot.card && seconds >= slot.ends) slot.hide();
      if (slot.next === null) slot.next = seconds + 1.1 + slot.index * 1.65 + this.random() * 1.8;
      if (!slot.card && seconds >= slot.next) {
        slot.next = seconds + 1;
        if (this.random() < FIGURE_CHANCE) {
          const card = this.nextCard();
          if (card) slot.start(card, Math.floor(this.random() * 3), cameras[Math.floor(this.random() * cameras.length)], seconds, this.random);
        }
      }
      if (slot.card) slot.draw(seconds, ratio, reducedMotion);
    }
  }
}
