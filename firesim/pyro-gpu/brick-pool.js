import { simulationShaders } from './shaders.js?v=74c957d2f5b46187';

// Chemistry is always RGBA16F at the authored 256^3 voxel spacing. The pool
// changes storage, not the soot/temperature/fuel/oxygen-deficit equations.
export const POOL_MODE = Object.freeze({ sparse: 0, dense: 1 });
export const POOL_STATUS = Object.freeze({ mode: 0, requested: 1, resident: 2, allocated: 3,
  free: 4, overflow: 5, epoch: 6, migration: 7 });
export const POOL_INDIRECT = Object.freeze({ clearNew: 0, pool: 12, migrate: 24,
  dense: 36, importDense: 48, topology: 60, scalar: 72, bytes: 84 });

export function planBrickPool({ D = 256, brick = 16, capacity = 512,
  denseOccupancy = .5, maxSparseMemory = .65, maxTextureDimension3D = 256, requestHalo = 1 } = {}) {
  if (D !== 256 || ![16, 32].includes(brick) || !Number.isInteger(capacity) || capacity < 1)
    throw Error('Brick pools preserve D=256 and use 16 or 32 voxel bricks with a fixed positive capacity.');
  if (!(denseOccupancy > 0 && denseOccupancy <= 1) || !(maxSparseMemory > 0 && maxSparseMemory <= 1))
    throw Error('Invalid dense fallback policy.');
  if (!Number.isInteger(requestHalo) || requestHalo < 0 || requestHalo > 2) throw Error('Invalid allocation support halo.');
  const pagesAxis = D / brick, pageCount = pagesAxis ** 3;
  if (capacity > pageCount) throw Error('Pool capacity exceeds the logical page count.');
  const maxTiles = Math.floor(maxTextureDimension3D / brick);
  let tiles;
  for (let x = 1; x <= maxTiles; x++) for (let y = 1; y <= maxTiles; y++) {
    const z = Math.ceil(capacity / (x * y));
    if (z > maxTiles) continue;
    const volume = x * y * z, span = Math.max(x, y, z), aspect = span / Math.min(x, y, z);
    if (!tiles || volume < tiles.volume || (volume === tiles.volume &&
      (span < tiles.span || (span === tiles.span && aspect < tiles.aspect)))) tiles = { x, y, z, volume, span, aspect };
  }
  if (!tiles) throw Error('Fixed pool does not fit the adapter 3D texture limit.');
  const atlasSize = [tiles.x * brick, tiles.y * brick, tiles.z * brick];
  const atlasBytes = atlasSize.reduce((a, b) => a * b, 1) * 8 * 3;
  const denseBytes = D ** 3 * 8 * 3;
  const offsets = { owner: 16, generation: 16 + capacity, free: 16 + capacity * 2,
    newSlot: 16 + capacity * 3, activePage: 16 + capacity * 4, activeSlot: 16 + capacity * 5 };
  const fallbackPages = Math.min(capacity, Math.floor(pageCount * denseOccupancy));
  return Object.freeze({ D, brick, capacity, pagesAxis, pageCount, tiles: [tiles.x, tiles.y, tiles.z],
    atlasSize, atlasBytes, denseBytes, memoryRatio: atlasBytes / denseBytes,
    viable: atlasBytes < denseBytes * maxSparseMemory, fallbackPages,
    denseOccupancy, maxSparseMemory, offsets: Object.freeze(offsets), metadataBytes: (16 + capacity * 6) * 4,
    pageTableBytes: pageCount * 8, voxelSize: 6 / D, halo: 0, requestHalo,
    sampling: 'hardware filtering inside a page; eight logical clamped voxels at page seams' });
}

function ident(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw Error('Invalid WGSL identifier.');
  return value;
}

