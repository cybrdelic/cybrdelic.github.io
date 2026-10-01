// A reduced beam-fracture model for the reviewed botanical skeleton.
// Orthotropic material scales: Jooma et al., Fuel (2025), Appendix A.
// Beam-section loss, overload damage and rigid fragment contact are OUR reduced
// closures, not that paper's FEM or a validated engineering fracture solver.
export const WOOD_STRUCTURE = Object.freeze({ layoutVersion: 1, stride: 64,
  densityKgM3: 495, bendingStrengthPa: 65e6, longitudinalYoungPa: 11e9,
  charStrengthFraction: 0.12, overloadRate: 8, gravity: 9.81,
  // Reduced pine authoring ratios relative to dry bending strength. These
  // are not species-fitted material tests, a FEM criterion, or buckling.
  compressionStrengthRatio: 0.45, tensionStrengthRatio: 0.9, shearStrengthRatio: 0.1,
  restitution: 0.08, contactFriction: 5, angularDrag: 0.35, maxDt: 1 / 30 });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (a, s) => a.map(x => x * s);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const length = a => Math.hypot(...a);
const norm = a => mul(a, 1 / Math.max(length(a), 1e-20));
export function rotateWood(q, p) { const u = q.slice(0, 3), t = mul(cross(u, p), 2); return add(p, add(mul(t, q[3]), cross(u, t))); }
function integrateQuaternion(q, w, dt) {
  const d = [q[3]*w[0]+q[1]*w[2]-q[2]*w[1], q[3]*w[1]+q[2]*w[0]-q[0]*w[2],
    q[3]*w[2]+q[0]*w[1]-q[1]*w[0], -dot(q.slice(0,3), w)];
  const next = q.map((x,i) => x + .5 * dt * d[i]); return norm(next);
}

// Positions/radii are MODEL metres. Runtime objectScale scales mass by s^3,
// moments by s^4 and section capacity by s^3. modelScale is provenance only.
export function packWoodStructure({ nodes, parent, radius, modelScale = 1,
  density = WOOD_STRUCTURE.densityKgM3, strength = WOOD_STRUCTURE.bendingStrengthPa }) {
  const count = parent.length;
  if (!count || nodes.length !== count * 3 || radius.length !== count || !(modelScale > 0)) throw Error('Invalid wood skeleton dimensions');
  const data = new Float32Array(count * 16), depth = new Uint32Array(count), mass = new Float64Array(count), center = new Float64Array(count * 3);
  let maxDepth = 0;
  for (let i=0;i<count;i++) {
    const p = parent[i], o = i*16, pos = Array.from(nodes.slice(i*3,i*3+3));
    if (!pos.every(Number.isFinite) || !Number.isFinite(radius[i]) || radius[i] <= 0 || !Number.isInteger(p) || p < -1 || p >= i || (i > 0 && p < 0)) throw Error('Skeleton must be a finite parent-before-child rooted tree');
    const a = p < 0 ? [0,1,0] : sub(pos, Array.from(nodes.slice(p*3,p*3+3))), l = p < 0 ? 0 : length(a);
    if (p >= 0 && l <= 1e-8) throw Error('Zero-length wood beam');
    depth[i] = p < 0 ? 0 : depth[p] + 1; maxDepth = Math.max(maxDepth,depth[i]);
    const r = radius[i], m = Math.PI*r*r*l*density;
    mass[i] = m; const midpoint = p < 0 ? pos : mul(add(pos, Array.from(nodes.slice(p*3,p*3+3))),.5);
    center.set(mul(midpoint,m),i*3);
    data.set([...pos,p,...norm(a),radius[i],m,m,l,p < 0 ? 1 : 0,...pos,strength],o);
  }
  for (let i=count-1;i>0;i--) { const p=parent[i]; mass[p]+=mass[i]; for(let j=0;j<3;j++)center[p*3+j]+=center[i*3+j]; }
  for (let i=0;i<count;i++) { const o=i*16; data[o+9]=mass[i]; for(let j=0;j<3;j++)data[o+12+j]=mass[i]>0?center[i*3+j]/mass[i]:data[o+j]; }
  return { data, count, maxDepth, modelScale, layoutVersion:1 };
}
export function resetWoodStructure(structure) {
  const state = new Float32Array(structure.count*16);
  for(let i=0;i<structure.count;i++) { const o=i*16; state.set([structure.data[o],structure.data[o+1],structure.data[o+2],-1,0,0,0,1,0,0,0,0,0,0,0,0],o); }
  return state;
}
export function woodSubtreeBounds(structure){const s=structure.data,b=new Float32Array(structure.count*8);for(let i=0;i<structure.count;i++){const o=i*16,bo=i*8,p=s[o+3];for(let j=0;j<3;j++){const a=s[o+j],z=p<0?a:s[p*16+j];b[bo+j]=Math.min(a,z)-s[o+7];b[bo+4+j]=Math.max(a,z)+s[o+7];}}for(let i=structure.count-1;i>0;i--){const p=s[i*16+3];for(let j=0;j<3;j++){b[p*8+j]=Math.min(b[p*8+j],b[i*8+j]);b[p*8+4+j]=Math.max(b[p*8+4+j],b[i*8+4+j]);}}return b;}

