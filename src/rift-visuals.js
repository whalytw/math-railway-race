import * as THREE from 'three';
import {TAU} from './core.js?v=13.0.0';
import {nebulaTexture} from './rift-nebulas.js?v=27';

export function addDeepSky(scene, length, random, own) {
  const sky = nebulaTexture(own);
  const clock = {value: 0};
  const globe = new THREE.Mesh(own(new THREE.SphereGeometry(5700, 32, 20)), own(new THREE.ShaderMaterial({
    uniforms: {cloudMap: {value: sky.map}, clock, focus: sky.focus},
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
    vertexShader: `
      varying vec2 domeUV;
      void main() {
        domeUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      varying vec2 domeUV;
      uniform sampler2D cloudMap;
      uniform float clock, focus;
      float hash(float x) { return fract(sin(x * 173.83) * 43758.5453); }
      float distToSegment(vec2 point, vec2 a, vec2 b) {
        vec2 path = b - a, local = point - a;
        return length(local - path * clamp(dot(local, path) / dot(path, path), 0., 1.));
      }
      void main() {
        float drift = clock * .075;
        vec2 uv = domeUV;
        vec2 waves = vec2(sin(uv.y * 22. + drift), cos(uv.x * 29. - drift * .73));
        vec3 color = texture2D(cloudMap, uv + .011 * waves).rgb;
        vec3 mist = texture2D(cloudMap, uv - .013 * waves.yx).rgb;
        color = mix(color, mist, .28 + .12 * sin(uv.x * 22. + drift));

        float eventTime = clock / 10.6;
        float eventId = floor(eventTime);
        float age = fract(eventTime) * 10.6 - (1.8 + hash(eventId + 64.) * 6.);
        vec2 origin = vec2(focus + (hash(eventId + 21.) - .5) * .105, .617 + hash(eventId + 8.) * .095);
        if (age > 0. && age < .6 && distance(uv, origin) < .055) {
          vec2 p = uv - origin;
          vec2 joint = vec2(.007, -.008);
          float bolt = min(distToSegment(p, vec2(0.), joint), distToSegment(p, joint, vec2(.011, -.027)));
          bolt = min(bolt, distToSegment(p, joint, vec2(-.002, -.022)) + .00055);
          float flicker = (1. - smoothstep(.07, .6, age)) * (.72 + .28 * sin(age * 49.));
          float cloud = smoothstep(.025, .15, max(color.r, max(color.g, color.b)));
          color += vec3(.61, .71, 1.) * cloud * flicker
            * (.43 * exp(-bolt * 770.) + .075 * exp(-bolt * 103.));
        }
        gl_FragColor = vec4(color, 1.);
        #include <colorspace_fragment>
      }
    `,
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
  return {pixelRatio: material.uniforms.pixelRatio, show: sky.show, clock};
}
