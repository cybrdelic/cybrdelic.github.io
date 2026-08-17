import * as THREE from 'three/webgpu';
import { pass, mrt, output, diffuseColor, normalView, velocity, metalness, roughness, vec2, vec4, add, packNormalToRGB, unpackRGBToNormal, sample } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const $ = id => document.getElementById(id);
const toast = (t, ms=2200) => { $('toast').textContent=t; $('toast').style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>$('toast').style.display='none', ms); };

const renderer = new THREE.WebGPURenderer({ antialias:true });
let dpr = Math.min(devicePixelRatio, 1.4);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();
const nativeGPU = renderer.backend?.isWebGPUBackend === true;
$('backend').textContent = nativeGPU ? 'NATIVE WEBGPU' : 'WEBGL2 FALLBACK';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a0f);
scene.fog = new THREE.FogExp2(0x090d13, 0.0048);
const camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.06, 350);

new RGBELoader().load(
  'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr',
  tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.environmentIntensity = 0.58;
    scene.backgroundBlurriness = 0.35;
  }, undefined, () => {}
);

scene.add(new THREE.HemisphereLight(0x7f91a6, 0x0a0b0d, 0.26));
const key = new THREE.DirectionalLight(0xbfd5f4, 1.45);
key.position.set(-24, 36, 18);
key.castShadow = true;
key.shadow.mapSize.set(2048,2048);
key.shadow.camera.left=-34; key.shadow.camera.right=34; key.shadow.camera.top=34; key.shadow.camera.bottom=-34;
key.shadow.camera.near=.5; key.shadow.camera.far=120; key.shadow.normalBias=.03;
scene.add(key);

const loader = new GLTFLoader();
const cityRoot = new THREE.Group();
scene.add(cityRoot);
const CITY_URLS = [
  'https://raw.githubusercontent.com/SpectraStudios/SourceCityToolkit_glb/main/Main_Intersection_v2.glb',
  'https://cdn.jsdelivr.net/gh/SpectraStudios/SourceCityToolkit_glb@main/Main_Intersection_v2.glb'
];
let cityAttempt=0;
function loadCity(){
  if(cityAttempt>=CITY_URLS.length){ $('asset').textContent='City asset failed — minimal fallback active'; buildFallbackCity(); return; }
  const url=CITY_URLS[cityAttempt++];
  $('asset').textContent=`Authored city loading ${cityAttempt}/${CITY_URLS.length}`;
  loader.load(url, g=>{
    const root=g.scene;
    root.traverse(o=>{
      if(!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      if(Array.isArray(o.material)) o.material.forEach(m=>tuneMaterial(m)); else tuneMaterial(o.material);
    });
    const box=new THREE.Box3().setFromObject(root);
    const size=box.getSize(new THREE.Vector3());
    const center=box.getCenter(new THREE.Vector3());
    const maxXZ=Math.max(size.x,size.z,1);
    const targetSpan=155;
    const scale=targetSpan/maxXZ;
    root.scale.setScalar(scale);
    root.position.set(-center.x*scale, -box.min.y*scale, -center.z*scale);
    cityRoot.add(root);
    $('asset').textContent='Authored city: LOADED · CC0 Source City';
    addUrbanLights();
  }, xhr=>{ if(xhr.total) $('asset').textContent=`Authored city ${Math.round(xhr.loaded/xhr.total*100)}%`; }, ()=>setTimeout(loadCity,150));
}
function tuneMaterial(m){
  if(!m) return;
  if('envMapIntensity' in m) m.envMapIntensity=Math.min(m.envMapIntensity ?? 1, .85);
  if('roughness' in m) m.roughness=Math.max(.24, m.roughness ?? .5);
  if('metalness' in m && (m.name||'').toLowerCase().includes('road')) m.metalness=0;
  m.needsUpdate=true;
}
loadCity();
function buildFallbackCity(){
  const mat=new THREE.MeshStandardMaterial({color:0x20252c,roughness:.72});
  for(let i=0;i<18;i++){
    const w=6+(i%4)*3, h=6+(i%5)*4, d=7+((i*3)%5)*2;
    const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    const a=i/18*Math.PI*2, r=35+(i%3)*11;
    b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);
    b.receiveShadow=true; scene.add(b);
  }
}