// Five samples on each beam prevent a hot tip alone from removing its entire
// load-bearing section. Sample coordinates remain in REST material space.
export function woodBondResponse(structure, i, sample, { externalForce=[0,0,0], worldScale=1, rotation=[0,0,0,1],subtreeMass=null }={}) {
  const o=i*16,s=structure.data,p=s[o+3],rest=Array.from(s.slice(o,o+3)),axis=Array.from(s.slice(o+4,o+7));
  let stock=0,char=0,stiffness=0,heat=0,crack=0,valid=0;
  for(let j=0;j<5;j++) {
    const point=sub(rest,mul(axis,s[o+10]*(j+.5)/5)),v=sample(point,i);
    if (!v || ![...v.stock,...v.wear].every(Number.isFinite)) throw Error('Wood samples must be finite');
    // Void fields are all zero. Spent wood retains irreversible wear, so it is
    // still a valid material sample even after all combustible stock is gone.
    if(!(v.valid??[...v.stock,...v.wear].some(x=>x!==0)))continue;
    valid++;stock+=clamp(v.stock[0],0,1); char+=clamp(v.stock[3],0,1);
    heat+=Math.max(v.stock[1],v.wear[1],0); crack+=clamp(v.wear[2],0,1); stiffness+=clamp(v.wear[3],0,1);
  }
  if(valid){stock/=valid;char/=valid;heat/=valid;crack/=valid;stiffness/=valid;}else{stock=1;stiffness=1;}
  // r^3 bending capacity and r^4 stiffness are retained explicitly; uniform
  // section loss is a surrogate for an unresolved asymmetric char front.
  const section=clamp(stock+.12*char,0,1), radius=s[o+7]*worldScale;
  const capacity=s[o+15]*(Math.PI*radius**3/4)*section**1.5*stiffness*(1-.65*crack);
  const lever=mul(rotateWood(rotation,sub(Array.from(s.slice(o+12,o+15)),rest)),worldScale),grain=rotateWood(rotation,axis);
  const remaining=subtreeMass??s[o+9];
  const load=add([0,-remaining*worldScale**3*9.81,0],externalForce);
  const torque=cross(lever,load), bending=sub(torque,mul(grain,dot(torque,grain)));
  const area=Math.PI*radius**2*section,integrity=stiffness*(1-.65*crack),axial=dot(load,grain);
  const axialCapacity=s[o+15]*(axial<0?WOOD_STRUCTURE.compressionStrengthRatio:WOOD_STRUCTURE.tensionStrengthRatio)*area*integrity;
  const shearCapacity=s[o+15]*WOOD_STRUCTURE.shearStrengthRatio*area*integrity;
  const bendingRatio=length(bending)/Math.max(capacity,1e-12),axialRatio=Math.abs(axial)/Math.max(axialCapacity,1e-12),shearRatio=length(sub(load,mul(grain,axial)))/Math.max(shearCapacity,1e-12);
  const ratio=Math.max(bendingRatio,axialRatio,shearRatio);
  return { ratio:p<0?0:ratio, heat, stock, char, stiffness, crack, capacity, moment:length(bending),
    inertia:Math.PI*radius**4/4, remainingMass:remaining*worldScale**3, validSamples:valid,
    area,axialCapacity,shearCapacity,bendingRatio,axialRatio,shearRatio };
}
// CPU reference uses graph-owned dry mass and mean local inventory. Production
// instead reduces EVERY64³ donor's exact initial mass and actual stock to its
// owner and bounded ancestors, avoiding this reference's spatial approximation.
export function woodRemainingMass(structure,sample,state=null){const m=new Float64Array(structure.count);for(let i=0;i<structure.count;i++){const b=woodBondResponse(structure,i,sample);m[i]=structure.data[i*16+8]*clamp(b.stock+b.char,0,1);}for(let i=structure.count-1;i>0;i--){if(state&&state[i*16+15]>=1&&structure.data[i*16+11]<.5)continue;m[structure.data[i*16+3]]+=m[i];}return m;}
export function woodEulerIntervals(structure){const children=Array.from({length:structure.count},()=>[]);for(let i=1;i<structure.count;i++)children[structure.data[i*16+3]].push(i);const start=new Uint32Array(structure.count),end=new Uint32Array(structure.count),order=[];const visit=i=>{start[i]=order.length;order.push(i);for(const c of children[i])visit(c);end[i]=order.length;};visit(0);return{start,end,order:Uint32Array.from(order)};}
export function woodDonorMass(structure,{owners,metadata,stock,state=null,quantized=false}){
 if(metadata.length!==owners.length*4||stock.length!==metadata.length)throw Error('Invalid wood donor arrays');
 const mass=new Float64Array(structure.count);
 for(let d=0;d<owners.length;d++){let amount=metadata[d*4+3]*clamp(stock[d*4]+stock[d*4+3],0,1);if(!Number.isFinite(amount)||amount<0)throw Error('Nonfinite wood donor mass');if(quantized)amount=Math.round(amount*1e6)/1e6;if(amount===0)continue;let i=owners[d];if(i>=structure.count)throw Error('Invalid wood donor owner');for(let depth=0;depth<=structure.maxDepth&&i>=0;depth++){mass[i]+=amount;if(quantized&&mass[i]*1e6>=4294967296)throw Error('Wood microkg counter overflow');if(state&&state[i*16+15]>=1&&structure.data[i*16+11]<.5)break;i=structure.data[i*16+3];}}
 return mass;
}
// Integer reference for the production two-level reduction. Donor rounding is
// unchanged; grouping by owner first changes only the order of exact u32 sums.
export function woodHierarchicalDonorMass(structure,{owners,metadata,stock,state=null}){
 if(metadata.length!==owners.length*4||stock.length!==metadata.length)throw Error('Invalid wood donor arrays');
 const own=new Float64Array(structure.count),mass=new Float64Array(structure.count);
 for(let d=0;d<owners.length;d++){const amount=Math.round(metadata[d*4+3]*clamp(stock[d*4]+stock[d*4+3],0,1)*1e6);if(!Number.isFinite(amount)||amount<0)throw Error('Nonfinite wood donor mass');if(!amount)continue;const i=owners[d];if(i>=structure.count)throw Error('Invalid wood donor owner');own[i]+=amount;if(own[i]>=4294967296)throw Error('Wood microkg counter overflow');}
 for(let node=0;node<structure.count;node++){const amount=own[node];if(!amount)continue;let i=node;for(let depth=0;depth<=structure.maxDepth&&i>=0;depth++){mass[i]+=amount;if(mass[i]>=4294967296)throw Error('Wood microkg counter overflow');if(state&&state[i*16+15]>=1&&structure.data[i*16+11]<.5)break;i=structure.data[i*16+3];}}
 return Float64Array.from(mass,x=>x/1e6);
}

