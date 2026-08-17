import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const $=id=>document.getElementById(id);
const toast=(t,ms=2200)=>{$('toast').textContent=t;$('toast').style.display='block';clearTimeout(toast._t);toast._t=setTimeout(()=>$('toast').style.display='none',ms)};

const renderer=new THREE.WebGPURenderer({antialias:true});
let dpr=Math.min(devicePixelRatio,1.35);
renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);await renderer.init();
$('backend').textContent=renderer.backend?.isWebGPUBackend?'NATIVE WEBGPU':'WEBGL2 FALLBACK';

const scene=new THREE.Scene();scene.background=new THREE.Color(0x070a0f);scene.fog=new THREE.FogExp2(0x090d13,.004);
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.06,420);
new RGBELoader().load('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr',tex=>{tex.mapping=THREE.EquirectangularReflectionMapping;scene.environment=tex;scene.environmentIntensity=.62;},undefined,()=>{});
scene.add(new THREE.HemisphereLight(0x8095ad,0x07080a,.26));
const moon=new THREE.DirectionalLight(0xc6dcff,1.55);moon.position.set(-30,42,18);moon.castShadow=true;moon.shadow.mapSize.set(2048,2048);moon.shadow.camera.left=-45;moon.shadow.camera.right=45;moon.shadow.camera.top=45;moon.shadow.camera.bottom=-45;moon.shadow.camera.near=.5;moon.shadow.camera.far=160;moon.shadow.normalBias=.025;scene.add(moon);

// ---------------- Static collision world ----------------
// Each collider is an XZ AABB. Authored meshes are reduced to useful building/prop bounds,
// while giant ground/road meshes are excluded. The car itself is an oriented box and uses SAT.
const colliders=[];
const debugColliders=[];
function addColliderBox(minX,minZ,maxX,maxZ,tag='world'){
  if(maxX-minX<.15||maxZ-minZ<.15)return;
  colliders.push({minX,minZ,maxX,maxZ,tag});
}
function addMeshCollider(mesh){
  const box=new THREE.Box3().setFromObject(mesh);const sz=box.getSize(new THREE.Vector3());
  if(sz.y<.45)return; // roads, decals, curbs
  if(sz.x>70||sz.z>70)return; // giant floor-like meshes
  if(sz.x<.12||sz.z<.12)return;
  addColliderBox(box.min.x,box.min.z,box.max.x,box.max.z,mesh.name||'city');
}

const cityRoot=new THREE.Group();scene.add(cityRoot);const cityLoader=new GLTFLoader();
const CITY=['https://raw.githubusercontent.com/SpectraStudios/SourceCityToolkit_glb/main/Main_Intersection_v2.glb','https://cdn.jsdelivr.net/gh/SpectraStudios/SourceCityToolkit_glb@main/Main_Intersection_v2.glb'];let cityTry=0;
function loadCity(){
  if(cityTry>=CITY.length){$('asset').textContent='City failed · fallback blocks';buildFallbackCity();return;}
  const u=CITY[cityTry++];$('asset').textContent=`City loading ${cityTry}/${CITY.length}`;
  cityLoader.load(u,g=>{
    const root=g.scene;root.updateMatrixWorld(true);
    const preBox=new THREE.Box3().setFromObject(root);const center=preBox.getCenter(new THREE.Vector3());
    // Preserve authored units. Only recenter and place ground at y=0.
    root.position.set(-center.x,-preBox.min.y,-center.z);root.updateMatrixWorld(true);
    root.traverse(o=>{if(!o.isMesh)return;o.receiveShadow=true;o.castShadow=false;if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms){if('roughness'in m)m.roughness=Math.max(.24,m.roughness??.5);if('envMapIntensity'in m)m.envMapIntensity=.7;m.needsUpdate=true;}}});
    cityRoot.add(root);root.updateMatrixWorld(true);
    root.traverse(o=>{if(o.isMesh)addMeshCollider(o)});
    $('asset').textContent=`City LOADED · ${colliders.length} collision bounds`;
    addStreetLights();
  },undefined,()=>setTimeout(loadCity,120));
}
function buildFallbackCity(){
  const m=new THREE.MeshStandardMaterial({color:0x252b31,roughness:.72});
  for(let i=0;i<24;i++){const w=5+(i%4)*2.5,h=8+(i%6)*3,d=6+((i*5)%4)*2;const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);const a=i/24*Math.PI*2,r=34+(i%4)*12;b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);scene.add(b);addColliderBox(b.position.x-w/2,b.position.z-d/2,b.position.x+w/2,b.position.z+d/2,'fallback');}
}
loadCity();

