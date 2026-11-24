import * as THREE from 'three';
import {clamp, smoothstep, TAU} from './core.js?v=13.0.0';
import {nebulaTexture} from './rift-nebulas.js?v=26';

export function addDeepSky(scene, length, random, own) {
  const sky = nebulaTexture(own);
  const globe = new THREE.Mesh(own(new THREE.SphereGeometry(5700, 32, 20)), own(new THREE.MeshBasicMaterial({
    map: sky.map, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
  })));
  globe.name = 'NebulaDome';
  globe.position.z = length * .5;
  globe.renderOrder = -100;
  scene.add(globe);

  const coordinates = [], colours = [], luminosity = [];
  const cool = new THREE.Color('#8dafff'), warm = new THREE.Color('#ffe0b6'), white = new THREE.Color('#eafbff');
  const colour = new THREE.Color();
  for (let i = 0; i < 3800; i++) {
    const azimuth = TAU * random(), y = 2 * random() - 1, horizontal = Math.sqrt(1 - y * y);
    const radius = 2700 + random() * 2500;
    coordinates.push(radius * Math.cos(azimuth) * horizontal, radius * y, radius * Math.sin(azimuth) * horizontal);
    const hot = random();
    colour.copy(white).lerp(hot < .77 ? cool : warm, random() * .75);
    colours.push(colour.r, colour.g, colour.b);
    const brightness = random();
    luminosity.push(i % 49 === 0 ? .96 + .19 * brightness : .17 + .65 * brightness ** 2.6);
  }
  const geometry = own(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setAttribute('tint', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('light', new THREE.Float32BufferAttribute(luminosity, 1));
  const material = own(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
    uniforms: {pixelRatio: {value: 1}},
    vertexShader: `
      attribute vec3 tint; attribute float light;
      varying vec3 starColor; varying float bright;
      uniform float pixelRatio;
      void main() {
        starColor = tint; bright = light;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        float brilliant = smoothstep(.82, 1.07, light);
        gl_PointSize = max(1.35, pixelRatio * (1.6 + 4.2 * light * light + 3.0 * brilliant));
      }
    `,
    fragmentShader: `
      varying vec3 starColor; varying float bright;
      void main(){
        vec2 p=gl_PointCoord*2.0-1.0;
        float r=length(p);
        float brightStar = smoothstep(.82, 1.06, bright);
        float rim = 1.0 - smoothstep(.7, 1.0, r);
        float core = exp(-7.2 * r * r);
        float halo = .28 * exp(-3.9 * r * r);
        float spikes = exp(-23.0 * min(abs(p.x), abs(p.y)) - 2.6 * r);
        float alpha = rim * bright * (core + brightStar * (halo + .82 * spikes));
        gl_FragColor = vec4(mix(starColor, vec3(1.), .38 * brightStar), min(1., alpha));
        #include <colorspace_fragment>
      }
    `,
  }));
  const stars = new THREE.Points(geometry, material);
  stars.name = 'DistantStars';
  stars.position.z = length * .5;
  stars.renderOrder = -80;
  scene.add(stars);
  return {pixelRatio: material.uniforms.pixelRatio, show: sky.show};
}