// First pass changes ONLY persistent bond damage. Separate ancestor resolution
// avoids data races and makes a whole fractured subtree move on the same frame.
export function woodFailurePass(structure, old, sample, {dt=0,externalForce=[0,0,0],worldScale=1}={}) {
  if(old.length!==structure.count*16 || !Number.isFinite(dt) || dt<0)throw Error('Invalid structural state');
  const out=old.slice(), h=Math.min(dt,1/30),remaining=woodRemainingMass(structure,sample,old);
  for(let i=0;i<structure.count;i++) {
    const o=i*16,response=woodBondResponse(structure,i,sample,{externalForce,worldScale,rotation:Array.from(old.slice(o+4,o+8)),subtreeMass:remaining[i]});
    out[o+11]=response.heat;
    if(structure.data[o+11]>.5)continue;
    out[o+15]=clamp(old[o+15]+h*8*Math.max(response.ratio-1,0),0,1);
  }
  return out;
}
export function woodPosePass(structure, failure, {dt=0,worldScale=1,floorY=-Infinity,bounds=null}={}) {
  if(!(worldScale>0)||!Number.isFinite(dt)||dt<0)throw Error('Invalid wood pose step');
  const out=failure.slice(),h=Math.min(dt,1/30),s=structure.data;
  for(let i=0;i<structure.count;i++) {
    let root=-1,p=i,steps=0;
    while(p>=0 && steps++<=structure.maxDepth) { const o=p*16; if(failure[o+15]>=1 && s[o+11]<.5){root=p;break;}p=s[o+3]; }
    const o=i*16;out[o+3]=root;
    if(root<0){out.set(s.slice(o,o+3),o);out.set([0,0,0,1],o+4);out.fill(0,o+8,o+11);out.fill(0,o+12,o+15);continue;}
    if(root!==i)continue;
    let position=Array.from(failure.slice(o,o+3)),q=Array.from(failure.slice(o+4,o+8)),v=Array.from(failure.slice(o+8,o+11)),w=Array.from(failure.slice(o+12,o+15));
    // A new piece inherits its previous rigid pose/velocity; attached pieces
    // begin at rest, while pieces already detached remain persistent.
    const lever=rotateWood(q,sub(Array.from(s.slice(o+12,o+15)),Array.from(s.slice(o,o+3))));
    const span=Math.max(length(lever),s[o+10],s[o+7]),torque=cross(lever,[0,-9.81/worldScale,0]);
    // A bounded release impulse approximates stored bending energy. After
    // release, gravity acts through COM and cannot add angular momentum.
    if(failure[o+3]!==i)w=add(w,mul(torque,h/(span*span*.4)));
    w=mul(w,Math.exp(-.35*h));v[1]-=9.81*h/worldScale;
    const center=add(add(position,lever),mul(v,h));q=integrateQuaternion(q,w,h);
    position=sub(center,rotateWood(q,sub(Array.from(s.slice(o+12,o+15)),Array.from(s.slice(o,o+3)))));
    // Coarse beam endpoint contact is a fallback; the runtime may provide its
    // deformed solid proxy contact. It is not full subtree mesh collision.
    const end=add(position,rotateWood(q,mul(Array.from(s.slice(o+4,o+7)),-s[o+10])));
    let lowest=Math.min(position[1],end[1],position[1]+lever[1])-s[o+7];
    if(bounds){lowest=Infinity;for(let corner=0;corner<8;corner++){const p=[0,1,2].map(j=>bounds[i*8+j+((corner&(1<<j))?4:0)]);lowest=Math.min(lowest,position[1]+rotateWood(q,sub(p,Array.from(s.slice(o,o+3))))[1]);}}
    if(lowest<floorY){position[1]+=floorY-lowest;v[1]=Math.max(0,-v[1]*.08);v[0]*=Math.exp(-5*h);v[2]*=Math.exp(-5*h);w=mul(w,Math.exp(-5*h));}
    out.set(position,o);out.set(q,o+4);out.set(v,o+8);out.set(w,o+12);
  }
  // A descendant uses its piece root's pose, not an independently falling rod.
  for(let i=0;i<structure.count;i++){const o=i*16,r=out[o+3];if(r<0||r===i)continue;const ro=r*16,q=Array.from(out.slice(ro+4,ro+8));out.set(add(Array.from(out.slice(ro,ro+3)),rotateWood(q,sub(Array.from(s.slice(o,o+3)),Array.from(s.slice(ro,ro+3))))),o);out.set(q,o+4);out.set(out.slice(ro+8,ro+11),o+8);out.set(out.slice(ro+12,ro+15),o+12);}
  return out;
}
export function woodVertexPose(structure,state,owner,point,normal=[0,1,0]) {
  const r=state[owner*16+3];if(r<0)return{point:[...point],normal:[...normal]};
  const o=r*16,q=Array.from(state.slice(o+4,o+8));return{point:add(Array.from(state.slice(o,o+3)),rotateWood(q,sub(point,Array.from(structure.data.slice(o,o+3))))),normal:rotateWood(q,normal)};
}
export function woodCapVisible(state,owner,other){const a=state[owner*16+3];return other===0xffffffff?a>=0:a!==state[other*16+3];}
export function woodPoseWGSL({staticBinding=35,stateBinding=36}={}) {return `
struct WoodNode { restParent:vec4f, axisRadius:vec4f, massSection:vec4f, centerStrength:vec4f };
struct WoodPose { positionDetached:vec4f, rotation:vec4f, velocityHeat:vec4f, angularDamage:vec4f };
@group(0) @binding(${staticBinding}) var<storage,read> woodNodes:array<WoodNode>;
@group(0) @binding(${stateBinding}) var<storage,read> woodPoses:array<WoodPose>;
fn woodRotate(q:vec4f,p:vec3f)->vec3f {let t=2.0*cross(q.xyz,p);return p+q.w*t+cross(q.xyz,t);}
fn woodPiece(owner:u32)->i32 {return i32(woodPoses[owner].positionDetached.w);}
fn woodTransformRest(owner:u32,p:vec3f)->vec3f {let r=woodPiece(owner);if(r<0){return p;}let a=woodPoses[u32(r)];return a.positionDetached.xyz+woodRotate(a.rotation,p-woodNodes[u32(r)].restParent.xyz);}
fn woodTransformNormal(owner:u32,n:vec3f)->vec3f {let r=woodPiece(owner);if(r<0){return n;}return woodRotate(woodPoses[u32(r)].rotation,n);}
fn woodInversePose(owner:u32,p:vec3f)->vec3f {let r=woodPiece(owner);if(r<0){return p;}let a=woodPoses[u32(r)];return woodNodes[u32(r)].restParent.xyz+woodRotate(vec4f(-a.rotation.xyz,a.rotation.w),p-a.positionDetached.xyz);}
fn woodCapVisible(owner:u32,other:u32)->bool {if(other==0xffffffffu){return woodPiece(owner)>=0;}return woodPiece(owner)!=woodPiece(other);}
`;}