// Ground + believable scale references.
const roadMat=new THREE.MeshPhysicalMaterial({color:0x111419,metalness:0,roughness:.43,clearcoat:.18,clearcoatRoughness:.2,envMapIntensity:.5});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(240,240),roadMat);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const lineMat=new THREE.MeshStandardMaterial({color:0xdad6c8,roughness:.55});
for(let z=-100;z<=100;z+=8){const m=new THREE.Mesh(new THREE.BoxGeometry(.11,.018,3.5),lineMat);m.position.set(0,.025,z);scene.add(m);}for(let x=-100;x<=100;x+=8){const m=new THREE.Mesh(new THREE.BoxGeometry(3.5,.018,.11),lineMat);m.position.set(x,.025,0);scene.add(m);}

const poleMat=new THREE.MeshStandardMaterial({color:0x30353a,metalness:.72,roughness:.35});const lampMat=new THREE.MeshStandardMaterial({color:0xffe0ba,emissive:0xffb65a,emissiveIntensity:4.5,roughness:.36});
function streetLamp(x,z,rot=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;const p=new THREE.Mesh(new THREE.CylinderGeometry(.055,.085,4.5,10),poleMat);p.position.y=2.25;g.add(p);const arm=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,1.05),poleMat);arm.position.set(0,4.28,-.48);g.add(arm);const head=new THREE.Mesh(new THREE.BoxGeometry(.38,.11,.65),lampMat);head.position.set(0,4.18,-.96);g.add(head);const L=new THREE.SpotLight(0xffd09a,18,15,.72,.82,1.4);L.position.set(0,4.05,-.93);L.target.position.set(0,0,-1);g.add(L,L.target);scene.add(g);addColliderBox(x-.12,z-.12,x+.12,z+.12,'lamp');}
function addStreetLights(){for(let x=-48;x<=48;x+=12){streetLamp(x,-10,0);streetLamp(x,10,Math.PI)}for(let z=-48;z<=48;z+=12){streetLamp(-10,z,-Math.PI/2);streetLamp(10,z,Math.PI/2)}}

// Continuous tunnel with explicit wall colliders.
const tunnelW=14.5,tunnelL=54,tunnelZ=-48,tunnelH=5.7;const concrete=new THREE.MeshStandardMaterial({color:0x454a50,roughness:.72});
for(const x of [-tunnelW/2,tunnelW/2]){const wall=new THREE.Mesh(new THREE.BoxGeometry(.5,tunnelH,tunnelL),concrete);wall.position.set(x,tunnelH/2,tunnelZ);scene.add(wall);addColliderBox(x-.25,tunnelZ-tunnelL/2,x+.25,tunnelZ+tunnelL/2,'tunnel-wall');}
const roof=new THREE.Mesh(new THREE.BoxGeometry(tunnelW+.5,.5,tunnelL),concrete);roof.position.set(0,tunnelH,tunnelZ);scene.add(roof);
const panelMat=new THREE.MeshStandardMaterial({color:0xdde2e5,emissive:0xf2f8ff,emissiveIntensity:4.8,roughness:.35});
for(let z=-70;z<=-26;z+=6){const p=new THREE.Mesh(new THREE.BoxGeometry(3.3,.05,1.3),panelMat);p.position.set(0,tunnelH-.3,z);scene.add(p);const L=new THREE.SpotLight(0xeaf2ff,24,10,.9,.85,1.4);L.position.set(0,tunnelH-.45,z);L.target.position.set(0,0,z);scene.add(L,L.target);}

