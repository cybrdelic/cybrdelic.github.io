import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshBVH } from 'three-mesh-bvh';

const $ = id => document.getElementById(id);
const toast = (t, ms=2200) => { $('toast').textContent=t; $('toast').style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>$('toast').style.display='none',ms); };

const renderer = new THREE.WebGPURenderer({ antialias:true });
let dpr = Math.min(devicePixelRatio, 1.35);
renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement); await renderer.init();
$('backend').textContent = renderer.backend?.isWebGPUBackend ? 'NATIVE WEBGPU' : 'WEBGL2 FALLBACK';

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x070a0f); scene.fog = new THREE.FogExp2(0x090d13,.004);
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, .06, 420);
new RGBELoader().load('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', tex=>{ tex.mapping=THREE.EquirectangularReflectionMapping; scene.environment=tex; scene.environmentIntensity=.62; }, undefined, ()=>{});
scene.add(new THREE.HemisphereLight(0x8095ad,0x07080a,.26));
const moon = new THREE.DirectionalLight(0xc6dcff,1.55); moon.position.set(-30,42,18); moon.castShadow=true; moon.shadow.mapSize.set(2048,2048); moon.shadow.camera.left=-45; moon.shadow.camera.right=45; moon.shadow.camera.top=45; moon.shadow.camera.bottom=-45; moon.shadow.camera.near=.5; moon.shadow.camera.far=160; moon.shadow.normalBias=.025; scene.add(moon);

// ---- Triangle collision world ----
const collisionMeshes = [];
const tmpBox = new THREE.Box3(), tmpSphere = new THREE.Sphere(), tmpLocal = new THREE.Vector3(), tmpWorld = new THREE.Vector3(), tmpN3 = new THREE.Vector3();
function addTriangleCollider(mesh){
  if(!mesh.geometry?.attributes?.position) return;
  const wb = new THREE.Box3().setFromObject(mesh); const s=wb.getSize(new THREE.Vector3());
  if(s.y < .32 || s.x > 90 || s.z > 90 || s.x < .08 || s.z < .08) return;
  try { mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { maxDepth:32, targetLeafSize:8 }); }
  catch { return; }
  collisionMeshes.push({ mesh, worldBox:wb.clone(), inv:new THREE.Matrix4(), normalMat:new THREE.Matrix3(), scale:new THREE.Vector3() });
}
function refreshCollider(c){ c.mesh.updateMatrixWorld(true); c.inv.copy(c.mesh.matrixWorld).invert(); c.normalMat.getNormalMatrix(c.mesh.matrixWorld); c.mesh.getWorldScale(c.scale); c.worldBox.setFromObject(c.mesh); }

const cityRoot = new THREE.Group(); scene.add(cityRoot); const cityLoader = new GLTFLoader();
const CITY=['https://raw.githubusercontent.com/SpectraStudios/SourceCityToolkit_glb/main/Main_Intersection_v2.glb','https://cdn.jsdelivr.net/gh/SpectraStudios/SourceCityToolkit_glb@main/Main_Intersection_v2.glb']; let cityTry=0;
function loadCity(){
  if(cityTry>=CITY.length){ $('asset').textContent='City failed · fallback blocks'; buildFallbackCity(); return; }
  const u=CITY[cityTry++]; $('asset').textContent=`City loading ${cityTry}/${CITY.length}`;
  cityLoader.load(u,g=>{
    const root=g.scene; root.updateMatrixWorld(true); const pre=new THREE.Box3().setFromObject(root); const ctr=pre.getCenter(new THREE.Vector3());
    root.position.set(-ctr.x,-pre.min.y,-ctr.z); root.updateMatrixWorld(true);
    root.traverse(o=>{ if(!o.isMesh)return; o.receiveShadow=true; o.castShadow=false; if(o.material){ for(const m of (Array.isArray(o.material)?o.material:[o.material])){ if('roughness' in m)m.roughness=Math.max(.24,m.roughness??.5); if('envMapIntensity' in m)m.envMapIntensity=.7; m.needsUpdate=true; } } });
    cityRoot.add(root); root.updateMatrixWorld(true);
    setTimeout(()=>{ root.traverse(o=>{ if(o.isMesh)addTriangleCollider(o); }); collisionMeshes.forEach(refreshCollider); $('asset').textContent=`City LOADED · ${collisionMeshes.length} triangle BVHs`; },40);
    addStreetLights();
  },undefined,()=>setTimeout(loadCity,120));
}
function buildFallbackCity(){ const m=new THREE.MeshStandardMaterial({color:0x252b31,roughness:.72}); for(let i=0;i<24;i++){ const w=5+(i%4)*2.5,h=8+(i%6)*3,d=6+((i*5)%4)*2; const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m); const a=i/24*Math.PI*2,r=34+(i%4)*12; b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r); scene.add(b); addTriangleCollider(b); } collisionMeshes.forEach(refreshCollider); }
loadCity();