export function brickPoolWGSL(plan, { prefix = 'bp', group = 0, pagesBinding = 23, metadataBinding = 24 } = {}) {
  ident(prefix);
  const [tx, ty] = plan.tiles, { owner, generation, activePage } = plan.offsets;
  return `
struct ${prefix}Page { slot:u32, generation:u32 };
@group(${group}) @binding(${pagesBinding}) var<storage,read> ${prefix}Pages:array<${prefix}Page>;
@group(${group}) @binding(${metadataBinding}) var<storage,read> ${prefix}Meta:array<u32>;
fn ${prefix}Mode()->u32{return ${prefix}Meta[0];}
fn ${prefix}PageIndex(b:vec3u)->u32{return b.x+${plan.pagesAxis}u*(b.y+${plan.pagesAxis}u*b.z);}
fn ${prefix}PageCoord(index:u32)->vec3u{return vec3u(index%${plan.pagesAxis}u,(index/${plan.pagesAxis}u)%${plan.pagesAxis}u,index/${plan.pagesAxis ** 2}u);}
fn ${prefix}Tile(slot:u32)->vec3u{return vec3u(slot%${tx}u,(slot/${tx}u)%${ty}u,slot/${tx * ty}u);}
fn ${prefix}Resident(index:u32,page:${prefix}Page)->bool{
 if(page.slot==0u||page.slot>${plan.capacity}u){return false;}let slot=page.slot-1u;
 return page.generation==${prefix}Meta[${generation}u+slot]&&${prefix}Meta[${owner}u+slot]==index+1u;
}
fn ${prefix}AtlasCell(i:vec3u)->vec3i{
 let b=i/${plan.brick}u;let page=${prefix}Pages[${prefix}PageIndex(b)];
 return vec3i(${prefix}Tile(page.slot-1u)*${plan.brick}u+i-b*${plan.brick}u);
}
fn ${prefix}InvocationCell(group:vec3u,local:vec3u)->vec3u{
 let page=${prefix}Meta[${activePage}u+group.y];let q=group.x;let S=${plan.brick / 4}u;
 let tile=vec3u(q%S,(q/S)%S,q/(S*S));
 return ${prefix}PageCoord(page)*${plan.brick}u+tile*4u+local;
}
`;
}