// ---------------- Car visual ----------------
const carRoot=new THREE.Group();scene.add(carRoot);const fallback=new THREE.Group();
const fbBody=new THREE.Mesh(new THREE.BoxGeometry(1.86,.5,4.25),new THREE.MeshPhysicalMaterial({color:0x930b16,metalness:.72,roughness:.17,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.05}));fbBody.position.y=.63;fallback.add(fbBody);
const fbCabin=new THREE.Mesh(new THREE.BoxGeometry(1.48,.5,1.7),new THREE.MeshPhysicalMaterial({color:0x13242f,roughness:.045,transmission:.4,transparent:true,opacity:.9}));fbCabin.position.set(0,1.02,-.2);fallback.add(fbCabin);
for(const x of [-.94,.94])for(const z of [-1.33,1.33]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.3,20),new THREE.MeshStandardMaterial({color:0x07080a,roughness:.72}));w.rotation.z=Math.PI/2;w.position.set(x,.42,z);fallback.add(w)}carRoot.add(fallback);
for(const x of [-.54,.54]){const s=new THREE.SpotLight(0xe7f3ff,45,44,.3,.58,1.2);s.position.set(x,.74,-1.72);s.target.position.set(x,.1,-25);carRoot.add(s,s.target)}
const draco=new DRACOLoader();draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');const carLoader=new GLTFLoader();carLoader.setDRACOLoader(draco);const FERRARI=['https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/ferrari.glb','https://threejs.org/examples/models/gltf/ferrari.glb'];let fi=0;function loadFerrari(){if(fi>=FERRARI.length){$('car').textContent='Ferrari failed · fallback';return}const u=FERRARI[fi++];carLoader.load(u,g=>{const c=g.scene.children[0]||g.scene;c.scale.setScalar(1.03);c.rotation.y=Math.PI;c.position.y=.02;c.traverse(o=>{if(o.isMesh)o.receiveShadow=true});const body=c.getObjectByName('body');if(body)body.material=new THREE.MeshPhysicalMaterial({color:0xa70a14,metalness:.72,roughness:.17,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.05});carRoot.remove(fallback);carRoot.add(c);$('car').textContent='Ferrari LOADED'},undefined,()=>setTimeout(loadFerrari,120))}loadFerrari();

// ---------------- Vehicle dynamics ----------------
// Planar rigid body / bicycle model. Units: m, s, kg, N, rad.
const P={mass:1485,Iz:2450,lf:1.20,lr:1.48,halfW:.94,halfL:2.13,Cf:82000,Cr:90000,mu:1.03,g:9.81,maxSteer:.52,engineForce:8200,brakeForce:15500,drag:0.42,rolling:180};
let pos=new THREE.Vector2(0,16);let vel=new THREE.Vector2(0,0);let yaw=Math.PI,yawRate=0,steer=0,steerCmd=0,throttle=0,brake=0;
const fwd=new THREE.Vector2(),right=new THREE.Vector2();
function basis(){fwd.set(Math.sin(yaw),Math.cos(yaw));right.set(Math.cos(yaw),-Math.sin(yaw));}
function resetCar(){pos.set(0,16);vel.set(0,0);yaw=Math.PI;yawRate=0;steer=steerCmd=0;carRoot.position.set(pos.x,.04,pos.y);carRoot.rotation.y=yaw}$('reset').onclick=resetCar;
function hold(id,on,off){const e=$(id);e.addEventListener('pointerdown',ev=>{ev.preventDefault();on();navigator.vibrate?.(5)});e.addEventListener('pointerup',ev=>{ev.preventDefault();off()});e.addEventListener('pointercancel',ev=>{ev.preventDefault();off()})}hold('gas',()=>throttle=1,()=>throttle=0);hold('brake',()=>brake=1,()=>brake=0);

