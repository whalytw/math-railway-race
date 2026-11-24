import * as THREE from 'three';

const portalFragment = `
  varying vec2 uvPortal;
  varying vec4 portalClip;
  uniform sampler2D previewMap;
  uniform float previewReady, transmission;
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
    vec2 screen = .5 + .5 * portalClip.xy / portalClip.w;
    vec2 warp = .009 * p * sin(swirl * 3. + r * 33.) * smoothstep(.30, .59, r);
    vec3 preview = texture2D(previewMap, clamp(screen + warp, .0, 1.)).rgb;
    #ifdef TONE_MAPPING
      preview = mix(preview, toneMapping(preview), smoothstep(.16, .57, max(preview.r, max(preview.g, preview.b))));
    #endif
    light += core * preview * transmission * previewReady;
    float alpha=max(core,max(bend*.94,outer*.67+dust*.24+shards*.7));
    alpha*=1.-smoothstep(.88,.994,r);
    gl_FragColor=vec4(light,clamp(alpha,0.,1.));
    #include <colorspace_fragment>
  }
`;


function gateFrame(sample) {
  const origin = new THREE.Vector3(sample.x, sample.y, sample.z);
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.pitch, sample.yaw, 0, 'YXZ'));
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
  const basis = new THREE.Matrix4().compose(origin, orientation, new THREE.Vector3(1, 1, 1));
  return {origin, forward, basis};
}

const mappedRotation = new THREE.Quaternion();

function mapCamera(source, transform, destination, space) {
  destination.copy(source, false);
  destination.position.applyMatrix4(transform);
  destination.quaternion.premultiply(mappedRotation.setFromRotationMatrix(transform));
  destination.far = space ? 12000 : 18000;
  destination.updateProjectionMatrix();
  destination.updateMatrixWorld();
  return destination;
}

export function linkPortal(outdoorSample, spaceSample, outdoor, space, entering) {
  const outside = gateFrame(outdoorSample), inside = gateFrame(spaceSample);
  const inwards = new THREE.Matrix4().multiplyMatrices(inside.basis, outside.basis.clone().invert());
  return {outside, inside, inwards, outwards: inwards.clone().invert(), outdoor, space, entering};
}