// Call shared brickPoolWGSL once. Existing dense globals/sampler can be named
// here without redeclaring their bindings. The forced-pool reader is also used
// for the one-time pool -> dense migration after fallback has been selected.
export function brickPoolFieldWGSL(plan, { prefix = 'bp', name = 'poolChem', atlasBinding = 20,
  group = 0, samplerName = 'smp', denseTexture = null, write = false } = {}) {
  [prefix, name, samplerName].forEach(ident);
  if (denseTexture) ident(denseTexture);
  const atlas = `${name}Atlas`, size = `vec3f(${plan.atlasSize.map((n) => `${n}.`).join(',')})`;
  if (write) return `
@group(${group}) @binding(${atlasBinding}) var ${atlas}:texture_storage_3d<rgba16float,write>;
fn ${name}Store(i:vec3i,value:vec4f){
 if(any(i<vec3i(0))||any(i>=vec3i(${plan.D}))){return;}
 ${denseTexture ? `if(${prefix}Mode()==1u){textureStore(${denseTexture},i,value);return;}` : ''}
 let index=${prefix}PageIndex(vec3u(i)/${plan.brick}u);let page=${prefix}Pages[index];
 if(${prefix}Resident(index,page)){textureStore(${atlas},${prefix}AtlasCell(vec3u(i)),value);}
}
`;
  return `
@group(${group}) @binding(${atlasBinding}) var ${atlas}:texture_3d<f32>;
fn ${name}PoolClampedCell(raw:vec3i)->vec4f{
 let i=clamp(raw,vec3i(0),vec3i(${plan.D - 1}));let index=${prefix}PageIndex(vec3u(i)/${plan.brick}u);let page=${prefix}Pages[index];
 if(!${prefix}Resident(index,page)){return vec4f(0);}return textureLoad(${atlas},${prefix}AtlasCell(vec3u(i)),0);
}
fn ${name}Cell(i:vec3i)->vec4f{
 if(any(i<vec3i(0))||any(i>=vec3i(${plan.D}))){return vec4f(0);}
 ${denseTexture ? `if(${prefix}Mode()==1u){return textureLoad(${denseTexture},i,0);}` : ''}
 return ${name}PoolClampedCell(i);
}
fn ${name}Sample(x:vec3f)->vec4f{
 if(any(x<vec3f(-3,0,-3))||any(x>vec3f(3,6,3))){return vec4f(0);}
 ${denseTexture ? `if(${prefix}Mode()==1u){return textureSampleLevel(${denseTexture},${samplerName},(x-vec3f(-3,0,-3))/6.,0);}` : ''}
 let q=((x-vec3f(-3,0,-3))/6.)*${plan.D}.-vec3f(.5);let lo=vec3i(floor(q));let hi=lo+vec3i(1);
 let first=clamp(lo,vec3i(0),vec3i(${plan.D - 1}))/${plan.brick};
 let last=clamp(hi,vec3i(0),vec3i(${plan.D - 1}))/${plan.brick};
 if(any(first!=last)){
  let a=${name}PoolClampedCell(lo);let b=${name}PoolClampedCell(lo+vec3i(1,0,0));
  let c=${name}PoolClampedCell(lo+vec3i(0,1,0));let d=${name}PoolClampedCell(lo+vec3i(1,1,0));
  let e=${name}PoolClampedCell(lo+vec3i(0,0,1));let f=${name}PoolClampedCell(lo+vec3i(1,0,1));
  let g=${name}PoolClampedCell(lo+vec3i(0,1,1));let h=${name}PoolClampedCell(hi);let t=fract(q);
  return mix(mix(mix(a,b,t.x),mix(c,d,t.x),t.y),mix(mix(e,f,t.x),mix(g,h,t.x),t.y),t.z);
 }
 let index=${prefix}PageIndex(vec3u(first));let page=${prefix}Pages[index];if(!${prefix}Resident(index,page)){return vec4f(0);}
 // Clamp logical domain edges before atlas translation: atlas neighbors at an
 // outer world face are unrelated pages, whereas dense sampling clamps there.
 let texel=vec3f(${prefix}Tile(page.slot-1u)*${plan.brick}u)+clamp(q,vec3f(0),vec3f(${plan.D - 1}))-vec3f(first*${plan.brick});
 return textureSampleLevel(${atlas},${samplerName},(texel+vec3f(.5))/${size},0);
}
`;
}

function rewriteCalls(source, call, replace) {
  const expression = new RegExp(`\\b${call}\\s*\\(`, 'g');
  let output = '', cursor = 0, match;
  while ((match = expression.exec(source))) {
    const open = source.indexOf('(', match.index);
    let depth = 1, start = open + 1, i = start, args = [];
    for (; i < source.length && depth; i++) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if ((c === ',' && depth === 1) || depth === 0) { args.push(source.slice(start, i).trim()); start = i + 1; }
    }
    if (depth) throw Error('Unterminated production WGSL call: ' + call);
    const replacement = replace(args);
    output += source.slice(cursor, match.index) + (replacement ?? source.slice(match.index, i));
    cursor = i; expression.lastIndex = i;
  }
  return output + source.slice(cursor);
}

