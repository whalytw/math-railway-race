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

function mapCamera(source, transform, destination, space) {
  destination.copy(source, false);
  destination.position.applyMatrix4(transform);
  destination.quaternion.premultiply(new THREE.Quaternion().setFromRotationMatrix(transform));
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
  constructor(own) {
    this.geometry = own(new THREE.PlaneGeometry(2, 2));
    this.target = own(new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType}));
    this.clock = {value: 0};
    this.mappedCamera = new THREE.PerspectiveCamera();
    this.previewCamera = new THREE.PerspectiveCamera();
    this.clip = new THREE.Plane();
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
  }

  add(parent, frame, radius, facesAhead, own, name) {
    const material = own(new THREE.ShaderMaterial({
      uniforms: {clock: this.clock, previewMap: {value: this.target.texture},
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

  preview(renderer, renderView, viewport, configure, outdoors, indoors, viewDistance) {
    const {camera, space, link} = renderView;
    if (!link || space === link.entering) return null;
    const source = space ? link.space : link.outdoor;
    const frame = space ? link.inside : link.outside;
    const depth = frame.forward.dot(frame.origin) - frame.forward.dot(camera.position);
    if (depth < .01 || depth > viewDistance + source.radius) return null;
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    if (!this.frustum.intersectsSphere(source.bounds)) return null;

    const destination = space ? link.outside : link.inside;
    const portalCamera = mapCamera(camera, space ? link.outwards : link.inwards, this.previewCamera, !space);
    // The same pixel rays continue from the gate into the destination scene.
    // Clip only destination geometry on the approach side of that gate.
    this.clip.setFromNormalAndCoplanarPoint(destination.forward, destination.origin);
    const ratio = renderer.getPixelRatio() * .8;
    this.target.setSize(Math.max(1, Math.round(viewport.width * ratio)), Math.max(1, Math.round(viewport.height * ratio)));
    const target = renderer.getRenderTarget();
    const clipPlanes = renderer.clippingPlanes, shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.clippingPlanes = [this.clip];
    const destinationPortal = space ? link.outdoor : link.space;
    const visible = destinationPortal.mesh.visible;
    destinationPortal.mesh.visible = false;
    try {
      renderer.setRenderTarget(this.target);
      configure(portalCamera, !space);
      renderer.render(space ? outdoors : indoors, portalCamera);
    } finally {
      destinationPortal.mesh.visible = visible;
      renderer.setRenderTarget(target);
      renderer.clippingPlanes = clipPlanes;
      renderer.shadowMap.enabled = shadows;
    }

    const {uniforms} = source.mesh.material;
    uniforms.previewReady.value = 1;
    uniforms.transmission.value = THREE.MathUtils.lerp(.98, .56, THREE.MathUtils.smoothstep(depth, 1, 31));
    return uniforms.previewReady;
  }
}