const asphalt = new THREE.MeshPhysicalMaterial({color:0x111419,metalness:0,roughness:.42,clearcoat:.25,clearcoatRoughness:.18,envMapIntensity:.5});
const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(220,220), asphalt);
roadPlane.rotation.x=-Math.PI/2; roadPlane.position.y=.015; roadPlane.receiveShadow=true; scene.add(roadPlane);
const markingMat=new THREE.MeshStandardMaterial({color:0xe2dfd3,roughness:.55});
for(let z=-90;z<=90;z+=9){ const m=new THREE.Mesh(new THREE.BoxGeometry(.11,.02,4.4),markingMat); m.position.set(0,.04,z); scene.add(m); }
for(let x=-90;x<=90;x+=9){ const m=new THREE.Mesh(new THREE.BoxGeometry(4.4,.02,.11),markingMat); m.position.set(x,.04,0); scene.add(m); }

const lampPoleMat=new THREE.MeshStandardMaterial({color:0x30353a,metalness:.75,roughness:.35});
const lampEmissive=new THREE.MeshStandardMaterial({color:0xffdfb6,emissive:0xffb75c,emissiveIntensity:4.5,roughness:.38});
function addStreetLamp(x,z,rot=0){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=rot;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,4.4,10),lampPoleMat); pole.position.y=2.2; g.add(pole);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,1.1),lampPoleMat); arm.position.set(0,4.25,-.48); g.add(arm);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.42,.12,.72),lampEmissive); head.position.set(0,4.18,-1.0); g.add(head);
  const light=new THREE.SpotLight(0xffd2a0,19,16,.78,.8,1.5); light.position.set(0,4.05,-.95); light.target.position.set(0,0,-1.0); g.add(light,light.target);
  scene.add(g);
}
function addUrbanLights(){
  for(let x=-52;x<=52;x+=13){ addStreetLamp(x,-9,0); addStreetLamp(x,9,Math.PI); }
  for(let z=-52;z<=52;z+=13){ addStreetLamp(-9,z,-Math.PI/2); addStreetLamp(9,z,Math.PI/2); }
}

const tunnel = new THREE.Group(); scene.add(tunnel);
const concrete=new THREE.MeshStandardMaterial({color:0x454a50,metalness:0,roughness:.72});
const tile=new THREE.MeshPhysicalMaterial({color:0x262f37,metalness:0,roughness:.34,clearcoat:.18,clearcoatRoughness:.2});
const tunnelLength=52, tunnelWidth=15, tunnelHeight=5.8;
const leftWall=new THREE.Mesh(new THREE.BoxGeometry(.55,tunnelHeight,tunnelLength),concrete); leftWall.position.set(-tunnelWidth/2,tunnelHeight/2,-46);
const rightWall=leftWall.clone(); rightWall.position.x=tunnelWidth/2;
const roof=new THREE.Mesh(new THREE.BoxGeometry(tunnelWidth+.55,.5,tunnelLength),concrete); roof.position.set(0,tunnelHeight,-46);
for(const m of [leftWall,rightWall,roof]){m.receiveShadow=true;tunnel.add(m);}
const lowerL=new THREE.Mesh(new THREE.BoxGeometry(.08,1.55,tunnelLength-.6),tile); lowerL.position.set(-tunnelWidth/2+.34,1.0,-46); tunnel.add(lowerL);
const lowerR=lowerL.clone(); lowerR.position.x=tunnelWidth/2-.34; tunnel.add(lowerR);
const panelMat=new THREE.MeshStandardMaterial({color:0xd9dde0,emissive:0xf2f8ff,emissiveIntensity:5.0,roughness:.35});
for(let z=-68;z<=-24;z+=6){
  const panel=new THREE.Mesh(new THREE.BoxGeometry(3.5,.06,1.4),panelMat); panel.position.set(0,tunnelHeight-.32,z); tunnel.add(panel);
  const L=new THREE.SpotLight(0xeaf2ff,25,11,.92,.86,1.5); L.position.set(0,tunnelHeight-.5,z); L.target.position.set(0,0,z); tunnel.add(L,L.target);
}
const cyan=new THREE.MeshStandardMaterial({color:0x0c6680,emissive:0x39c9ff,emissiveIntensity:6.5});
for(const x of [-tunnelWidth/2+.28,tunnelWidth/2-.28]){ const strip=new THREE.Mesh(new THREE.BoxGeometry(.06,.14,tunnelLength-.8),cyan); strip.position.set(x,1.7,-46); tunnel.add(strip); }

