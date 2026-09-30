// Incident-light receivers use the conservative camera support bit. Shadow
// rays retain their separate positive-soot bit in renderer.js. No chemistry
// thresholds, texture dimensions, or shadow samples change here.
export const LIGHTING_WORK = Object.freeze({
  lightSize: 64,
  brickSize: 32,
  brickCount: 32 ** 3,
  cellsPerBrick: 8,
  lanes: 64,
  blocks: 32 ** 3 / 64,
  prefixLanes: 256,
  incidentBit: 1,
});

export const LIGHTING_WORK_BUFFER_BYTES = Object.freeze({
  counts: LIGHTING_WORK.blocks * 4,
  offsets: LIGHTING_WORK.blocks * 4,
  indices: LIGHTING_WORK.brickCount * 4,
  dispatch: 16,
});

export const LIGHTING_RECEIVER_BUFFER_BYTES = 32 ** 3 * 4;
export function createLightingReceivers(device) {
  return device.createBuffer({
    label: 'incident-light-receivers',
    size: LIGHTING_RECEIVER_BUFFER_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
}

// Fuse precise incident support into the existing conservative optical halo.
// Every positive soot texel is retained. One light-cell halo suffices for both
// chemistry and incident trilinear interpolation; camera and shadow support
// keep their original full-brick halo. The encoded bits address each brick's
// eight 64³ light cells in x/y/z parity order.
export function withLightingReceiverSupport(dilate) {
  const replace = (before, after) => {
    if (dilate.split(before).length !== 2) throw Error('Optical dilation contract changed');
    dilate = dilate.replace(before, after);
  };
  replace('@group(0) @binding(1) var<storage,read_write> destination:array<u32>;', `@group(0) @binding(1) var<storage,read_write> destination:array<u32>;
@group(0) @binding(2) var<storage,read_write> receiverFlags:array<u32>;`);
  replace('var alive=0u;', 'var alive=0u;var receivers=0u;');
  replace('alive|=source[u32(b.x+32*(b.y+32*b.z))];', `let bits=source[u32(b.x+32*(b.y+32*b.z))];alive|=bits;
   if((bits&2u)!=0u){
    var mx=255u;var my=255u;var mz=255u;
    if(x<0){mx=85u;}else if(x>0){mx=170u;}
    if(y<0){my=51u;}else if(y>0){my=204u;}
    if(z<0){mz=15u;}else if(z>0){mz=240u;}
    receivers|=mx&my&mz;
   }`);
  replace('destination[id.x+32u*(id.y+32u*id.z)]=alive;', `let index=id.x+32u*(id.y+32u*id.z);destination[index]=alive;
 receiverFlags[index]=select(0u,receivers,(alive&1u)!=0u);`);
  return dilate;
}

// Keep the original 4³ lighting groups and their sampler locality. Every
// output texel is rewritten, so absent receiver support clears old light.
export const lightReceiverEntryWGSL = `
@group(0) @binding(4) var lightOut:texture_storage_3d<rgba16float,write>;
@group(0) @binding(30) var<storage,read> receiverFlags:array<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(64))){return;}let at=LO+(vec3f(id)+.5)*6./64.;
 let b=id/2u;let cell=(id.x&1u)|((id.y&1u)<<1u)|((id.z&1u)<<2u);
 let litRegion=(receiverFlags[b.x+32u*(b.y+32u*b.z)]&(1u<<cell))!=0u;
 var light=vec3f(0);if(litRegion){light=incoming(at,vec3f(0),false);}
 textureStore(lightOut,vec3i(id),vec4f(light,1));
}`;

// One fixed pool lasts for the solver's lifetime. Every refresh overwrites
// counts, offsets and arguments; only the bounded list prefix is consumed.
export function createLightingWork(device) {
  const pool = {};
  for (const [name, size] of Object.entries(LIGHTING_WORK_BUFFER_BYTES)) {
    pool[name] = device.createBuffer({
      label: `incident-light-${name}`,
      size,
      usage: GPUBufferUsage.STORAGE |
        (name === 'dispatch' ? GPUBufferUsage.INDIRECT : 0),
    });
  }
  pool.destroy = () => {
    for (const name of Object.keys(LIGHTING_WORK_BUFFER_BYTES)) pool[name].destroy();
  };
  return pool;
}

// Bind groups are created once by the solver alongside its other cached
// resources. Separate passes provide explicit write/read boundaries.
export function recordLightingWork(encoder, pipelines, groups) {
  for (const name of ['build', 'prefix', 'scatter']) {
    const pass = encoder.beginComputePass({label: `incident-light-${name}`});
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, groups[name]);
    pass.dispatchWorkgroups(name === 'prefix' ? 1 : LIGHTING_WORK.blocks);
    pass.end();
  }
}

const dimensions = `const BRICKS:u32=32u;const BLOCKS:u32=512u;const INCIDENT_BIT:u32=1u;`;

// Fixed x-major blocks make both allocation order and list order independent
// of invocation scheduling. There is no atomic append or CPU readback.
export const lightWorkBuildWGSL = `${dimensions}
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var<storage,read_write> counts:array<u32>;
var<workgroup> live:array<u32,64>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 live[lane]=select(0u,1u,(source[id.x]&INCIDENT_BIT)!=0u);workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){live[lane]+=live[lane+stride];}workgroupBarrier();}
 if(lane==0u){counts[group.x]=live[0];}
}`;

export const lightWorkPrefixWGSL = `${dimensions}
@group(0) @binding(0) var<storage,read> counts:array<u32>;
@group(0) @binding(1) var<storage,read_write> offsets:array<u32>;
struct LightDispatch{x:u32,y:u32,z:u32,count:u32};
@group(0) @binding(2) var<storage,read_write> dispatch:LightDispatch;
var<workgroup> prefix:array<u32,256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
 let a=counts[lane*2u];let pair=a+counts[lane*2u+1u];prefix[lane]=pair;workgroupBarrier();
 for(var offset=1u;offset<256u;offset*=2u){
  var previous=0u;if(lane>=offset){previous=prefix[lane-offset];}workgroupBarrier();
  prefix[lane]+=previous;workgroupBarrier();
 }
 let base=prefix[lane]-pair;offsets[lane*2u]=base;offsets[lane*2u+1u]=base+a;
 if(lane==255u){let total=prefix[lane];dispatch.x=(total+7u)/8u;dispatch.y=1u;dispatch.z=1u;dispatch.count=total;}
}`;

// Every inactive receiver brick is explicitly cleared. The queued light pass
// writes every cell of every active brick after this pass completes. Thus a
// shrinking plume cannot leave illumination from a previous simulation state.
export const lightWorkScatterWGSL = `${dimensions}
@group(0) @binding(0) var<storage,read> source:array<u32>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read_write> indices:array<u32>;
@group(0) @binding(3) var lightOut:texture_storage_3d<rgba16float,write>;
var<workgroup> prefix:array<u32,64>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 let present=(source[id.x]&INCIDENT_BIT)!=0u;prefix[lane]=select(0u,1u,present);workgroupBarrier();
 for(var offset=1u;offset<64u;offset*=2u){
  var previous=0u;if(lane>=offset){previous=prefix[lane-offset];}workgroupBarrier();
  prefix[lane]+=previous;workgroupBarrier();
 }
 if(present){indices[offsets[group.x]+prefix[lane]-1u]=id.x;}
 else{
  let brick=vec3u(id.x%BRICKS,(id.x/BRICKS)%BRICKS,id.x/(BRICKS*BRICKS))*2u;
  for(var cell=0u;cell<8u;cell++){
   let at=brick+vec3u(cell&1u,(cell>>1u)&1u,cell>>2u);
   textureStore(lightOut,vec3i(at),vec4f(0,0,0,1));
  }
 }
}`;

export const lightWorkEntryWGSL = `
@group(0) @binding(4) var lightOut:texture_storage_3d<rgba16float,write>;
@group(0) @binding(26) var<storage,read> lightWork:array<u32>;
struct LightDispatch{x:u32,y:u32,z:u32,count:u32};
@group(0) @binding(27) var<storage,read> lightDispatch:LightDispatch;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 let index=group.x*8u+lane/8u;if(index>=lightDispatch.count){return;}
 let b=lightWork[index];let cell=lane&7u;
 let id=vec3u(b%32u,(b/32u)%32u,b/1024u)*2u+vec3u(cell&1u,(cell>>1u)&1u,cell>>2u);
 let at=LO+(vec3f(id)+.5)*6./64.;let light=incoming(at,vec3f(0),false);
 textureStore(lightOut,vec3i(id),vec4f(light,1));
}`;

export const lightingWorkShaders = Object.freeze({
  build: lightWorkBuildWGSL,
  prefix: lightWorkPrefixWGSL,
  scatter: lightWorkScatterWGSL,
});