export class RiftPortals {
  constructor(own, count) {
    this.geometry = own(new THREE.PlaneGeometry(2, 2));
    this.previews = Array.from({length: count}, () => ({
      target: own(new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType})),
      source: null, lastAt: -Infinity, nextAt: -Infinity,
    }));
    this.clock = {value: 0};
    this.mappedCamera = new THREE.PerspectiveCamera();
    this.previewCamera = new THREE.PerspectiveCamera();
    this.clip = new THREE.Plane();
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.farBudget = 1;
  }

  add(parent, frame, radius, facesAhead, own, name) {
    const material = own(new THREE.ShaderMaterial({
      uniforms: {clock: this.clock, previewMap: {value: null},
        previewReady: {value: 0}, transmission: {value: .56}},
      transparent: true, depthWrite: false,
      vertexShader: `
        varying vec2 uvPortal;
        varying vec4 portalClip;
        void main() {
          uvPortal = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          portalClip = gl_Position;
        }
      `,
      fragmentShader: portalFragment,
    }));
    const portal = new THREE.Mesh(this.geometry, material);
    portal.name = name;
    portal.position.set(frame.x, frame.y + radius * .13, frame.z);
    portal.rotation.set(frame.pitch, frame.yaw, 0, 'YXZ');
    if (!facesAhead) portal.rotateY(Math.PI);
    portal.scale.setScalar(radius);
    portal.renderOrder = 9;
    parent.add(portal);
    return {mesh: portal, radius, tx: frame.tx, tz: frame.tz, bounds: new THREE.Sphere(portal.position, radius)};
  }

  cameraFor(view, link, distance) {
    const space = Boolean(view.riftTrack);
    const camera = view.camera;
    camera.updateMatrixWorld();
    if (!link) return {camera, space};

    const frame = space ? link.inside : link.outside;
    const signedDepth = frame.forward.dot(camera.position) - frame.forward.dot(frame.origin);
    // The trailing camera changes scenes when it passes the gate itself.
    if (Math.abs(distance) < 42 && (signedDepth >= -camera.near ? link.entering : !link.entering) !== space) {
      const mapped = mapCamera(camera, space ? link.outwards : link.inwards, this.mappedCamera, !space);
      return {camera: mapped, space: !space, link};
    }
    return {camera, space, link};
  }

  sizePreview(renderer, preview, viewportWidth, windowHeight) {
    const ratio = renderer.getPixelRatio();
    const width = Math.max(112, Math.min(512, Math.round(viewportWidth * ratio * .66 / 8) * 8));
    const height = Math.max(144, Math.min(480, Math.round(windowHeight * ratio * .39 / 8) * 8));
    const {target} = preview;
    if (width === target.width && height === target.height) return;
    target.setSize(width, height);
    preview.source = null;
  }

  beginFrame() { this.farBudget = 1; }

  reset() {
    for (const preview of this.previews) preview.source = null;
  }

  async prepare(renderer, viewportWidth, windowHeight, jobs) {
    for (const preview of this.previews) {
      this.sizePreview(renderer, preview, viewportWidth, windowHeight);
      renderer.initRenderTarget(preview.target);
    }
    const previous = renderer.getRenderTarget(), planes = renderer.clippingPlanes, shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    const compiled = new Set();
    try {
      for (const {scene, camera, gate, configure} of jobs) {
        renderer.setRenderTarget(this.previews[0].target);
        renderer.clippingPlanes = [this.clip.setFromNormalAndCoplanarPoint(gate.forward, gate.origin)];
        configure();
        // Real offscreen draws link programs with the destination clip plane.
        renderer.render(scene, camera);
        if (!compiled.has(scene)) await renderer.compileAsync(scene, camera);
        renderer.clippingPlanes = [];
        renderer.setRenderTarget(null);
        // Exercise the real canvas pipeline as well. Its tone mapping and
        // unclipped shaders differ from the half-float preview pipeline.
        renderer.render(scene, camera);
        if (!compiled.has(scene)) await renderer.compileAsync(scene, camera);
        compiled.add(scene);
      }
    } finally {
      renderer.setRenderTarget(previous);
      renderer.clippingPlanes = planes;
      renderer.shadowMap.enabled = shadows;
    }
  }

  preview(renderer, renderView, index, viewportWidth, windowHeight, seconds, configure, outdoors, indoors, viewDistance) {
    const {camera, space, link} = renderView;
    if (!link || space === link.entering) return null;
    const source = space ? link.space : link.outdoor;
    const frame = space ? link.inside : link.outside;
    const depth = frame.forward.dot(frame.origin) - frame.forward.dot(camera.position);
    const usefulDistance = space ? Math.min(380, viewDistance) + source.radius * .35 : viewDistance + source.radius;
    if (depth < .01 || depth > usefulDistance) return null;
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (!this.frustum.intersectsSphere(source.bounds)) return null;

    const cached = this.previews[index];
    this.sizePreview(renderer, cached, viewportWidth, windowHeight);
    // A distant opening refreshes at 10–20 Hz, staggered across the views.
    // The near view refreshes every frame, preserving rail alignment at the seam.
    const interval = depth > 225 ? 1 / 10 : 1 / 20, phase = index * interval / this.previews.length;
    const near = depth < 56;
    const needsRefresh = cached.source !== source || (seconds !== cached.lastAt && (near || seconds >= cached.nextAt));
    if (needsRefresh && (near || this.farBudget)) {
      if (!near) this.farBudget--;
      const destination = space ? link.outside : link.inside;
      const portalCamera = mapCamera(camera, space ? link.outwards : link.inwards, this.previewCamera, !space);
      this.clip.setFromNormalAndCoplanarPoint(destination.forward, destination.origin);
      const target = renderer.getRenderTarget();
      const clipPlanes = renderer.clippingPlanes, shadows = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = false;
      renderer.clippingPlanes = [this.clip];
      const destinationPortal = space ? link.outdoor : link.space;
      const visible = destinationPortal.mesh.visible;
      destinationPortal.mesh.visible = false;
      try {
        renderer.setRenderTarget(cached.target);
        configure(portalCamera, !space, destination);
        renderer.render(space ? outdoors : indoors, portalCamera);
      } finally {
        destinationPortal.mesh.visible = visible;
        renderer.setRenderTarget(target);
        renderer.clippingPlanes = clipPlanes;
        renderer.shadowMap.enabled = shadows;
      }
      cached.source = source;
      cached.lastAt = seconds;
      cached.nextAt = (Math.floor((seconds + phase) / interval) + 1) * interval - phase;
    }

    if (cached.source !== source) return null;
    const {uniforms} = source.mesh.material;
    uniforms.previewMap.value = cached.target.texture;
    uniforms.previewReady.value = 1;
    uniforms.transmission.value = THREE.MathUtils.lerp(.98, .56, THREE.MathUtils.smoothstep(depth, 1, 31));
    return uniforms;
  }
}