const roadMat=new THREE.MeshPhysicalMaterial({color:0x111419,metalness:0,roughness:.43,clearcoat:.18,clearcoatRoughness:.2,envMapIntensity:.5});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(240,240),roadMat); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
const lineMat=new THREE.MeshStandardMaterial({color:0xdad6c8,roughness:.55}); for(let z=-100;z<=100;z+=8){const m=new THREE.Mesh(new THREE.BoxGeometry(.11,.018,3.5),lineMat);m.position.set(0,.025,z);scene.add(m)} for(let x=-100;x<=100;x+=8){const m=new THREE.Mesh(new THREE.BoxGeometry(3.5,.018,.11),lineMat);m.position.set(x,.025,0);scene.add(m)}

const poleMat=new THREE.MeshStandardMaterial({color:0x30353a,metalness:.72,roughness:.35}); const lampMat=new THREE.MeshStandardMaterial({color:0xffe0ba,emissive:0xffb65a,emissiveIntensity:4.5,roughness:.36});
function streetLamp(x,z,rot=0){ const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot; const p=new THREE.Mesh(new THREE.CylinderGeometry(.055,.085,4.5,10),poleMat);p.position.y=2.25;g.add(p); const arm=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,1.05),poleMat);arm.position.set(0,4.28,-.48);g.add(arm); const head=new THREE.Mesh(new THREE.BoxGeometry(.38,.11,.65),lampMat);head.position.set(0,4.18,-.96);g.add(head); const L=new THREE.SpotLight(0xffd09a,18,15,.72,.82,1.4);L.position.set(0,4.05,-.93);L.target.position.set(0,0,-1);g.add(L,L.target);scene.add(g); g.updateMatrixWorld(true); addTriangleCollider(p); }
function addStreetLights(){ for(let x=-48;x<=48;x+=12){streetLamp(x,-10,0);streetLamp(x,10,Math.PI)} for(let z=-48;z<=48;z+=12){streetLamp(-10,z,-Math.PI/2);streetLamp(10,z,Math.PI/2)} collisionMeshes.forEach(refreshCollider); }

const tunnelW=14.5,tunnelL=54,tunnelZ=-48,tunnelH=5.7; const concrete=new THREE.MeshStandardMaterial({color:0x454a50,roughness:.72});
for(const x of [-tunnelW/2,tunnelW/2]){ const wall=new THREE.Mesh(new THREE.BoxGeometry(.5,tunnelH,tunnelL),concrete); wall.position.set(x,tunnelH/2,tunnelZ); scene.add(wall); wall.updateMatrixWorld(true); addTriangleCollider(wall); }
const roof=new THREE.Mesh(new THREE.BoxGeometry(tunnelW+.5,.5,tunnelL),concrete);roof.position.set(0,tunnelH,tunnelZ);scene.add(roof);
const panelMat=new THREE.MeshStandardMaterial({color:0xdde2e5,emissive:0xf2f8ff,emissiveIntensity:4.8,roughness:.35}); for(let z=-70;z<=-26;z+=6){const p=new THREE.Mesh(new THREE.BoxGeometry(3.3,.05,1.3),panelMat);p.position.set(0,tunnelH-.3,z);scene.add(p);const L=new THREE.SpotLight(0xeaf2ff,24,10,.9,.85,1.4);L.position.set(0,tunnelH-.45,z);L.target.position.set(0,0,z);scene.add(L,L.target)}
collisionMeshes.forEach(refreshCollider);