const portalFragment = `
  varying vec2 uvPortal;
  uniform float clock;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float arc(float r,float centre,float width){return exp(-pow((r-centre)/width,2.));}
  void main() {
    vec2 p=uvPortal*2.-1.;
    float r=length(p);
    if(r>.996)discard;
    float angle=atan(p.y,p.x);
    float swirl=angle+1.28/(.48+r)-clock*.19;
    float twistA=.52+.48*sin(swirl*3.+r*37.);
    float twistB=.52+.48*cos(swirl*7.+r*56.+clock*.21);
    float uneven=.017*sin(angle*2.+r*6.);
    float bend=arc(r,.571+uneven,.038);
    float outer=arc(r,.682+uneven*.8,.095)*(.37+.63*twistA);
    float thin=arc(r,.585+uneven,.008)*(.46+.54*twistB);
    float dust=arc(r,.623+.03*sin(swirl*5.),.093)*twistB;
    vec2 cells=vec2(swirl*17.,r*107.);
    vec2 local=fract(cells)-.5;
    float sparkle=pow(hash(floor(cells)),12.)*exp(-18.*dot(local,local));
    float shards=sparkle*arc(r,.678,.16);
    vec3 ice=vec3(.12,.36,1.), orchid=vec3(.49,.18,.8);
    vec3 tint=mix(ice,orchid,.48+.4*sin(swirl*2.));
    vec3 light=vec3(.001,.001,.005);
    light+=tint*(.30*bend+.39*outer+.37*dust+.9*shards);
    light+=vec3(.64,.81,1.)*(thin*.79+shards*.58);
    float core=1.-smoothstep(.52,.573,r);
    float alpha=max(core,max(bend*.94,outer*.67+dust*.24+shards*.7));
    alpha*=1.-smoothstep(.88,.994,r);
    gl_FragColor=vec4(light,clamp(alpha,0.,1.));
    #include <colorspace_fragment>
  }
`;

export function portalResources(own) {
  return {
    geometry: own(new THREE.PlaneGeometry(2, 2)),
    material: own(new THREE.ShaderMaterial({
      uniforms: {clock: {value: 0}}, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `
        varying vec2 uvPortal;
        void main(){uvPortal=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
      `,
      fragmentShader: portalFragment,
    })),
  };
}

export function addPortal(parent, frame, radius, facesAhead, resources, name) {
  const portal = new THREE.Mesh(resources.geometry, resources.material);
  portal.name = name;
  portal.position.set(frame.x, frame.y + radius * .13, frame.z);
  portal.rotation.y = frame.yaw + (facesAhead ? 0 : Math.PI);
  portal.scale.setScalar(radius);
  portal.renderOrder = 9;
  parent.add(portal);
  return {mesh: portal, radius, tx: frame.tx, tz: frame.tz};
}

export class PortalTransition {
  constructor(own) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.material = own(new THREE.ShaderMaterial({
      uniforms: {amount: {value: 0}, clock: {value: 0}, aspect: {value: 1}},
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `
        varying vec2 screen;
        void main(){screen=position.xy;gl_Position=vec4(position.xy,0.,1.);}
      `,
      fragmentShader: `
        varying vec2 screen;
        uniform float amount,clock,aspect;
        void main(){
          vec2 p=vec2(screen.x*aspect,screen.y);
          float r=length(p);
          float a=atan(p.y,p.x)+.48/max(.15,r)-clock*.22;
          float sheath=exp(-14.*pow(r-(1.36-amount*.7),2.))*(.66+.34*cos(a*5.+r*10.));
          float dissolve=smoothstep(.46,1.,amount);
          vec3 tint=mix(vec3(.002,.002,.009)+vec3(.055,.111,.51)*sheath,vec3(.0005,.0006,.003),dissolve);
          float opacity=amount*(.61+.39*smoothstep(.3,.92,r+amount*.62));
          gl_FragColor=vec4(tint,opacity);
          #include <colorspace_fragment>
        }
      `,
    }));
    const mask = new THREE.Mesh(own(new THREE.PlaneGeometry(2, 2)), this.material);
    mask.frustumCulled = false;
    this.scene.add(mask);
  }

  draw(renderer, offset, viewport, seconds, approach, reducedMotion) {
    const amount = 1 - smoothstep(.7, approach, Math.abs(offset));
    if (amount <= .001) return;
    const {uniforms} = this.material;
    uniforms.amount.value = clamp(amount, 0, 1);
    uniforms.clock.value = reducedMotion ? 0 : seconds;
    uniforms.aspect.value = viewport.width / viewport.height;
    const previous = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.scene, this.camera); }
    finally { renderer.autoClear = previous; }
  }
}