// Bindings are caller-owned to avoid collisions with the gas/solid renderer.
// struct inputs exactly match the 64 B CPU arrays; failure and pose dispatches
// must be separate, with a workgroup-independent storage barrier between them.
export function woodStructureWGSL({staticBinding=35,stateBinding=36,outputBinding=38,settingsBinding=39,skinBinding=12,wearBinding=15,boundsBinding=40,metadataBinding=43,donorBinding=37,ownersBinding=41,massBinding=46,ownMassBinding=47,maxDepth=54}={}) {
  return `
struct WoodNode { restParent:vec4f, axisRadius:vec4f, massSection:vec4f, centerStrength:vec4f };
struct WoodPose { positionDetached:vec4f, rotation:vec4f, velocityHeat:vec4f, angularDamage:vec4f };
struct WoodSettings { stepScaleFloorCount:vec4f, modelScaleForce:vec4f };
struct WoodBounds { low:vec4f, high:vec4f };
struct WoodMetadata { broken:atomic<u32>, revision:atomic<u32>, reserved0:u32, reserved1:u32 };
@group(0) @binding(${staticBinding}) var<storage,read> woodNodes:array<WoodNode>;
@group(0) @binding(${stateBinding}) var<storage,read> woodOld:array<WoodPose>;
@group(0) @binding(${outputBinding}) var<storage,read_write> woodNext:array<WoodPose>;
@group(0) @binding(${settingsBinding}) var<uniform> woodSettings:WoodSettings;
@group(0) @binding(${skinBinding}) var woodSkin:texture_3d<f32>;
@group(0) @binding(${wearBinding}) var woodWear:texture_3d<f32>;
@group(0) @binding(${boundsBinding}) var<storage,read> woodBounds:array<WoodBounds>;
@group(0) @binding(${metadataBinding}) var<storage,read_write> woodMetadata:WoodMetadata;
@group(0) @binding(${donorBinding}) var woodMassDonors:texture_3d<f32>;
@group(0) @binding(${ownersBinding}) var<storage,read> woodOwners:array<u32>;
@group(0) @binding(${massBinding}) var<storage,read_write> woodMass:array<atomic<u32>>;
@group(0) @binding(${ownMassBinding}) var<storage,read_write> woodOwnMass:array<atomic<u32>>;
fn woodRotate(q:vec4f,p:vec3f)->vec3f { let t=2.0*cross(q.xyz,p); return p+q.w*t+cross(q.xyz,t); }
fn woodField(t:texture_3d<f32>,p:vec3f)->vec4f { let n=vec3i(textureDimensions(t));return textureLoad(t,clamp(vec3i((p+1.5)/3.0*vec3f(n)),vec3i(0),n-1),0); }
@compute @workgroup_size(64) fn woodMassClear(@builtin(global_invocation_id) id:vec3u){if(id.x<u32(woodSettings.stepScaleFloorCount.w)){atomicStore(&woodMass[id.x],0u);atomicStore(&woodOwnMass[id.x],0u);}}
@compute @workgroup_size(4,4,4) fn woodMassScatter(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(woodMassDonors);if(any(id>=size)){return;}let q=vec3i(id);let donor=textureLoad(woodMassDonors,q,0);if(donor.w<=0.0){return;}
 let stock=textureLoad(woodSkin,q,0);let amount=u32(round(donor.w*clamp(stock.x+stock.w,0.0,1.0)*1000000.0));if(amount==0u){return;}
 let owner=woodOwners[id.x+size.x*(id.y+size.y*id.z)];if(owner>=u32(woodSettings.stepScaleFloorCount.w)){return;}
 atomicAdd(&woodOwnMass[owner],amount);
}
// At most nodeCount bounded ancestor walks, rather than one walk per donor.
// All additions remain integer microkg, including already detached partitions.
@compute @workgroup_size(64) fn woodMassAggregate(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=u32(woodSettings.stepScaleFloorCount.w)){return;}let amount=atomicLoad(&woodOwnMass[id.x]);if(amount==0u){return;}var owner=i32(id.x);
 for(var depth=0u;depth<=${maxDepth}u;depth++){if(owner<0){break;}let i=u32(owner);atomicAdd(&woodMass[i],amount);if(woodOld[i].angularDamage.w>=1.0 && woodNodes[i].massSection.w<.5){break;}owner=i32(woodNodes[i].restParent.w);}
}
@compute @workgroup_size(64) fn woodFailure(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(woodSettings.stepScaleFloorCount.w)){return;} let n=woodNodes[i];var v=woodOld[i];
 var stock=0.0;var char=0.0;var heat=0.0;var stiff=0.0;var crack=0.0;var valid=0.0;
 for(var j=0u;j<5u;j++){let p=n.restParent.xyz-n.axisRadius.xyz*n.massSection.z*(f32(j)+.5)/5.0;let s=woodField(woodSkin,p);let w=woodField(woodWear,p);if(!any(s!=vec4f(0)) && !any(w!=vec4f(0))){continue;}valid+=1.0;stock+=clamp(s.x,0.0,1.0);char+=clamp(s.w,0.0,1.0);heat+=max(max(s.y,w.y),0.0);stiff+=clamp(w.w,0.0,1.0);crack+=clamp(w.z,0.0,1.0);}
 if(valid>0.0){stock/=valid;char/=valid;heat/=valid;stiff/=valid;crack/=valid;}else{stock=1.0;stiff=1.0;}
 v.velocityHeat.w=heat;
 if(n.massSection.w<.5){let r=n.axisRadius.w*woodSettings.stepScaleFloorCount.y;let section=clamp(stock+.12*char,0.0,1.0);let capacity=n.centerStrength.w*(.7853981633974483*r*r*r)*pow(section,1.5)*stiff*(1.0-.65*crack);
 let lever=woodRotate(v.rotation,n.centerStrength.xyz-n.restParent.xyz)*woodSettings.stepScaleFloorCount.y;let load=vec3f(0.0,-f32(atomicLoad(&woodMass[i]))*.000001*pow(woodSettings.stepScaleFloorCount.y,3.0)*9.81,0.0)+woodSettings.modelScaleForce.yzw;let torque=cross(lever,load);let grain=woodRotate(v.rotation,n.axisRadius.xyz);let bending=torque-grain*dot(torque,grain);
 // Independent reduced axial/shear checks keep zero-torque uprights loaded.
 let area=3.141592653589793*r*r*section;let integrity=stiff*(1.0-.65*crack);let axial=dot(load,grain);
 let axialCapacity=n.centerStrength.w*select(${WOOD_STRUCTURE.tensionStrengthRatio},${WOOD_STRUCTURE.compressionStrengthRatio},axial<0.0)*area*integrity;
 let shearCapacity=n.centerStrength.w*${WOOD_STRUCTURE.shearStrengthRatio}*area*integrity;
 let ratio=max(length(bending)/max(capacity,1e-12),max(abs(axial)/max(axialCapacity,1e-12),length(load-grain*axial)/max(shearCapacity,1e-12)));
 v.angularDamage.w=clamp(v.angularDamage.w+min(woodSettings.stepScaleFloorCount.x,1.0/30.0)*8.0*max(ratio-1.0,0.0),0.0,1.0);}
 if(woodOld[i].angularDamage.w<1.0 && v.angularDamage.w>=1.0){atomicAdd(&woodMetadata.broken,1u);atomicAdd(&woodMetadata.revision,1u);} woodNext[i]=v;
}

@compute @workgroup_size(64) fn woodPose(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(woodSettings.stepScaleFloorCount.w)){return;}let n=woodNodes[i];var v=woodOld[i];var root=-1;var p=i32(i);
 for(var step=0u;step<=${maxDepth}u;step++){if(p<0){break;}let a=woodNodes[u32(p)];if(woodOld[u32(p)].angularDamage.w>=1.0 && a.massSection.w<.5){root=p;break;}p=i32(a.restParent.w);}
 v.positionDetached.w=f32(root);let dt=min(woodSettings.stepScaleFloorCount.x,1.0/30.0);
 if(root<0){v.positionDetached=vec4f(n.restParent.xyz,v.positionDetached.w);v.rotation=vec4f(0,0,0,1);v.velocityHeat=vec4f(0,0,0,v.velocityHeat.w);v.angularDamage=vec4f(0,0,0,v.angularDamage.w);woodNext[i]=v;return;}
 // Every invocation independently advances its selected ROOT from the same
 // immutable input. This gives exact subtree coherence without a third pass.
 let r=woodNodes[u32(root)];var a=woodOld[u32(root)];let lever=woodRotate(a.rotation,r.centerStrength.xyz-r.restParent.xyz);let span=max(max(length(lever),r.massSection.z),r.axisRadius.w);var omega=a.angularDamage.xyz;if(i32(a.positionDetached.w)!=root){omega+=cross(lever,vec3f(0,-9.81/woodSettings.stepScaleFloorCount.y,0))*dt/(span*span*.4);}omega*=exp(-.35*dt);
 var velocity=a.velocityHeat.xyz+vec3f(0,-9.81*dt/woodSettings.stepScaleFloorCount.y,0);let center=a.positionDetached.xyz+lever+velocity*dt;let q=a.rotation;let dq=vec4f(q.w*omega+cross(q.xyz,omega),-dot(q.xyz,omega));var rotation=normalize(q+.5*dt*dq);var position=center-woodRotate(rotation,r.centerStrength.xyz-r.restParent.xyz);
 var lowest=1e20;let box=woodBounds[u32(root)];for(var c=0u;c<8u;c++){let point=vec3f(select(box.low.x,box.high.x,(c&1u)!=0u),select(box.low.y,box.high.y,(c&2u)!=0u),select(box.low.z,box.high.z,(c&4u)!=0u));lowest=min(lowest,position.y+woodRotate(rotation,point-r.restParent.xyz).y);}let floor=woodSettings.stepScaleFloorCount.z;
 if(lowest<floor){position.y+=floor-lowest;velocity.y=max(0.0,-velocity.y*.08);velocity=vec3f(velocity.x*exp(-5.0*dt),velocity.y,velocity.z*exp(-5.0*dt));omega*=exp(-5.0*dt);}
 v.positionDetached=vec4f(position+woodRotate(rotation,n.restParent.xyz-r.restParent.xyz),v.positionDetached.w);v.rotation=rotation;v.velocityHeat=vec4f(velocity,v.velocityHeat.w);v.angularDamage=vec4f(omega,v.angularDamage.w);woodNext[i]=v;
}`;
}

