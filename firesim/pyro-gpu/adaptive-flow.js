import { simulationShaders } from './shaders.js?v=5316305f3032d241';

// Byte offsets in the persistent STORAGE | INDIRECT | COPY_DST command buffer.
// The first seven dispatches and telemetry retain their existing layout.
export const ADAPTIVE_FLOW_OFFSETS = Object.freeze({
  coarse: 0, fill: 12, finePredict: 24, fineCurlCorrect: 36,
  densePredict: 48, denseCurl: 60, denseCorrect: 72,
  fineCount: 84, sparse: 88, stickyDense: 92,
  sourceWork: 96, restrict: 108, chemistry: 120, mark: 132,
  build: 144, finish: 156,
});
export const ADAPTIVE_FLOW_COMMAND_BYTES = 168;

function hierarchy(N, D, tile = 8) {
  if (!Number.isInteger(N) || !Number.isInteger(D) ||
      N < 16 || N % (2 * tile) || D !== 2 * N || tile !== 8)
    throw Error('Adaptive flow requires a factor-two 8-cell MAC hierarchy');
  return { C: N / 2, B: N / tile, T: (N / tile) ** 3 };
}

// Upload once at creation and again after a clean simulation reset. Never
// rewrite these commands during a running simulation: the GPU owns the sticky
// flag and disables classification after the first unsafe sparse decision.
// Reset also requires the runtime's normal chemistry/velocity/mask clears.
export function initialAdaptiveFlowCommands(N = 128, D = 256) {
  const { C, B } = hierarchy(N, D);
  const commands = new Uint32Array(ADAPTIVE_FLOW_COMMAND_BYTES / 4);
  function dispatch(offset, x, y, z) { commands.set([x, y, z], offset / 4); }
  const coarse = Math.ceil((C + 1) / 4), packed = Math.ceil((N + 1) / 4);
  // Dense is the safe initial mode until the first GPU finish chooses a mode.
  dispatch(ADAPTIVE_FLOW_OFFSETS.coarse, 0, coarse, coarse);
  dispatch(ADAPTIVE_FLOW_OFFSETS.fill, 0, packed, packed);
  dispatch(ADAPTIVE_FLOW_OFFSETS.finePredict, 0, 2, 2);
  dispatch(ADAPTIVE_FLOW_OFFSETS.fineCurlCorrect, 0, 2, 4);
  dispatch(ADAPTIVE_FLOW_OFFSETS.densePredict, Math.ceil((N + 1) / 8), packed, packed);
  dispatch(ADAPTIVE_FLOW_OFFSETS.denseCurl, N / 4, N / 4, N / 4);
  dispatch(ADAPTIVE_FLOW_OFFSETS.denseCorrect, packed, packed, packed);
  const source = Math.ceil((D / 8) / 4), mark = B, build = Math.ceil(B / 4);
  dispatch(ADAPTIVE_FLOW_OFFSETS.sourceWork, source, source, source);
  dispatch(ADAPTIVE_FLOW_OFFSETS.restrict, coarse, coarse, coarse);
  dispatch(ADAPTIVE_FLOW_OFFSETS.chemistry, Math.ceil((D / 8) ** 3 / 64), 1, 1);
  dispatch(ADAPTIVE_FLOW_OFFSETS.mark, mark, mark, mark);
  dispatch(ADAPTIVE_FLOW_OFFSETS.build, build, build, build);
  dispatch(ADAPTIVE_FLOW_OFFSETS.finish, 1, 1, 1);
  return commands;
}