// Direct transport/correction, not a dense-to-atlas rendering proxy. Texture
// addressing is the only edit to production WGSL. Both storage modes execute
// the canonical fine8 worklist; allocation support pages are not execution.
// The source, limiter, reaction, extinction, flags and channel cleanup remain.
export function brickPoolScalarShaders(plan, { N = 128, shaders = simulationShaders(N, plan.D),
  prefix = 'bp', pagesBinding = 23, metadataBinding = 24,
  oldAtlasBinding = 20, predictorAtlasBinding = 21, destinationAtlasBinding = 22 } = {}) {
  const shared = brickPoolWGSL(plan, { prefix, pagesBinding, metadataBinding });
  const result = {};
  for (const key of ['advectScalar', 'correctScalar']) {
    let code = shaders[key];
    if (typeof code !== 'string') throw Error('Missing production scalar shader: ' + key);
    const oldInvocation = key === 'advectScalar'
      ? 'let i=bricks[group.x].xyz*8u+vec3u(group.y,group.z%2u,group.z/2u)*4u+local;'
      : 'let brick=bricks[group.x].xyz;let i=brick*8u+vec3u(group.y,group.z%2u,group.z/2u)*4u+local;';
    if (!code.includes(oldInvocation)) throw Error('Production scalar invocation changed; pool adapter needs review.');
    code = rewriteCalls(code, 'scalar', ([texture, position]) =>
      texture === 'old' ? `oldChemSample(${position})` : texture === 'pred' ? `predChemSample(${position})` : null);
    code = rewriteCalls(code, 'textureLoad', ([texture, position]) =>
      texture === 'old' ? `oldChemCell(${position})` : texture === 'pred' ? `predChemCell(${position})` : null);
    code = rewriteCalls(code, 'textureStore', ([texture, position, value]) =>
      texture === 'dst' ? `newChemStore(${position},${value})` : null);
    code += shared + brickPoolFieldWGSL(plan, { prefix, name: 'oldChem', atlasBinding: oldAtlasBinding, denseTexture: 'old' });
    if (key === 'correctScalar') code += brickPoolFieldWGSL(plan, { prefix, name: 'predChem', atlasBinding: predictorAtlasBinding, denseTexture: 'pred' });
    code += brickPoolFieldWGSL(plan, { prefix, name: 'newChem', atlasBinding: key === 'advectScalar' ? predictorAtlasBinding : destinationAtlasBinding, denseTexture: 'dst', write: true });
    result[key] = code;
  }
  return result;
}