// Allocate only after an actual wood mesh is chosen. Static/state buffer handles
// remain fixed across reset and frames; no GPU readback or per-frame GPU allocation.
export class WoodStructure {
  constructor(device,{nodes=null,bounds=null,count=0,maxDepth=54}={}) {
    this.device=device;this.nodes=nodes;this.boundsData=bounds;this.count=count||nodes?.length/16||0;this.maxDepth=maxDepth;this.ready=false;this.disposed=false;this.groups=null;this.fixedGroups=null;this.fieldGroups=[];
  }
  async init(assetURL=null) {
    if(this.ready)return this;
    if(this.initializing)throw Error('Structure initialization already pending');
    this.initializing=true;this.disposed=false;
    try{
    if(assetURL){const base=new URL(assetURL,globalThis.location?.href||'http://localhost/');const manifest=await(await fetch(new URL('manifest.json?v=7dfac6909b1f2622',base))).json();this.count=manifest.nodes;this.maxDepth=manifest.maxDepth;this.nodes=new Float32Array(await(await fetch(new URL('nodes.bin?v=7dfac6909b1f2622',base))).arrayBuffer());this.boundsData=new Float32Array(await(await fetch(new URL('bounds.bin?v=7dfac6909b1f2622',base))).arrayBuffer());}
    if(this.disposed)throw Error('Structure disposed during initialization');
    if(!this.count||this.nodes?.length!==this.count*16||!Number.isInteger(this.count)||this.maxDepth>256)throw Error('Invalid structure asset');
    const usage=GPUBufferUsage, make=(label,size,u)=>this.device.createBuffer({label,size:Math.max(size,16),usage:u});
    this.staticBuffer=make('wood graph',this.nodes.byteLength,usage.STORAGE|usage.COPY_DST);
    this.state=make('wood pose stable',this.nodes.byteLength,usage.STORAGE|usage.COPY_DST|usage.COPY_SRC);
    this.scratch=make('wood failure scratch',this.nodes.byteLength,usage.STORAGE|usage.COPY_DST);
    this.settings=make('wood mechanics settings',32,usage.UNIFORM|usage.COPY_DST);
    this.metadata=make('wood fracture counters',16,usage.STORAGE|usage.COPY_DST|usage.COPY_SRC);
    this.bounds=make('wood subtree bounds',this.count*32,usage.STORAGE|usage.COPY_DST);
    this.mass=make('wood remaining subtree mass microkg',this.count*4,usage.STORAGE|usage.COPY_DST|usage.COPY_SRC);
    this.ownMass=make('wood remaining owner mass microkg',this.count*4,usage.STORAGE|usage.COPY_DST|usage.COPY_SRC);
    this.device.queue.writeBuffer(this.staticBuffer,0,this.nodes);
    if(!this.boundsData)this.boundsData=woodSubtreeBounds({data:this.nodes,count:this.count});if(this.boundsData.length!==this.count*8)throw Error('Invalid structure bounds');this.device.queue.writeBuffer(this.bounds,0,this.boundsData);
    const module=this.device.createShaderModule({label:'wood beam mechanics',code:woodStructureWGSL({maxDepth:this.maxDepth})});
    [this.massClearPipeline,this.massScatterPipeline,this.massAggregatePipeline,this.failurePipeline,this.posePipeline]=await Promise.all(['woodMassClear','woodMassScatter','woodMassAggregate','woodFailure','woodPose'].map(entryPoint=>this.device.createComputePipelineAsync({label:entryPoint,layout:'auto',compute:{module,entryPoint}})));
    if(this.disposed)throw Error('Structure disposed during initialization');
    this.ready=true;this.reset();return this;
    }catch(error){this.dispose();throw error;}
    finally{this.initializing=false;}
  }
  reset(){if(!this.state)return;const initial=resetWoodStructure({data:this.nodes,count:this.count});this.device.queue.writeBuffer(this.state,0,initial);this.device.queue.writeBuffer(this.scratch,0,initial);this.device.queue.writeBuffer(this.metadata,0,new Uint32Array(4));this.device.queue.writeBuffer(this.mass,0,new Uint32Array(this.count));this.device.queue.writeBuffer(this.ownMass,0,new Uint32Array(this.count));}
  poseBindings(){return [{binding:35,resource:{buffer:this.staticBuffer}},{binding:36,resource:{buffer:this.state}}];}
  encode(encoder,{dt,skin,wear,owners,metadata,origin=[0,0,0],scale=1,externalForce=[0,0,0]}={}){
    if(!this.ready||this.disposed||!(dt>0))return false;
    if(!Number.isFinite(dt)||!(scale>0)||!origin.every(Number.isFinite)||!externalForce.every(Number.isFinite))throw Error('Invalid wood mechanics settings');
    if(!owners||!metadata)throw Error('Wood mechanics requires finite donor owners and mass metadata');
    this.device.queue.writeBuffer(this.settings,0,new Float32Array([Math.min(dt,1/30),scale,-origin[1]/scale,this.count,1,...externalForce]));
    if(!this.fixedGroups){
      const resource=buffer=>({buffer});
      this.fixedGroups={
        clear:this.device.createBindGroup({layout:this.massClearPipeline.getBindGroupLayout(0),entries:[{binding:39,resource:resource(this.settings)},{binding:46,resource:resource(this.mass)},{binding:47,resource:resource(this.ownMass)}]}),
        aggregate:this.device.createBindGroup({layout:this.massAggregatePipeline.getBindGroupLayout(0),entries:[{binding:35,resource:resource(this.staticBuffer)},{binding:36,resource:resource(this.state)},{binding:39,resource:resource(this.settings)},{binding:46,resource:resource(this.mass)},{binding:47,resource:resource(this.ownMass)}]}),
        pose:this.device.createBindGroup({layout:this.posePipeline.getBindGroupLayout(0),entries:[{binding:35,resource:resource(this.staticBuffer)},{binding:36,resource:resource(this.scratch)},{binding:38,resource:resource(this.state)},{binding:39,resource:resource(this.settings)},{binding:40,resource:resource(this.bounds)}]})};
    }
    // Production alternates two persistent field views every substep. Keep
    // both pairs; unchanged static passes share three groups across the pair.
    if(this.groupOwners!==owners||this.groupMetadata!==metadata){this.fieldGroups=[];this.groupOwners=owners;this.groupMetadata=metadata;}
    let fields=this.fieldGroups.find(group=>group.skin===skin&&group.wear===wear);
    if(!fields){
      const resource=buffer=>({buffer});
      fields={skin,wear,owners,metadata,...this.fixedGroups,
        scatter:this.device.createBindGroup({layout:this.massScatterPipeline.getBindGroupLayout(0),entries:[{binding:12,resource:skin},{binding:37,resource:metadata},{binding:39,resource:resource(this.settings)},{binding:41,resource:resource(owners)},{binding:47,resource:resource(this.ownMass)}]}),
        failure:this.device.createBindGroup({layout:this.failurePipeline.getBindGroupLayout(0),entries:[{binding:12,resource:skin},{binding:15,resource:wear},{binding:35,resource:resource(this.staticBuffer)},{binding:36,resource:resource(this.state)},{binding:38,resource:resource(this.scratch)},{binding:39,resource:resource(this.settings)},{binding:43,resource:resource(this.metadata)},{binding:46,resource:resource(this.mass)}]})};
      if(this.fieldGroups.length===2)this.fieldGroups.shift();this.fieldGroups.push(fields);
    }
    this.groups=fields;
    for(const [pipeline,group,scatter]of [[this.massClearPipeline,this.groups.clear,false],[this.massScatterPipeline,this.groups.scatter,true],[this.massAggregatePipeline,this.groups.aggregate,false],[this.failurePipeline,this.groups.failure,false],[this.posePipeline,this.groups.pose,false]]){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);if(scatter)pass.dispatchWorkgroups(16,16,16);else pass.dispatchWorkgroups(Math.ceil(this.count/64));pass.end();}
    return true;
  }
  dispose(){this.disposed=true;for(const name of ['staticBuffer','state','scratch','settings','metadata','bounds','mass','ownMass']){this[name]?.destroy();this[name]=null;}this.groups=null;this.fixedGroups=null;this.fieldGroups=[];this.groupOwners=null;this.groupMetadata=null;this.ready=false;}
}