// ---- Car visual ----
const carRoot=new THREE.Group();scene.add(carRoot);const fallback=new THREE.Group();
const fbBody=new THREE.Mesh(new THREE.BoxGeometry(1.86,.5,4.25),new THREE.MeshPhysicalMaterial({color:0x930b16,metalness:.72,roughness:.17,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.05}));fbBody.position.y=.63;fallback.add(fbBody);
const fbCabin=new THREE.Mesh(new THREE.BoxGeometry(1.48,.5,1.7),new THREE.MeshPhysicalMaterial({color:0x13242f,roughness:.045,transmission:.4,transparent:true,opacity:.9}));fbCabin.position.set(0,1.02,-.2);fallback.add(fbCabin);
for(const x of [-.94,.94])for(const z of [-1.33,1.33]){const w=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.3,20),new THREE.MeshStandardMaterial({color:0x07080a,roughness:.72}));w.rotation.z=Math.PI/2;w.position.set(x,.42,z);fallback.add(w)}carRoot.add(fallback);
for(const x of [-.54,.54]){const s=new THREE.SpotLight(0xe7f3ff,45,44,.3,.58,1.2);s.position.set(x,.74,-1.72);s.target.position.set(x,.1,-25);carRoot.add(s,s.target)}
const draco=new DRACOLoader();draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');const carLoader=new GLTFLoader();carLoader.setDRACOLoader(draco);const FERRARI=['https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/ferrari.glb','https://threejs.org/examples/models/gltf/ferrari.glb'];let fi=0;function loadFerrari(){if(fi>=FERRARI.length){$('car').textContent='Ferrari failed · fallback';return}const u=FERRARI[fi++];carLoader.load(u,g=>{const c=g.scene.children[0]||g.scene;c.scale.setScalar(1.03);c.rotation.y=Math.PI;c.position.y=.02;c.traverse(o=>{if(o.isMesh)o.receiveShadow=true});const body=c.getObjectByName('body');if(body)body.material=new THREE.MeshPhysicalMaterial({color:0xa70a14,metalness:.72,roughness:.17,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.05});carRoot.remove(fallback);carRoot.add(c);$('car').textContent='Ferrari LOADED'},undefined,()=>setTimeout(loadFerrari,120))}loadFerrari();

// ---- Rigid-body bicycle model ----
const P={mass:1485,Iz:2450,lf:1.20,lr:1.48,Cf:82000,Cr:90000,mu:1.03,g:9.81,maxSteer:.52,engineForce:8200,brakeForce:15500,drag:.42,rolling:180};
let pos=new THREE.Vector2(0,16),vel=new THREE.Vector2(),yaw=Math.PI,yawRate=0,steer=0,steerCmd=0,throttle=0,brake=0;
const fwd=new THREE.Vector2(),right=new THREE.Vector2(); function basis(){fwd.set(Math.sin(yaw),Math.cos(yaw));right.set(Math.cos(yaw),-Math.sin(yaw));}
function resetCar(){pos.set(0,16);vel.set(0,0);yaw=Math.PI;yawRate=0;steer=steerCmd=0;carRoot.position.set(pos.x,.04,pos.y);carRoot.rotation.y=yaw}$('reset').onclick=resetCar;
function hold(id,on,off){const e=$(id);e.addEventListener('pointerdown',ev=>{ev.preventDefault();on();navigator.vibrate?.(5)});e.addEventListener('pointerup',ev=>{ev.preventDefault();off()});e.addEventListener('pointercancel',ev=>{ev.preventDefault();off()})}hold('gas',()=>throttle=1,()=>throttle=0);hold('brake',()=>brake=1,()=>brake=0);

function integrateVehicle(dt){ basis(); const u=vel.dot(fwd),v=vel.dot(right); steer += (steerCmd*P.maxSteer-steer)*(1-Math.exp(-dt*9)); const absU=Math.max(Math.abs(u),1.5); const af=Math.atan2(v+P.lf*yawRate,absU)-steer, ar=Math.atan2(v-P.lr*yawRate,absU); const FzF=P.mass*P.g*P.lr/(P.lf+P.lr),FzR=P.mass*P.g*P.lf/(P.lf+P.lr); const FyF=THREE.MathUtils.clamp(-P.Cf*af,-P.mu*FzF,P.mu*FzF),FyR=THREE.MathUtils.clamp(-P.Cr*ar,-P.mu*FzR,P.mu*FzR); let Fx=throttle*P.engineForce; if(brake>0){const sign=Math.sign(u||1);Fx-=sign*brake*P.brakeForce} Fx-=Math.sign(u||1)*(P.rolling+P.drag*u*u); const force=fwd.clone().multiplyScalar(Fx).add(right.clone().multiplyScalar(FyF+FyR)); vel.addScaledVector(force,dt/P.mass); yawRate+=(P.lf*FyF-P.lr*FyR)/P.Iz*dt; yawRate*=Math.exp(-dt*.14); pos.addScaledVector(vel,dt); yaw+=yawRate*dt; }

