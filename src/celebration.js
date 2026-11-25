import * as THREE from 'three';
import { randomGenerator } from './core.js?v=13.0.0';

export const GOAL_ARCH = 'Environment_Desert_SandstoneArch9m_001';

export function buildGoals(world) {
  return world.carts.map(rig => {
    const goal = rig.track.sample(rig.departure + rig.raceLength);
    const arch = world.store.get(GOAL_ARCH).root.clone(true);
    arch.name = 'GoalArch';
    arch.position.set(goal.x, goal.y, goal.z);
    arch.rotation.y = goal.yaw;
    arch.scale.set(1.12, 1.18, 1);
    const sign = world.makeLabel('GOAL', world.carts.length === 1 ? '終 點' : ['一號車終點', '二號車終點', '三號車終點'][rig.laneIndex]);
    sign.position.set(0, 4.85, 0); sign.scale.set(5, 1.6, 1);
    arch.add(sign);
    world.airspace?.addBounds(new THREE.Box3().setFromObject(arch));
    world.group.add(arch);
    return {...goal, finish: true};
  });
}

// Each station submits one batch of coloured cubes. A single clock drives all jumps.
export function buildFans(world, goals) {
  const random = randomGenerator(world.config.seed + ':station-fans');
  const material = new THREE.MeshLambertMaterial();
  world.ownedMaterials.push(material);
  world.cheerClock = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.cheerTime = world.cheerClock;
    shader.vertexShader = 'uniform float cheerTime; attribute float beat;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 fan = instanceMatrix * vec4(transformed, 1.);
      float hop = max(0., sin(cheerTime * (4. + .12 * beat) + beat));
      fan.y += .43 * hop;
      vec4 mvPosition = modelViewMatrix * fan;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  const coats = ['#f6eee1','#b78154','#efb076','#c3ad96','#f7d788'];
  const local = new THREE.Object3D(), pose = new THREE.Object3D();
  for (const station of [...world.stations, ...goals]) {
    const blocks = [], phases = [];
    const count = 13 + Math.floor(random() * 4);
    const passes = station.passes ?? [station];
    for (let i = 0; i < count; i++) {
      const pass = passes[i % passes.length];
      const side = world.route.lanes && !station.finish ? 1 : i % 2 ? -1 : 1;
      const along = station.finish ? (Math.floor(i / 2) - 3) * 2.5 + random() : (i % 2 ? -1 : 1) * (18 + (i >> 1) * 2.4 + random() * 1.5);
      const offset = (station.finish ? 6 + random() * 2 : 8 + random() * 7) * side;
      let x = pass.x + pass.tx * along + pass.nx * offset;
      let z = pass.z + pass.tz * along + pass.nz * offset;
      if (station.finish) {
        // A second track can run beside the finish or cross it diagonally.
        for (let attempt = 0; attempt < 24 && world.route.distanceTo(x,z,10) < 3; attempt++) {
          const lateral = (attempt % 2 ? -1 : 1) * (5 + random() * 9);
          const forward = along + (random() - .5) * 14;
          x = pass.x + pass.tx * forward + pass.nx * lateral;
          z = pass.z + pass.tz * forward + pass.nz * lateral;
        }
      }
      if (world.route.distanceTo(x,z,10) < 3) continue;
      pose.position.set(x,world.groundHeight(x,z)+.03,z);
      pose.rotation.y = Math.atan2(-pass.nx * side,-pass.nz * side) + (random()-.5)*.6;
      pose.scale.setScalar(1.1 + random()*.55); pose.updateMatrix();
      const phase = random()*6.28, coat = coats[Math.floor(random()*coats.length)];
      function cube(x,y,z,w,h,d,color) {
        local.position.set(x,y,z); local.scale.set(w,h,d); local.updateMatrix();
        blocks.push({matrix:pose.matrix.clone().multiply(local.matrix),color}); phases.push(phase);
      }
      const bunny = i % 3 === 0, bear = i % 3 === 1;
      cube(0,.49,0,.72,.69,.67,coat);
      cube(0,1,.08,.77,.63,.7,coat);
      for (const sign of [-1,1]) {
        cube(sign*.24,.14,.1,.24,.28,.43,coat);
        cube(sign*.24,bunny?1.55:1.35,.05,bear?.24:.17,bunny?.62:.22,.22,coat);
        cube(sign*.19,1.06,.44,.09,.11,.035,'#312a2a');
        cube(sign*.42,.81,.04,.2,.36,.28,coat);
      }
      cube(0,.9,.46,.21,.14,.12,bear?'#50372e':'#e99893');
    }
    const geometry = new THREE.BoxGeometry();
    geometry.setAttribute('beat', new THREE.InstancedBufferAttribute(new Float32Array(phases),1));
    world.ownedGeometry.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry,material,blocks.length);
    blocks.forEach(({matrix,color},i) => {mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(color));});
    mesh.name=station.finish ? 'GoalFans' : 'StationFans'; mesh.computeBoundingSphere(); mesh.boundingSphere.radius+=.5;
    world.group.add(mesh);
  }
}

// Project the smile onto this animal's muzzle, including models with long noses.
export function finishSmile(world, driver) {
  const {min,max} = driver.userData.driver.bounds;
  const width = max[0]-min[0], height = max[1]-min[1];
  driver.updateWorldMatrix(true,true);
  const cast = new THREE.Raycaster(), direction = new THREE.Vector3(0,0,-1).transformDirection(driver.matrixWorld);
  const meshes = []; driver.traverse(node => {if(node.isMesh) meshes.push(node);});
  // Body-local muzzle heights account for long ears, antlers and tails.
  const muzzleHeights = {"Beaver": 0.412, "Bee": 0.741, "Bunny": 0.412, "Caterpillar": 0.409, "Cat": 0.296, "Chick": 0.412, "Cow": 0.318, "Crab": 0.398, "Deer": 0.412, "Dog": 0.369, "Elephant": 0.35, "Fish": 0.369, "Fox": 0.401, "Giraffe": 0.412, "Hog": 0.367, "Koala": 0.288, "Lion": 0.287, "Monkey": 0.365, "Panda": 0.375, "Parrot": 0.227, "Penguin": 0.465, "Pig": 0.356, "Polar": 0.351, "Tiger": 0.405};
  const muzzleY = muzzleHeights[driver.userData.driver.id.split('_')[2]];
  const body = driver.getObjectByName('body');
  const mouthY = body && muzzleY != null
    ? driver.worldToLocal(body.localToWorld(new THREE.Vector3(0,muzzleY,0))).y
    : min[1] + height*.3;
  const points = [];
  for (let i=0;i<=12;i++) {
    const t=i/6-1, x=t*width*.18, y=mouthY+width*.072*t*t;
    const origin=driver.localToWorld(new THREE.Vector3(x,y,max[2]+.25));
    cast.set(origin,direction);
    const hit=cast.intersectObjects(meshes,false)[0];
    const z=hit ? driver.worldToLocal(hit.point).z : max[2];
    points.push(new THREE.Vector3(x,y,z+.028));
  }
  const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),18,width*.022,5,false);
  const material=new THREE.MeshBasicMaterial({color:'#562b36'});
  const smile=new THREE.Mesh(geometry,material); smile.visible=false;
  driver.add(smile); world.ownedGeometry.push(geometry); world.ownedMaterials.push(material);
  return smile;
}