// GLSL integration is function based: the Original engine provides bounded
// getNode/getPose/storePose + rest-space stock/wear callbacks for its atlas.
export function woodStructureGLSL(maxDepth=54) {
  return `
struct WoodNode{vec4 restParent;vec4 axisRadius;vec4 massSection;vec4 centerStrength;};
struct WoodPose{vec4 positionDetached;vec4 rotation;vec4 velocityHeat;vec4 angularDamage;};
vec3 woodRotate(vec4 q,vec3 p){vec3 t=2.0*cross(q.xyz,p);return p+q.w*t+cross(q.xyz,t);}
int woodPiece(int owner){return int(woodPoseAt(owner).positionDetached.w);}
vec3 woodTransformRest(int owner,vec3 p){int r=woodPiece(owner);if(r<0)return p;WoodPose a=woodPoseAt(r);return a.positionDetached.xyz+woodRotate(a.rotation,p-woodNodeAt(r).restParent.xyz);}
vec3 woodTransformNormal(int owner,vec3 n){int r=woodPiece(owner);return r<0?n:woodRotate(woodPoseAt(r).rotation,n);}
vec3 woodInversePose(int owner,vec3 p){int r=woodPiece(owner);if(r<0)return p;WoodPose a=woodPoseAt(r);return woodNodeAt(r).restParent.xyz+woodRotate(vec4(-a.rotation.xyz,a.rotation.w),p-a.positionDetached.xyz);}
bool woodCapVisible(int owner,uint other){return other==0xffffffffu?woodPiece(owner)>=0:woodPiece(owner)!=woodPiece(int(other));}
WoodPose woodFailure(int i,WoodNode n,WoodPose v,float dt,float worldScale,vec3 force){
 float stock=0.,ch=0.,heat=0.,stiff=0.,crack=0.,valid=0.;for(int j=0;j<5;j++){vec3 p=n.restParent.xyz-n.axisRadius.xyz*n.massSection.z*(float(j)+.5)/5.;vec4 s=woodStockAt(p);vec4 w=woodWearAt(p);if(!any(notEqual(s,vec4(0)))&&!any(notEqual(w,vec4(0))))continue;valid+=1.;stock+=clamp(s.x,0.,1.);ch+=clamp(s.w,0.,1.);heat+=max(max(s.y,w.y),0.);stiff+=clamp(w.w,0.,1.);crack+=clamp(w.z,0.,1.);}if(valid>0.){stock/=valid;ch/=valid;heat/=valid;stiff/=valid;crack/=valid;}else{stock=1.;stiff=1.;}v.velocityHeat.w=heat;
 if(n.massSection.w<.5){float r=n.axisRadius.w*worldScale;float section=clamp(stock+.12*ch,0.,1.);float integrity=stiff*(1.-.65*crack);float capacity=n.centerStrength.w*(.7853981633974483*r*r*r)*pow(section,1.5)*integrity;
 vec3 load=vec3(0,-woodRemainingMassAt(i)*pow(worldScale,3.)*9.81,0)+force;vec3 grain=woodRotate(v.rotation,n.axisRadius.xyz);vec3 torque=cross(woodRotate(v.rotation,n.centerStrength.xyz-n.restParent.xyz)*worldScale,load);
 float area=3.141592653589793*r*r*section;float axial=dot(load,grain);float axialCapacity=n.centerStrength.w*(axial<0.?${WOOD_STRUCTURE.compressionStrengthRatio}:${WOOD_STRUCTURE.tensionStrengthRatio})*area*integrity;float shearCapacity=n.centerStrength.w*${WOOD_STRUCTURE.shearStrengthRatio}*area*integrity;
 float ratio=max(length(torque-grain*dot(torque,grain))/max(capacity,1e-12),max(abs(axial)/max(axialCapacity,1e-12),length(load-grain*axial)/max(shearCapacity,1e-12)));
 v.angularDamage.w=clamp(v.angularDamage.w+min(dt,1./30.)*8.*max(ratio-1.,0.),0.,1.);}return v;
}
WoodPose woodPose(int i,float dt,float worldScale,float floorY){WoodNode n=woodNodeAt(i);WoodPose v=woodPoseAt(i);int root=-1,p=i;for(int step=0;step<=${maxDepth};step++){if(p<0)break;WoodNode a=woodNodeAt(p);if(woodPoseAt(p).angularDamage.w>=1.&&a.massSection.w<.5){root=p;break;}p=int(a.restParent.w);}v.positionDetached.w=float(root);dt=min(dt,1./30.);
 if(root<0){v.positionDetached.xyz=n.restParent.xyz;v.rotation=vec4(0,0,0,1);v.velocityHeat.xyz=vec3(0);v.angularDamage.xyz=vec3(0);return v;}
 WoodNode r=woodNodeAt(root);WoodPose a=woodPoseAt(root);vec3 lever=woodRotate(a.rotation,r.centerStrength.xyz-r.restParent.xyz);float span=max(max(length(lever),r.massSection.z),r.axisRadius.w);vec3 omega=a.angularDamage.xyz;if(int(a.positionDetached.w)!=root)omega+=cross(lever,vec3(0,-9.81/worldScale,0))*dt/(span*span*.4);omega*=exp(-.35*dt);vec3 velocity=a.velocityHeat.xyz+vec3(0,-9.81*dt/worldScale,0);vec3 center=a.positionDetached.xyz+lever+velocity*dt;vec4 q=a.rotation;vec4 rotation=normalize(q+.5*dt*vec4(q.w*omega+cross(q.xyz,omega),-dot(q.xyz,omega)));vec3 position=center-woodRotate(rotation,r.centerStrength.xyz-r.restParent.xyz);vec3 endpoint=position+woodRotate(rotation,-r.axisRadius.xyz*r.massSection.z);float low=min(min(position.y,endpoint.y),position.y+lever.y)-r.axisRadius.w;if(low<floorY){position.y+=floorY-low;velocity.y=max(0.,-velocity.y*.08);velocity.xz*=exp(-5.*dt);omega*=exp(-5.*dt);}v.positionDetached.xyz=position+woodRotate(rotation,n.restParent.xyz-r.restParent.xyz);v.rotation=rotation;v.velocityHeat.xyz=velocity;v.angularDamage.xyz=omega;return v;}
`;
}