// ---- Triangle BVH contact manifold ----
const chassisSamples=[[-.72,1.72,.46],[.72,1.72,.46],[-.82,.7,.48],[.82,.7,.48],[-.82,-.65,.48],[.82,-.65,.48],[-.68,-1.72,.46],[.68,-1.72,.46],[0,2.02,.44],[0,-2.02,.44]];
const contacts=[]; const localSphere=new THREE.Sphere(), localCP=new THREE.Vector3(), worldCP=new THREE.Vector3(), worldCenter3=new THREE.Vector3(), localCenter3=new THREE.Vector3();
function carBroadBox(){basis();const ex=Math.abs(right.x)*1.15+Math.abs(fwd.x)*2.48,ez=Math.abs(right.y)*1.15+Math.abs(fwd.y)*2.48;return new THREE.Box3(new THREE.Vector3(pos.x-ex,.1,pos.y-ez),new THREE.Vector3(pos.x+ex,1.5,pos.y+ez));}
function collectContacts(){ contacts.length=0; basis(); const broad=carBroadBox();
  for(const c of collisionMeshes){ if(!broad.intersectsBox(c.worldBox))continue; const mesh=c.mesh,bvh=mesh.geometry.boundsTree;if(!bvh)continue; const maxScale=Math.max(c.scale.x,c.scale.y,c.scale.z,1e-5);
    for(const [lx,lz,r] of chassisSamples){ const wc2=pos.clone().addScaledVector(right,lx).addScaledVector(fwd,lz); worldCenter3.set(wc2.x,.64,wc2.y); localCenter3.copy(worldCenter3).applyMatrix4(c.inv); localSphere.center.copy(localCenter3); localSphere.radius=r/maxScale;
      let best=null;
      bvh.shapecast({ intersectsBounds:box=>box.intersectsSphere(localSphere), intersectsTriangle:tri=>{ tri.closestPointToPoint(localCenter3,localCP); const ds=localCP.distanceToSquared(localCenter3); if(ds<localSphere.radius*localSphere.radius){ worldCP.copy(localCP).applyMatrix4(mesh.matrixWorld); const dx=worldCenter3.x-worldCP.x,dz=worldCenter3.z-worldCP.z,dist=Math.hypot(dx,dz); if(dist<r && dist>1e-5){ tri.getNormal(tmpN3).applyMatrix3(c.normalMat).normalize(); let nx=tmpN3.x,nz=tmpN3.z; const nl=Math.hypot(nx,nz); if(nl>.18){nx/=nl;nz/=nl;if(dx*nx+dz*nz<0){nx=-nx;nz=-nz} const pen=r-dist;if(!best||pen>best.pen)best={n:new THREE.Vector2(nx,nz),pen,cp:new THREE.Vector2(worldCP.x,worldCP.z)}; } } return false;} return false; } });
      if(best)contacts.push(best);
    }
  }
}
function velocityAt(r){return new THREE.Vector2(vel.x-yawRate*r.y,vel.y+yawRate*r.x)}
function solveContacts(){ if(!contacts.length)return; contacts.sort((a,b)=>b.pen-a.pen); const used=[];
  for(const c of contacts){ if(used.some(u=>u.cp.distanceToSquared(c.cp)<.06))continue; used.push(c); pos.addScaledVector(c.n,Math.min(c.pen*.72,.24)); const r=c.cp.clone().sub(pos),vp=velocityAt(r),vn=vp.dot(c.n); if(vn>=0)continue; const rn=r.x*c.n.y-r.y*c.n.x; const e=.08; let j=-(1+e)*vn/(1/P.mass+rn*rn/P.Iz); j=Math.max(0,j); const imp=c.n.clone().multiplyScalar(j); vel.addScaledVector(imp,1/P.mass); yawRate+=(r.x*imp.y-r.y*imp.x)/P.Iz; const t=new THREE.Vector2(-c.n.y,c.n.x),vt=vp.dot(t),rt=r.x*t.y-r.y*t.x; let jt=-vt/(1/P.mass+rt*rt/P.Iz); jt=THREE.MathUtils.clamp(jt,-.75*j,.75*j); const fi=t.multiplyScalar(jt);vel.addScaledVector(fi,1/P.mass);yawRate+=(r.x*fi.y-r.y*fi.x)/P.Iz; }
}
function physicsStep(dt){ const speed=vel.length(); const sub=Math.min(14,Math.max(1,Math.ceil(speed*dt/.16))); const h=dt/sub; for(let i=0;i<sub;i++){ integrateVehicle(h); for(let k=0;k<3;k++){ collectContacts(); if(!contacts.length)break; solveContacts(); } } }