const carRoot=new THREE.Group(); scene.add(carRoot);
const fallback=new THREE.Group();
const fbBody=new THREE.Mesh(new THREE.BoxGeometry(1.84,.5,4.12),new THREE.MeshPhysicalMaterial({color:0x8b0914,metalness:.72,roughness:.18,clearcoat:1,clearcoatRoughness:.03,envMapIntensity:1})); fbBody.position.y=.63; fallback.add(fbBody);
const fbCabin=new THREE.Mesh(new THREE.BoxGeometry(1.5,.52,1.72),new THREE.MeshPhysicalMaterial({color:0x13242f,roughness:.05,transmission:.42,transparent:true,opacity:.9})); fbCabin.position.set(0,1.03,-.18); fallback.add(fbCabin);
for(const x of [-.92,.92]) for(const z of [-1.27,1.27]){ const w=new THREE.Mesh(new THREE.CylinderGeometry(.37,.37,.28,20),new THREE.MeshStandardMaterial({color:0x07080a,roughness:.72})); w.rotation.z=Math.PI/2; w.position.set(x,.42,z); fallback.add(w); }
carRoot.add(fallback);
for(const x of [-.53,.53]){ const s=new THREE.SpotLight(0xe7f3ff,48,46,.3,.58,1.25); s.position.set(x,.74,-1.65); s.target.position.set(x,.1,-25); carRoot.add(s,s.target); }
const tail=new THREE.PointLight(0xff183b,4.0,4,2); tail.position.set(0,.72,1.95); carRoot.add(tail);

const draco=new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');
const carLoader=new GLTFLoader(); carLoader.setDRACOLoader(draco);
const ferrariURLs=['https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/models/gltf/ferrari.glb','https://threejs.org/examples/models/gltf/ferrari.glb'];
let fa=0;
function loadFerrari(){
  if(fa>=ferrariURLs.length){$('car').textContent='Ferrari failed · fallback car';return;}
  const u=ferrariURLs[fa++]; $('car').textContent=`Ferrari loading ${fa}/${ferrariURLs.length}`;
  carLoader.load(u,g=>{
    const c=g.scene.children[0]||g.scene; c.scale.setScalar(1.03); c.rotation.y=Math.PI; c.position.y=.02;
    c.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
    const body=c.getObjectByName('body'); if(body) body.material=new THREE.MeshPhysicalMaterial({color:0xa70a14,metalness:.72,roughness:.17,clearcoat:1,clearcoatRoughness:.025,envMapIntensity:1.05});
    const glass=c.getObjectByName('glass'); if(glass) glass.material=new THREE.MeshPhysicalMaterial({color:0x9ab4c5,metalness:0,roughness:.035,transmission:.78,transparent:true,opacity:.92,ior:1.48});
    carRoot.remove(fallback); carRoot.add(c); $('car').textContent='Ferrari: LOADED';
  },undefined,()=>setTimeout(loadFerrari,120));
}
loadFerrari();

let renderPipeline=null, hybridActive=false, hybridDisabled=false;
function buildHybrid(){
  if(!nativeGPU||hybridDisabled) return;
  try{
    const p=new THREE.RenderPipeline(renderer);
    const sp=pass(scene,camera);
    sp.setMRT(mrt({output,diffuseColor,normal:packNormalToRGB(normalView),velocity,metalrough:vec2(metalness,roughness)}));
    const c=sp.getTextureNode('output'), d=sp.getTextureNode('diffuseColor'), z=sp.getTextureNode('depth'), np=sp.getTextureNode('normal'), vel=sp.getTextureNode('velocity'), mr=sp.getTextureNode('metalrough');
    sp.getTexture('diffuseColor').type=THREE.UnsignedByteType; sp.getTexture('normal').type=THREE.UnsignedByteType; sp.getTexture('metalrough').type=THREE.UnsignedByteType;
    const n=sample(uv=>unpackRGBToNormal(np.sample(uv)));
    const gi=ssgi(c,z,n,camera); gi.sliceCount.value=1; gi.stepCount.value=5; gi.radius.value=5; gi.giIntensity.value=.85; gi.aoIntensity.value=.58; gi.useTemporalFiltering=true;
    const comp=vec4(add(c.rgb.mul(gi.getAONode().r),d.rgb.mul(gi.getGINode().rgb)),c.a);
    const refl=ssr(comp,z,n,{metalnessNode:mr.r,roughnessNode:mr.g}); refl.quality.value=.36; refl.maxDistance.value=.42; refl.intensity.value=.42; refl.thickness.value=.026;
    p.outputNode=traa(comp.add(refl.rgb),z,vel,camera);
    renderPipeline=p; hybridActive=true; $('hybrid').textContent='SSGI + AO + SSR + TRAA';
  }catch(e){hybridDisabled=true;$('hybrid').textContent='PBR + MSAA';console.warn(e);}
}