// The allocator's single 256-lane workgroup has deterministic ascending page
// and slot order. It preflights capacity before changing a mapping. A failed
// preflight preserves the old atlas/table for migration and selects dense on
// the GPU in the same command stream. No allocation decision needs readback.
export function brickPoolKernels(plan) {
  const { capacity: C, pageCount: P, pagesAxis: A, brick: B, offsets: O } = plan;
  const commandHelpers = `fn args(offset:u32,x:u32,y:u32,z:u32){commands[offset]=x;commands[offset+1u]=y;commands[offset+2u]=z;}`;
  const topology = `
struct Page {slot:u32,generation:u32};
@group(0) @binding(0) var<storage,read> requested:array<u32>;
@group(0) @binding(1) var<storage,read> current:array<Page>;
@group(0) @binding(2) var<storage,read_write> next:array<Page>;
@group(0) @binding(3) var<storage,read_write> meta:array<u32>;
@group(0) @binding(4) var<storage,read_write> commands:array<u32>;
var<workgroup> wanted:array<u32,256>;var<workgroup> needed:array<u32,256>;var<workgroup> available:array<u32,256>;
var<workgroup> exhausted:array<u32,256>;var<workgroup> totals:vec4u;var<workgroup> failed:u32;
${commandHelpers}
fn resident(index:u32,page:Page)->bool{if(page.slot==0u||page.slot>${C}u){return false;}let s=page.slot-1u;return meta[${O.owner}u+s]==index+1u&&meta[${O.generation}u+s]==page.generation;}
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
 let first=lane*${Math.ceil(P / 256)}u;let end=min(first+${Math.ceil(P / 256)}u,${P}u);
 for(var p=first;p<end;p++){next[p]=current[p];}
 storageBarrier();workgroupBarrier();
 if(meta[0]==1u){return;}
 var w=0u;var n=0u;var f=0u;var overflow=0u;
 for(var p=first;p<end;p++){if(requested[p]!=0u){w++;if(!resident(p,current[p])){n++;}}}
 let slotFirst=lane*${Math.ceil(C / 256)}u;let slotEnd=min(slotFirst+${Math.ceil(C / 256)}u,${C}u);
 for(var s=slotFirst;s<slotEnd;s++){let owner=meta[${O.owner}u+s];if(owner==0u||requested[owner-1u]==0u){f++;if(meta[${O.generation}u+s]==0xffffffffu){overflow=1u;}}}
 wanted[lane]=w;needed[lane]=n;available[lane]=f;exhausted[lane]=overflow;
 workgroupBarrier();
 if(lane==0u){var ws=0u;var ns=0u;var fs=0u;var gs=0u;
  for(var t=0u;t<256u;t++){let ww=wanted[t];let nn=needed[t];let ff=available[t];wanted[t]=ws;needed[t]=ns;available[t]=fs;ws+=ww;ns+=nn;fs+=ff;gs|=exhausted[t];}
  totals=vec4u(ws,ns,fs,gs);failed=0u;
  if(ws>${C}u||ns>fs){failed|=1u;}if(ws>${plan.fallbackPages}u){failed|=2u;}
  ${plan.viable ? '' : 'failed|=4u;'}if(ns>0u&&gs!=0u){failed|=8u;}
  meta[1]=ws;meta[3]=0u;meta[5]=failed;meta[6]++;
  if(failed!=0u){meta[0]=1u;meta[7]=1u;args(0u,0u,0u,0u);args(3u,0u,0u,0u);args(6u,64u,64u,64u);args(9u,64u,64u,64u);args(12u,0u,0u,0u);args(15u,0u,0u,0u);args(18u,0u,0u,0u);}
 }
 workgroupBarrier();storageBarrier();if(failed!=0u){return;}
 var freeRank=available[lane];
 for(var s=slotFirst;s<slotEnd;s++){let owner=meta[${O.owner}u+s];if(owner==0u||requested[owner-1u]==0u){meta[${O.free}u+freeRank]=s;freeRank++;meta[${O.owner}u+s]=0u;}}
 for(var p=first;p<end;p++){if(requested[p]==0u){next[p]=Page(0u,0u);}}
 storageBarrier();workgroupBarrier();
 var newRank=needed[lane];var activeRank=wanted[lane];
 for(var p=first;p<end;p++){if(requested[p]==0u){continue;}var page=current[p];
  if(!resident(p,page)){let s=meta[${O.free}u+newRank];let generation=meta[${O.generation}u+s]+1u;meta[${O.generation}u+s]=generation;meta[${O.owner}u+s]=p+1u;page=Page(s+1u,generation);next[p]=page;meta[${O.newSlot}u+newRank]=s;newRank++;}
  meta[${O.activePage}u+activeRank]=p;meta[${O.activeSlot}u+activeRank]=page.slot-1u;activeRank++;
 }
 storageBarrier();workgroupBarrier();
 if(lane==0u){meta[2]=totals.x;meta[3]=totals.y;meta[4]=totals.z-totals.y;meta[7]=0u;
  args(0u,${Math.ceil(B ** 3 / 64)}u,totals.y,1u);args(3u,${(B / 4) ** 3}u,totals.x,1u);args(6u,0u,0u,0u);args(9u,0u,0u,0u);args(12u,${(B / 4) ** 3}u,totals.x,1u);args(15u,1u,1u,1u);args(18u,0u,0u,0u);
 }
}`;
  const reset = `
struct Page {slot:u32,generation:u32};
@group(0) @binding(0) var<storage,read_write> a:array<Page>;
@group(0) @binding(1) var<storage,read_write> b:array<Page>;
@group(0) @binding(2) var<storage,read_write> meta:array<u32>;
@group(0) @binding(3) var<storage,read_write> commands:array<u32>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
 for(var p=lane;p<${P}u;p+=256u){a[p]=Page(0u,0u);b[p]=Page(0u,0u);}
 for(var s=lane;s<${C}u;s+=256u){meta[${O.owner}u+s]=0u;meta[${O.free}u+s]=s;}
 // Generation counters survive reset. A stale copied table cannot alias a
 // newly reused slot even across resets.
 for(var s=lane;s<21u;s+=256u){commands[s]=0u;}
 storageBarrier();workgroupBarrier();
 if(lane==0u){let epoch=meta[6]+1u;for(var s=0u;s<16u;s++){meta[s]=0u;}meta[4]=${C}u;meta[6]=epoch;commands[15]=1u;commands[16]=1u;commands[17]=1u;}
}`;
  const clearNew = `
@group(0) @binding(0) var<storage,read> meta:array<u32>;
@group(0) @binding(1) var a:texture_storage_3d<rgba16float,write>;
@group(0) @binding(2) var b:texture_storage_3d<rgba16float,write>;
@group(0) @binding(3) var c:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let q=group.x*64u+lane;if(q>=${B ** 3}u||group.y>=meta[3]){return;}let s=meta[${O.newSlot}u+group.y];
 let tile=vec3u(s%${plan.tiles[0]}u,(s/${plan.tiles[0]}u)%${plan.tiles[1]}u,s/${plan.tiles[0] * plan.tiles[1]}u);
 let i=vec3i(tile*${B}u+vec3u(q%${B}u,(q/${B}u)%${B}u,q/${B * B}u));textureStore(a,i,vec4f(0));textureStore(b,i,vec4f(0));textureStore(c,i,vec4f(0));
}`;
  const requestClear = `@group(0) @binding(0) var<storage,read_write> flags:array<atomic<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) i:vec3u){if(i.x<${P}u){atomicStore(&flags[i.x],0u);}}`;
  const requestScatter = `
@group(0) @binding(0) var<storage,read> bricks:array<vec4u>;
@group(0) @binding(1) var<storage,read> legacyArgs:array<u32>;
@group(0) @binding(2) var<storage,read_write> flags:array<atomic<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) i:vec3u){
 if(i.x>=legacyArgs[0]){return;}let b=bricks[i.x].xyz/${B / 8}u;if(any(b>=vec3u(${A}u))){return;}atomicStore(&flags[b.x+${A}u*(b.y+${A}u*b.z)],1u);
}`;
  const requestExpand = `
@group(0) @binding(0) var<storage,read> base:array<u32>;
@group(0) @binding(1) var<storage,read> extra:array<u32>;
@group(0) @binding(2) var<storage,read_write> requested:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) i:vec3u){
 if(i.x>=${P}u){return;}let b=vec3i(vec3u(i.x%${A}u,(i.x/${A}u)%${A}u,i.x/${A * A}u));var hit=0u;
 for(var z=-${plan.requestHalo};z<=${plan.requestHalo};z++){for(var y=-${plan.requestHalo};y<=${plan.requestHalo};y++){for(var x=-${plan.requestHalo};x<=${plan.requestHalo};x++){
  let q=b+vec3i(x,y,z);if(any(q<vec3i(0))||any(q>=vec3i(${A}))){continue;}let p=u32(q.x)+${A}u*(u32(q.y)+${A}u*u32(q.z));hit|=base[p]|extra[p];
 }}}requested[i.x]=select(0u,1u,hit!=0u);
}`;
  const migrate = brickPoolWGSL(plan, { pagesBinding: 0, metadataBinding: 1 }) +
    brickPoolFieldWGSL(plan, { name: 'migrateChem', atlasBinding: 2 }) + `
@group(0) @binding(3) var dst:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) i:vec3u){if(any(i>=vec3u(256u))){return;}textureStore(dst,vec3i(i),migrateChemPoolClampedCell(vec3i(i)));}`;
  // A sampler declaration is required by the shared sampling function even
  // when this entry point uses only textureLoad. Auto layout prunes it.
  const migrateWithSampler = '@group(0) @binding(4) var smp:sampler;\n' + migrate;
  const importDense = brickPoolWGSL(plan, { pagesBinding: 0, metadataBinding: 1 }) + `
@group(0) @binding(2) var src:texture_3d<f32>;
@group(0) @binding(3) var dst:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){let i=bpInvocationCell(group,local);textureStore(dst,bpAtlasCell(i),textureLoad(src,vec3i(i),0));}`;
  const ackMigration = `
@group(0) @binding(0) var<storage,read_write> meta:array<u32>;
@group(0) @binding(1) var<storage,read_write> commands:array<u32>;
@compute @workgroup_size(1) fn main(){meta[7]=0u;commands[6]=0u;commands[7]=0u;commands[8]=0u;}`;
  const routeScalar = `
@group(0) @binding(1) var<storage,read_write> commands:array<u32>;
@group(0) @binding(2) var<storage,read> legacyArgs:array<u32>;
@compute @workgroup_size(1) fn main(){for(var i=0u;i<3u;i++){commands[18u+i]=legacyArgs[i];}}`;
  // `meta` is reserved by WGSL. Keep the descriptive JS layout names while
  // giving the generated GPU state identifier a valid spelling.
  return Object.fromEntries(Object.entries({ topology, reset, clearNew, requestClear, requestScatter, requestExpand,
    migrate: migrateWithSampler, importDense, ackMigration, routeScalar }).map(([name, code]) => [name, code.replace(/\bmeta\b/g, 'poolState')]));
}