// SAT between oriented car box and axis-aligned static box.
function carAxes(){basis();return [fwd.clone(),right.clone()]}
function carVerts(){basis();const a=fwd.clone().multiplyScalar(P.halfL),b=right.clone().multiplyScalar(P.halfW);return [pos.clone().add(a).add(b),pos.clone().add(a).sub(b),pos.clone().sub(a).sub(b),pos.clone().sub(a).add(b)]}
function project(verts,axis){let mn=Infinity,mx=-Infinity;for(const v of verts){const d=v.dot(axis);if(d<mn)mn=d;if(d>mx)mx=d}return[mn,mx]}
function satCarAABB(c){const cv=carVerts();const bv=[new THREE.Vector2(c.minX,c.minZ),new THREE.Vector2(c.maxX,c.minZ),new THREE.Vector2(c.maxX,c.maxZ),new THREE.Vector2(c.minX,c.maxZ)];const axes=[...carAxes(),new THREE.Vector2(1,0),new THREE.Vector2(0,1)];let minOverlap=Infinity,best=null;for(const ax0 of axes){const ax=ax0.clone().normalize(),A=project(cv,ax),B=project(bv,ax),o=Math.min(A[1],B[1])-Math.max(A[0],B[0]);if(o<=0)return null;if(o<minOverlap){minOverlap=o;best=ax}}const bc=new THREE.Vector2((c.minX+c.maxX)/2,(c.minZ+c.maxZ)/2);if(pos.clone().sub(bc).dot(best)<0)best.negate();return{normal:best,depth:minOverlap}}
function velocityAtPoint(r){return new THREE.Vector2(vel.x-yawRate*r.y,vel.y+yawRate*r.x)}
function resolveCollision(c,hit){const n=hit.normal;pos.addScaledVector(n,hit.depth+.002);const contact=pos.clone().addScaledVector(n,-Math.min(P.halfW,P.halfL));const r=contact.clone().sub(pos);const vpt=velocityAtPoint(r);const vn=vpt.dot(n);if(vn>=0)return;const rn=r.x*n.y-r.y*n.x;const restitution=.12;let j=-(1+restitution)*vn/(1/P.mass+(rn*rn)/P.Iz);const impulse=n.clone().multiplyScalar(j);vel.addScaledVector(impulse,1/P.mass);yawRate+=(r.x*impulse.y-r.y*impulse.x)/P.Iz;const tangent=new THREE.Vector2(-n.y,n.x);const vt=vpt.dot(tangent);const rt=r.x*tangent.y-r.y*tangent.x;let jt=-vt/(1/P.mass+(rt*rt)/P.Iz);const maxF=.72*j;jt=THREE.MathUtils.clamp(jt,-maxF,maxF);const fimp=tangent.multiplyScalar(jt);vel.addScaledVector(fimp,1/P.mass);yawRate+=(r.x*fimp.y-r.y*fimp.x)/P.Iz;navigator.vibrate?.(Math.min(35,8+Math.abs(j)*.002));}

function integrateVehicle(dt){
  basis();const u=vel.dot(fwd),v=vel.dot(right);steer+=(steerCmd*P.maxSteer-steer)*(1-Math.exp(-dt*9));
  // Axle point lateral velocities and slip angles.
  const uf=Math.max(1.2,Math.abs(u));const alphaF=Math.atan2(v+P.lf*yawRate,uf)-steer;const alphaR=Math.atan2(v-P.lr*yawRate,uf);
  const Fzf=P.mass*P.g*P.lr/(P.lf+P.lr),Fzr=P.mass*P.g*P.lf/(P.lf+P.lr);
  let Fyf=THREE.MathUtils.clamp(-P.Cf*alphaF,-P.mu*Fzf,P.mu*Fzf);let Fyr=THREE.MathUtils.clamp(-P.Cr*alphaR,-P.mu*Fzr,P.mu*Fzr);
  // Lose some cornering authority near standstill to prevent pivoting in place.
  const speedGrip=THREE.MathUtils.smoothstep(Math.abs(u),.5,4);Fyf*=speedGrip;Fyr*=speedGrip;
  let Fx=throttle*P.engineForce;const signU=Math.sign(u||1);Fx-=P.drag*u*Math.abs(u);Fx-=P.rolling*signU;if(brake)Fx-=brake*P.brakeForce*signU;
  // Front tire force is rotated by steering angle.
  const cf=Math.cos(steer),sf=Math.sin(steer);const FxFront=-Fyf*sf,FyFront=Fyf*cf;
  const forceBodyX=Fx+FxFront;const forceBodyY=FyFront+Fyr;
  const forceWorld=fwd.clone().multiplyScalar(forceBodyX).add(right.clone().multiplyScalar(forceBodyY));
  vel.addScaledVector(forceWorld,dt/P.mass);
  const torque=P.lf*FyFront-P.lr*Fyr; yawRate+=torque/P.Iz*dt;
  // Rotational damping from tires/chassis, not arbitrary turn-rate setting.
  yawRate*=Math.exp(-dt*(.12+.018*Math.abs(u)));
  pos.addScaledVector(vel,dt);yaw+=yawRate*dt;

  // Substep collision solve so high speed cannot tunnel through ordinary props/walls.
  for(let iter=0;iter<3;iter++){let any=false;for(const c of colliders){if(pos.x<c.minX-P.halfL-2||pos.x>c.maxX+P.halfL+2||pos.y<c.minZ-P.halfL-2||pos.y>c.maxZ+P.halfL+2)continue;const hit=satCarAABB(c);if(hit){resolveCollision(c,hit);any=true}}if(!any)break}
}