let px=0,pz=16,yaw=Math.PI,speed=0,steer=0,steerInput=0,throttle=0,brake=0;
function resetCar(){px=0;pz=16;yaw=Math.PI;speed=0;steer=0;steerInput=0;carRoot.position.set(px,.04,pz);carRoot.rotation.y=yaw;}
$('reset').onclick=resetCar;
function hold(id,on,off){const e=$(id);e.addEventListener('pointerdown',ev=>{ev.preventDefault();on();navigator.vibrate?.(5)});e.addEventListener('pointerup',ev=>{ev.preventDefault();off()});e.addEventListener('pointercancel',ev=>{ev.preventDefault();off()});}
hold('gas',()=>throttle=1,()=>throttle=0); hold('brake',()=>brake=1,()=>brake=0);

let gyro=false,alpha=null,baseAlpha=null,events=0;
function wrap(v){while(v>180)v-=360;while(v<-180)v+=360;return v;}
addEventListener('deviceorientation',e=>{if(e.alpha==null)return;alpha=e.alpha;events++;if(gyro){if(baseAlpha==null)baseAlpha=alpha;steerInput=THREE.MathUtils.clamp(wrap(alpha-baseAlpha)/38,-1,1);}},true);
$('gyro').onclick=async()=>{if(gyro){baseAlpha=alpha;steerInput=0;toast('Gyro recentered',900);return;}try{if(typeof DeviceOrientationEvent==='undefined')throw new Error('orientation API unavailable');if(typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw new Error('permission denied');}gyro=true;baseAlpha=alpha;$('gyro').textContent='RECENTER GYRO';toast(alpha==null?'Permission granted; waiting for sensor data':'Gyro active',1800);}catch(e){toast('Gyro unavailable: '+e.message,3200);}};

let sptr=null,lastX=0;
renderer.domElement.addEventListener('pointerdown',e=>{if(e.clientY<innerHeight*.72){sptr=e.pointerId;lastX=e.clientX;}});
renderer.domElement.addEventListener('pointermove',e=>{if(!gyro&&e.pointerId===sptr){steerInput=THREE.MathUtils.clamp(steerInput+(e.clientX-lastX)/82,-1,1);lastX=e.clientX;}});
renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerId===sptr)sptr=null;});

const camPos=new THREE.Vector3(),look=new THREE.Vector3();
let last=performance.now(),frames=0,fpsStamp=last,stableFrames=0;
function update(dt){
  const engine=throttle*(15.5*(1-speed/62)); const braking=brake*28; const drag=.18+.0085*speed*speed; speed+=(engine-drag-braking)*dt; speed=THREE.MathUtils.clamp(speed,0,62);
  if(!gyro&&sptr===null)steerInput*=Math.exp(-dt*4.8);
  steer+=(steerInput-steer)*(1-Math.exp(-dt*11)); yaw+=steer*.7/(1+speed*.021)*speed*.06*dt;
  px+=Math.sin(yaw)*speed*dt; pz+=Math.cos(yaw)*speed*dt;
  const lim=92; if(Math.abs(px)>lim){px=THREE.MathUtils.clamp(px,-lim,lim);speed*=.65;} if(Math.abs(pz)>lim){pz=THREE.MathUtils.clamp(pz,-lim,lim);speed*=.65;}
  carRoot.position.set(px,.04,pz); carRoot.rotation.y=yaw;
  const landscape=innerWidth>innerHeight, back=landscape?6.9:7.7, h=landscape?2.2:2.8;
  const target=new THREE.Vector3(px-Math.sin(yaw)*back,h,pz-Math.cos(yaw)*back); camPos.lerp(target,1-Math.exp(-dt*8)); camera.position.copy(camPos);
  look.set(px+Math.sin(yaw)*5,.75,pz+Math.cos(yaw)*5); camera.lookAt(look);
  $('speed').textContent=Math.round(speed*2.237)+' MPH'; $('sensor').textContent=`gyro ${gyro?'ON':'OFF'} · events ${events}`;
}
function animate(now){
  const dt=Math.min(.033,(now-last)/1000);last=now;update(dt);
  try{ if(hybridActive&&renderPipeline)renderPipeline.render(); else renderer.render(scene,camera); }catch(e){hybridActive=false;hybridDisabled=true;renderPipeline=null;$('hybrid').textContent='PBR + MSAA';renderer.render(scene,camera);}
  stableFrames++; if(stableFrames===4)buildHybrid(); frames++; if(now-fpsStamp>900){$('fps').textContent=Math.round(frames*1000/(now-fpsStamp))+' FPS';frames=0;fpsStamp=now;}
}
resetCar(); camPos.set(0,2.5,23); renderer.setAnimationLoop(animate);
addEventListener('resize',()=>{dpr=Math.min(devicePixelRatio,1.4);renderer.setPixelRatio(dpr);renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});