// Candidate two-level flow. The canonical fine MAC texture still supplies
// chemistry, projection and embers. Coarse faces are area-averaged from it;
// active fine tiles override coarse evolution before the global projection.
// This is an approximation in unrefined air, not bit-identical dense flow.
export function adaptiveFlowShaders(N = 128, D = 256, tile = 8) {
  const { C, B, T } = hierarchy(N, D, tile);
  const fine = simulationShaders(N, D), coarse = simulationShaders(C, D);
  const transfer = `const N:i32=${N};const C:i32=${C};
fn faceIndex(i:vec3i,k:u32,n:i32)->vec3i{
 var j=clamp(i,vec3i(0),vec3i(n-1));j[k]=clamp(i[k],0,n);return j;
}
`;
  const prolongFunctions = `
fn coarseFace(i:vec3i,k:u32)->f32{return textureLoad(coarse,faceIndex(i,k,C),0)[k];}
fn facePatch(i:vec3i,p:vec3i,k:u32)->f32{
 var value=coarseFace(p,k);
 for(var axis=0u;axis<3u;axis++){
  if(axis==k){continue;}var lo=p;var hi=p;
  lo[axis]=max(0,p[axis]-1);hi[axis]=min(C-1,p[axis]+1);
  let scale=select(.125,.25,lo[axis]==p[axis]||hi[axis]==p[axis]);
  let sign=select(-1.,1.,(i[axis]&1)==1);
  value+=sign*scale*(coarseFace(hi,k)-coarseFace(lo,k));
 }return value;
}
fn prolonged(raw:vec3i,k:u32)->f32{
 let i=faceIndex(raw,k,N);var p=i/2;let value=facePatch(i,p,k);
 if((i[k]&1)==1){p[k]+=1;return .5*(value+facePatch(i,p,k));}return value;
}
fn prolongedVector(i:vec3i)->vec3f{return vec3f(prolonged(i,0u),prolonged(i,1u),prolonged(i,2u));}
`;
  const restrict = transfer + `
@group(0) @binding(0) var fine:texture_3d<f32>;
@group(0) @binding(1) var dst:texture_storage_3d<rgba16float,write>;
fn readFace(i:vec3i,k:u32)->f32{return textureLoad(fine,faceIndex(i,k,N),0)[k];}
fn average(i:vec3i,k:u32)->f32{
 let b=faceIndex(i,k,C)*2;var a=vec3i(0);var d=vec3i(0);
 a[(k+1u)%3u]=1;d[(k+2u)%3u]=1;
 return .25*(readFace(b,k)+readFace(b+a,k)+readFace(b+d,k)+readFace(b+a+d,k));
}
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>vec3u(u32(C)))){return;}let i=vec3i(id);
 textureStore(dst,i,vec4f(average(i,0u),average(i,1u),average(i,2u),0));
}`;
  const mark = transfer + prolongFunctions + `
@group(0) @binding(0) var fine:texture_3d<f32>;
@group(0) @binding(1) var coarse:texture_3d<f32>;
@group(0) @binding(2) var<storage,read> chemistryWork:array<vec4u>;
@group(0) @binding(3) var<storage,read> chemistryArgs:array<u32>;
@group(0) @binding(4) var<storage,read_write> mask:array<atomic<u32>>;
var<workgroup> live:atomic<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=group;let index=tile.x+${B}u*(tile.y+${B}u*tile.z);
 if(lane==0u){atomicStore(&live,atomicLoad(&mask[index]));}workgroupBarrier();
 // This tests the old fine/coarse residual. It does not bound next-step
 // force/advection error; those require the evolving native quality gate.
 for(var local=lane;local<512u;local+=64u){
  if(atomicLoad(&live)!=0u){continue;}
  let i=vec3i(tile*8u+vec3u(local%8u,(local/8u)%8u,local/64u));
  let q=textureLoad(fine,i,0).xyz;
  if(any(abs(q-prolongedVector(i))>vec3f(.001))){atomicOr(&live,1u);}
 }
 workgroupBarrier();if(lane==0u){atomicStore(&mask[index],atomicLoad(&live));}
}
@compute @workgroup_size(64) fn chemistry(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=chemistryArgs[0]){return;}let b=chemistryWork[id.x].xyz/2u;
 atomicOr(&mask[b.x+${B}u*(b.y+${B}u*b.z)],1u);
}`;
  const build = `const B:i32=${B};const T:u32=${T}u;
@group(0) @binding(0) var<storage,read> mask:array<u32>;
@group(0) @binding(1) var<storage,read_write> tiles:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> count:atomic<u32>;
@group(0) @binding(3) var<storage,read_write> commands:array<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(u32(B)))){return;}var hasWork=false;
 // One full fine tile covers advection/interpolation and curl support under
 // the existing CFL bound. Source work already includes its chemistry halo.
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let b=vec3i(id)+vec3i(x,y,z);
  if(all(b>=vec3i(0))&&all(b<vec3i(B))){hasWork=hasWork||mask[u32(b.x+B*(b.y+B*b.z))]!=0u;}
 }}}
 if(hasWork){let slot=atomicAdd(&count,1u);tiles[slot]=vec4u(id,0u);}
}
@compute @workgroup_size(1) fn finish(){
 // Once sparse coverage is unsafe, use the original dense transport until a
 // clean reset. The indirect classifier commands are zero thereafter, so no
 // CPU readback or repeated full-grid classification is needed.
 if(commands[23]!=0u){return;}
 let n=atomicLoad(&count);var boundary=false;
 // Fine tiles do not own the packed outer normal face. Keep the full solve
 // whenever refinement reaches that face, rather than use a coarse boundary.
 // Coverage alone rejects at the same threshold; scanning boundaries cannot
 // change that result. Stop at the first outer-face tile when coverage is low.
 if(n*2u<T){for(var k=0u;k<n;k++){
  if(any(tiles[k].xyz==vec3u(u32(B-1)))){boundary=true;break;}
 }}
 let sparse=n*2u<T&&!boundary;
 // Seven dispatches: coarse grid; coarse/fine fill; fine predictor; fine
 // curl/correction; dense predictor; dense curl; dense correction.
 commands[0]=select(0u,${Math.ceil((C+1)/4)}u,sparse);commands[1]=${Math.ceil((C+1)/4)}u;commands[2]=${Math.ceil((C+1)/4)}u;
 commands[3]=select(0u,${Math.ceil((N+1)/4)}u,sparse);commands[4]=${Math.ceil((N+1)/4)}u;commands[5]=${Math.ceil((N+1)/4)}u;
 commands[6]=select(0u,n,sparse);commands[7]=2u;commands[8]=2u;
 commands[9]=select(0u,n,sparse);commands[10]=2u;commands[11]=4u;
 commands[12]=select(${Math.ceil((N+1)/8)}u,0u,sparse);commands[13]=${Math.ceil((N+1)/4)}u;commands[14]=${Math.ceil((N+1)/4)}u;
 commands[15]=select(${N/4}u,0u,sparse);commands[16]=${N/4}u;commands[17]=${N/4}u;
 commands[18]=select(${Math.ceil((N+1)/4)}u,0u,sparse);commands[19]=${Math.ceil((N+1)/4)}u;commands[20]=${Math.ceil((N+1)/4)}u;
 commands[21]=n;commands[22]=select(0u,1u,sparse);
 if(!sparse){
  commands[23]=1u;
  // sourceWork, restrict, chemistry, residual mark, list build and finish.
  // Chemistry simulation and the dense velocity commands remain enabled.
  commands[24]=0u;commands[27]=0u;commands[30]=0u;
  commands[33]=0u;commands[36]=0u;commands[39]=0u;
 }
}`;
  const fill = transfer + prolongFunctions + `
@group(0) @binding(0) var coarse:texture_3d<f32>;
@group(0) @binding(1) var dst:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>vec3u(u32(N)))){return;}let i=vec3i(id);
 // Expansion is carried from the coarse cell; active fine source tiles
 // replace it before constructing the globally connected pressure RHS.
 let expansion=textureLoad(coarse,clamp(i/2,vec3i(0),vec3i(C)),0).w;
 var v=prolongedVector(i);if(i.y==0){v.y=0.;}
 textureStore(dst,i,vec4f(v,expansion));
}`;
  function queued(code, predictor = false) {
    const signature = predictor
      ? '@builtin(global_invocation_id) i:vec3u'
      : '@builtin(global_invocation_id) i:vec3u';
    if (!code.includes(signature)) throw Error('Fine velocity entry changed');
    const index = predictor
      ? 'work[group.x].xyz*8u+vec3u(0u,group.y*4u,group.z*4u)+local'
      : 'work[group.x].xyz*8u+vec3u(group.y*4u,(group.z%2u)*4u,(group.z/2u)*4u)+local';
    code=code.replace(signature,'@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u');
    code=code.replace('){\n if(any(i',`){\n let i=${index};\n if(any(i`);
    return code+'\n@group(0) @binding(14) var<storage,read> work:array<vec4u>;';
  }
  const fillCell = `
@group(0) @binding(0) var coarse:texture_3d<f32>;
@group(0) @binding(1) var dst:texture_storage_3d<rgba16float,write>;
@group(0) @binding(2) var smp:sampler;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(${N}u))){return;}
 textureStore(dst,vec3i(id),textureSampleLevel(coarse,smp,(vec3f(id)+.5)/${N}.,0));
}`;
  const sourceWork=fine.buildBricks.replace('oldMask[index]>0u||previousMask[index]>0u','(oldMask[index]&4u)!=0u||(previousMask[index]&4u)!=0u');
  return { restrict, mark, build, fill, fillCell, sourceWork,
    coarseAdvect:coarse.advectVelocity.replace('@workgroup_size(8,4,4)','@workgroup_size(4,4,4)'),
    coarseCurl:coarse.curl,
    // Preserve the fine model's confinement length coefficient in coarse air.
    coarseCorrect:coarse.correctVelocity.replace('let confinement=2.0*H*','let confinement=1.0*H*'),
    fineAdvect:queued(fine.advectVelocity,true),fineCurl:queued(fine.curl),fineCorrect:queued(fine.correctVelocity) };
}