// ---- Controls: one sign convention only: -1 LEFT, +1 RIGHT ----
let leftHeld=false,rightHeld=false; function updateSteerCmd(){steerCmd=(leftHeld?-1:0)+(rightHeld?1:0)} window.__setSteerButton=(dir,on)=>{if(dir<0)leftHeld=on;else rightHeld=on;updateSteerCmd()};
const keys={};addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;if(k==='a'||k==='arrowleft')leftHeld=true;if(k==='d'||k==='arrowright')rightHeld=true;if(k==='w'||k==='arrowup')throttle=1;if(k==='s'||k==='arrowdown')brake=1;updateSteerCmd()});addEventListener('keyup',e=>{const k=e.key.toLowerCase();keys[k]=false;if(k==='a'||k==='arrowleft')leftHeld=false;if(k==='d'||k==='arrowright')rightHeld=false;if(k==='w'||k==='arrowup')throttle=0;if(k==='s'||k==='arrowdown')brake=0;updateSteerCmd()});
let gyro=false,alpha=null,baseAlpha=null,events=0;function wrap(v){while(v>180)v-=360;while(v<-180)v+=360;return v}addEventListener('deviceorientation',e=>{if(e.alpha==null)return;alpha=e.alpha;events++;if(gyro&&baseAlpha!=null)steerCmd=THREE.MathUtils.clamp(wrap(alpha-baseAlpha)/38,-1,1)},true);$('gyro').onclick=async()=>{if(gyro){baseAlpha=alpha;toast('Gyro recentered',900);return}try{if(typeof DeviceOrientationEvent==='undefined')throw new Error('orientation API unavailable');if(typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw new Error('permission denied')}gyro=true;baseAlpha=alpha;$('gyro').textContent='RECENTER GYRO';toast('Gyro active',1200)}catch(e){toast('Gyro unavailable: '+e.message,3000)}};

const camPos=new THREE.Vector3(),look=new THREE.Vector3();let last=performance.now(),frames=0,fpsStamp=last;
function animate(now){const dt=Math.min(.033,(now-last)/1000);last=now;physicsStep(dt);carRoot.position.set(pos.x,.04,pos.y);carRoot.rotation.y=yaw;basis();const landscape=innerWidth>innerHeight,back=landscape?7.1:7.9,h=landscape?2.25:2.85;const target=new THREE.Vector3(pos.x-fwd.x*back,h,pos.y-fwd.y*back);camPos.lerp(target,1-Math.exp(-dt*7.5));camera.position.copy(camPos);look.set(pos.x+fwd.x*5,.76,pos.y+fwd.y*5);camera.lookAt(look);renderer.render(scene,camera);$('speed').textContent=Math.round(vel.length()*2.237)+' MPH';$('sensor').textContent=`triangle contacts ${contacts.length} · yaw ${THREE.MathUtils.radToDeg(yawRate).toFixed(1)}°/s · gyro ${gyro?'ON':'OFF'} ${events}`;frames++;if(now-fpsStamp>900){$('fps').textContent=Math.round(frames*1000/(now-fpsStamp))+' FPS';frames=0;fpsStamp=now}}
resetCar();camPos.set(0,2.5,23);renderer.setAnimationLoop(animate);addEventListener('resize',()=>{dpr=Math.min(devicePixelRatio,1.35);renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