// ---------------- Inputs ----------------
let gyro=false,alpha=null,baseAlpha=null,events=0;function wrap(v){while(v>180)v-=360;while(v<-180)v+=360;return v}addEventListener('deviceorientation',e=>{if(e.alpha==null)return;alpha=e.alpha;events++;if(gyro){if(baseAlpha==null)baseAlpha=alpha;steerCmd=THREE.MathUtils.clamp(wrap(alpha-baseAlpha)/40,-1,1)}},true);$('gyro').onclick=async()=>{if(gyro){baseAlpha=alpha;steerCmd=0;toast('Gyro recentered',900);return}try{if(typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw new Error('permission denied')}gyro=true;baseAlpha=alpha;$('gyro').textContent='RECENTER GYRO'}catch(e){toast('Gyro unavailable: '+e.message,2500)}};
window.__CAR_INPUT__={left:false,right:false};
function updateButtonSteer(){if(gyro)return;steerCmd=(window.__CAR_INPUT__.left?-1:0)+(window.__CAR_INPUT__.right?1:0)}
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k==='a'||k==='arrowleft')window.__CAR_INPUT__.left=true;if(k==='d'||k==='arrowright')window.__CAR_INPUT__.right=true;if(k==='w'||k==='arrowup')throttle=1;if(k==='s'||k==='arrowdown')brake=1;updateButtonSteer()});addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='a'||k==='arrowleft')window.__CAR_INPUT__.left=false;if(k==='d'||k==='arrowright')window.__CAR_INPUT__.right=false;if(k==='w'||k==='arrowup')throttle=0;if(k==='s'||k==='arrowdown')brake=0;updateButtonSteer()});
window.__setSteerButton=(dir,on)=>{if(dir<0)window.__CAR_INPUT__.left=on;else window.__CAR_INPUT__.right=on;updateButtonSteer()};

// ---------------- Camera / loop ----------------
const camPos=new THREE.Vector3(),look=new THREE.Vector3();let last=performance.now(),frames=0,fpsT=last;function loop(now){const dt=Math.min(.03,(now-last)/1000);last=now;const sub=Math.ceil(dt/.008);for(let i=0;i<sub;i++)integrateVehicle(dt/sub);carRoot.position.set(pos.x,.04,pos.y);carRoot.rotation.y=yaw;basis();const land=innerWidth>innerHeight,back=land?7.2:8,h=land?2.25:2.9;const target=new THREE.Vector3(pos.x-fwd.x*back,h,pos.y-fwd.y*back);camPos.lerp(target,1-Math.exp(-dt*8));camera.position.copy(camPos);look.set(pos.x+fwd.x*5,.8,pos.y+fwd.y*5);camera.lookAt(look);renderer.render(scene,camera);$('speed').textContent=Math.round(vel.length()*2.237)+' MPH';$('sensor').textContent=`gyro ${gyro?'ON':'OFF'} · collisions ${colliders.length} · yaw ${THREE.MathUtils.radToDeg(yawRate).toFixed(0)}°/s`;frames++;if(now-fpsT>900){$('fps').textContent=Math.round(frames*1000/(now-fpsT))+' FPS';frames=0;fpsT=now}}
resetCar();camPos.set(0,2.5,23);renderer.setAnimationLoop(loop);addEventListener('resize',()=>{dpr=Math.min(devicePixelRatio,1.35);renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