export async function createBrickPool(device, options = {}) {
  return ChemistryBrickPool.create(device, options);
}

// All textures/buffers are fixed at creation; encode methods allocate only
// ordinary command descriptors. Root-owned dense backing remains available
// until the GPU's sticky fallback has migrated the current RGBA field.
export class ChemistryBrickPool {
  static async create(device, options = {}) {
    const pool = new ChemistryBrickPool(device, options);
    try { await pool.initialize(); return pool; } catch (error) { pool.destroy(); throw error; }
  }
  constructor(device, options) {
    this.device = device;this.plan = planBrickPool({ ...options,
      maxTextureDimension3D: device.limits?.maxTextureDimension3D ?? options.maxTextureDimension3D ?? 256 });
    if (!this.plan.viable) throw Error('Pool footprint exceeds its dense fallback memory policy.');
    this.owned = [];this.groups = new Map();this.ids = new WeakMap();this.nextId = 1;this.pageIndex = 0;
  }
  async initialize() {
    const T = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, COPY_SRC: 1, COPY_DST: 2 };
    const B = globalThis.GPUBufferUsage ?? { STORAGE: 128, INDIRECT: 256, COPY_SRC: 4, COPY_DST: 8 };
    const texture = (label) => { const t = this.device.createTexture({ label,
      size: this.plan.atlasSize, dimension: '3d', format: 'rgba16float',
      usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_SRC | T.COPY_DST });this.owned.push(t);return { texture: t, view: t.createView() }; };
    const buffer = (label, size, usage = B.STORAGE | B.COPY_SRC | B.COPY_DST) => {
      const b = this.device.createBuffer({ label, size, usage });this.owned.push(b);return b;
    };
    this.fields = Array.from({ length: 3 }, (_, i) => texture('chemistry-pool-' + i));
    this.pages = [buffer('chemistry-pages-a', this.plan.pageTableBytes), buffer('chemistry-pages-b', this.plan.pageTableBytes)];
    this.metadata = buffer('chemistry-pool-metadata', this.plan.metadataBytes);
    this.commands = buffer('chemistry-pool-indirect', POOL_INDIRECT.bytes, B.STORAGE | B.INDIRECT | B.COPY_SRC | B.COPY_DST);
    this.requestBase = buffer('chemistry-request-base', this.plan.pageCount * 4);
    this.requested = buffer('chemistry-requested', this.plan.pageCount * 4);
    this.zeroExtra = buffer('chemistry-no-extra-requests', this.plan.pageCount * 4);
    this.pipelines = {};
    for (const [name, code] of Object.entries(brickPoolKernels(this.plan))) {
      const module = this.device.createShaderModule({ label: 'chemistry-pool-' + name, code });
      this.pipelines[name] = await this.device.createComputePipelineAsync({ label: 'chemistry-pool-' + name, layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
  }
  get pageTable() { return this.pages[this.pageIndex]; }
  get statusSource() { return { buffer: this.metadata, offset: 0, size: 64 }; }
  // Explicit buffer wrappers avoid guessing external GPUBuffer types.
  bufferGroup(name, resources) {
    const key = name + ':' + resources.map(([binding, resource, buffer]) => {
      let id = this.ids.get(resource);if (!id) {id = this.nextId++;this.ids.set(resource, id);}return binding + '/' + id + '/' + !!buffer;
    }).join(',');if (this.groups.has(key)) return this.groups.get(key);
    const group = this.device.createBindGroup({ label: 'chemistry-pool-' + name,
      layout: this.pipelines[name].getBindGroupLayout(0), entries: resources.map(([binding, resource, buffer]) => ({ binding, resource: buffer ? { buffer: resource } : resource })) });
    this.groups.set(key, group);return group;
  }
  pass(encoder, name, entries, indirect, dimensions) {
    const pass = encoder.beginComputePass({ label: 'chemistry-pool-' + name });
    pass.setPipeline(this.pipelines[name]);pass.setBindGroup(0, this.bufferGroup(name, entries));
    if (indirect !== undefined) pass.dispatchWorkgroupsIndirect(this.commands, indirect);else pass.dispatchWorkgroups(...dimensions);
    pass.end();
  }
  encodeReset(encoder) {
    this.pageIndex = 0;
    this.pass(encoder, 'reset', [[0, this.pages[0], true], [1, this.pages[1], true], [2, this.metadata, true], [3, this.commands, true]], undefined, [1]);
  }
  encodeRequestsFromFineBricks(encoder, { bricks, indirect, extraFlags = this.zeroExtra }) {
    this.pass(encoder, 'requestClear', [[0, this.requestBase, true]], undefined, [Math.ceil(this.plan.pageCount / 64)]);
    this.pass(encoder, 'requestScatter', [[0, bricks, true], [1, indirect, true], [2, this.requestBase, true]], undefined, [512]);
    this.pass(encoder, 'requestExpand', [[0, this.requestBase, true], [1, extraFlags, true], [2, this.requested, true]], undefined, [Math.ceil(this.plan.pageCount / 64)]);
    return this.requested;
  }
  encodeTopology(encoder, requested = this.requested) {
    const current = this.pageTable, next = this.pages[1 - this.pageIndex];
    // commands is written by topology, so it cannot also be its indirect
    // dispatch source in the same usage scope. One small fixed workgroup is
    // safe; dense mode copies the stable table and returns before allocation.
    this.pass(encoder, 'topology', [[0, requested, true], [1, current, true], [2, next, true], [3, this.metadata, true], [4, this.commands, true]], undefined, [1]);
    this.pass(encoder, 'clearNew', [[0, this.metadata, true], ...this.fields.map((f, i) => [i + 1, f.view, false])], POOL_INDIRECT.clearNew);
    this.pageIndex = 1 - this.pageIndex;
  }
  encodeMigrationToDense(encoder, fieldIndex, denseView) {
    this.pass(encoder, 'migrate', [[0, this.pageTable, true], [1, this.metadata, true], [2, this.fields[fieldIndex].view, false], [3, denseView, false]], POOL_INDIRECT.migrate);
    this.pass(encoder, 'ackMigration', [[0, this.metadata, true], [1, this.commands, true]], undefined, [1]);
  }
  encodeImportDense(encoder, fieldIndex, denseView) {
    this.pass(encoder, 'importDense', [[0, this.pageTable, true], [1, this.metadata, true], [2, denseView, false], [3, this.fields[fieldIndex].view, false]], POOL_INDIRECT.importDense);
  }
  encodeRouteScalarDispatch(encoder, legacyIndirect) {
    this.pass(encoder, 'routeScalar', [[1, this.commands, true], [2, legacyIndirect, true]], undefined, [1]);
  }
  destroy() { for (const resource of this.owned) resource.destroy();this.owned.length = 0;this.groups.clear(); }
}
