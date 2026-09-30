import {pressureShaders} from './shaders.js?v=db13e8bbd389db1b';

// Exact work-list refinement around a globally connected pressure hierarchy.
// This changes only the N fine-grid smoothing segment. Restriction, the global
// N/2..4 V-cycle, prolongation, RHS and MAC projection stay with the caller.
// No chemistry/smoke mask participates in pressure support.
// Native field gates pass, but complete V-cycle timing is slower than dense.
// Keep this candidate opt-in; the live default must retain dense pressure.
export function adaptivePressureShaders(N=128,{tile=8,sweeps=3,denseThreshold=.55}={}){
 if(!Number.isInteger(N)||N<16||N>512||(N&(N-1))!==0||tile!==8)
  throw Error('Adaptive pressure requires a power-of-two N in [16,512] and 8-cell tiles.');
 if(!Number.isInteger(sweeps)||sweeps<1||sweeps>8)
  throw Error('Adaptive pressure segments require 1..8 Jacobi sweeps.');
 if(!Number.isFinite(denseThreshold)||denseThreshold<0||denseThreshold>1)
  throw Error('Adaptive pressure dense threshold must be in [0,1].');
 const B=N/tile,total=B**3,halo=Math.ceil(sweeps/tile);
 const denseSmooth=pressureShaders(N).smooth;
 const common=denseSmooth.slice(0,denseSmooth.indexOf('@compute'));
 const update='mix(at(i),(sum(i)+textureLoad(b,i,0).x)/6.,.6666667)';
 if(!denseSmooth.includes(update))throw Error('Reference pressure smoother changed.');
 const metadata=`const B:u32=${B}u;const TOTAL:u32=${total}u;`;
 const mark=common.replace('@group(0) @binding(2) var dst:texture_storage_3d<r32float,write>;',
  '@group(0) @binding(2) var<storage,read_write> rawMask:array<u32>;')+metadata+`
@group(0) @binding(3) var<storage,read_write> counters:array<atomic<u32>>;
var<workgroup> changed:atomic<u32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) brick:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&changed,0u);if(all(brick==vec3u(0))){atomicStore(&counters[0],0u);atomicStore(&counters[1],0u);}}workgroupBarrier();
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  // Once any cell changes the entire tile is retained. Early rejection here
  // saves marking cost in dense regions without changing the support test.
  if(atomicLoad(&changed)==0u){
   let i=vec3i(brick*8u+local+vec3u(x,y,z)*4u);
   let previous=at(i);let next=${update};
   // Compare bits, including signed zero. A residual epsilon would weaken
   // the exact inactive-cell proof and is deliberately absent.
   if(bitcast<u32>(next)!=bitcast<u32>(previous)){atomicOr(&changed,1u);}
  }
 }}}
 workgroupBarrier();if(lane==0u){rawMask[brick.x+B*(brick.y+B*brick.z)]=atomicLoad(&changed);}
}`;
 const build=metadata+`
@group(0) @binding(0) var<storage,read> rawMask:array<u32>;
@group(0) @binding(1) var<storage,read_write> mask:array<u32>;
@group(0) @binding(2) var<storage,read_write> tiles:array<vec4u>;
@group(0) @binding(3) var<storage,read_write> counters:array<atomic<u32>>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(B))){return;}var live=false;
 // The next Jacobi value is initially unchanged outside the raw support.
 // Each sweep can propagate a change by one axial cell. This full tile halo
 // contains every dependency for the complete segment, including interfaces.
 for(var z=-${halo};z<=${halo};z++){for(var y=-${halo};y<=${halo};y++){for(var x=-${halo};x<=${halo};x++){
  let q=vec3i(id)+vec3i(x,y,z);
  if(all(q>=vec3i(0))&&all(q<vec3i(i32(B)))){let j=u32(q.x)+B*(u32(q.y)+B*u32(q.z));live=live||rawMask[j]!=0u;}
 }}}
 let index=id.x+B*(id.y+B*id.z);mask[index]=select(0u,1u,live);
 if(live){let slot=atomicAdd(&counters[0],1u);tiles[slot]=vec4u(id,0u);}
}`;
 const threshold=Math.round(denseThreshold*10000);
 const prepare=metadata+`
@group(0) @binding(0) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(1) var<storage,read_write> commands:array<u32>;
@compute @workgroup_size(1) fn main(){
 let count=atomicLoad(&counters[0]);let dense=count*10000u>=TOTAL*${threshold}u;
 // Three independent indirect commands: dense smooth, sparse smooth, copy.
 // Dense fallback executes the original shader and omits the copy entirely.
 commands[0]=select(0u,${N/8}u,dense);commands[1]=${N/8}u;commands[2]=${N/4}u;
 commands[3]=select(count,0u,dense);commands[4]=2u;commands[5]=4u;
 commands[6]=select(${N/8}u,0u,dense);commands[7]=${N/8}u;commands[8]=${N/4}u;
 atomicStore(&counters[1],select(0u,1u,dense));
}`;
 const sparseSmooth=common+`
@group(0) @binding(3) var<storage,read> tiles:array<vec4u>;
@compute @workgroup_size(4,4,4) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u){
 let brick=tiles[group.x].xyz;
 let i=vec3i(brick*8u+vec3u(group.y,group.z%2u,group.z/2u)*4u+local);
 textureStore(dst,i,vec4f(${update}));
}`;
 const copyInactive=`const N:u32=${N}u;const B:u32=${B}u;
@group(0) @binding(0) var previous:texture_3d<f32>;
@group(0) @binding(1) var<storage,read> mask:array<u32>;
@group(0) @binding(2) var dst:texture_storage_3d<r32float,write>;
@compute @workgroup_size(8,8,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(N))){return;}let brick=id/8u;
 if(mask[brick.x+B*(brick.y+B*brick.z)]==0u){textureStore(dst,vec3i(id),textureLoad(previous,vec3i(id),0));}
}`;
 const diagnose=common+`
@compute @workgroup_size(8,8,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=vec3u(u32(N)))){return;}let i=vec3i(id);
 textureStore(dst,i,vec4f(textureLoad(b,i,0).x-6.*at(i)+sum(i)));
}`;
 return {mark,build,prepare,sparseSmooth,copyInactive,denseSmooth,diagnose};
}

// Runtime contract:
//   const fine=this.levels[0];
//   fine.current=adaptive.encodeSegment(encoder,fine.p,fine.b,fine.current,this.pressurePass);
// Call immediately before restriction and immediately after prolongation.
// This returns only the new ping-pong index. It never reads back or changes
// coarse resources. Dense fallback and sparse work selection stay on the GPU.
export class AdaptivePressure {
 static async create(device,N=128,options={}){
  const instance=new AdaptivePressure(device,N,options);
  try{await instance.init();return instance;}catch(error){instance.destroy();throw error;}
 }
 constructor(device,N=128,options={}){
  this.device=device;this.N=N;this.sweeps=options.sweeps??3;
  this.shaders=adaptivePressureShaders(N,options);this.B=N/8;this.total=this.B**3;
  this.groups=new Map();this.ids=new WeakMap();this.nextId=0;this.buffers=[];
 }
 async init(){
  const d=this.device;
  const buffer=(size,usage)=>{const result=d.createBuffer({size,usage});this.buffers.push(result);return result;};
  this.rawMask=buffer(this.total*4,GPUBufferUsage.STORAGE);
  this.mask=buffer(this.total*4,GPUBufferUsage.STORAGE);
  this.tiles=buffer(this.total*16,GPUBufferUsage.STORAGE);
  this.counters=buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
  this.commands=buffer(36,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC);
  this.pipelines={};
  for(const name of ['mark','build','prepare','sparseSmooth','copyInactive','denseSmooth']){
   const module=d.createShaderModule({code:this.shaders[name],label:'adaptive-pressure-'+name});
   const diagnostics=await module.getCompilationInfo();
   const errors=diagnostics.messages.filter(message=>message.type==='error');
   if(errors.length)throw Error('Adaptive pressure '+name+': '+errors.map(error=>error.message).join('\n'));
   this.pipelines[name]=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'},label:'adaptive-pressure-'+name});
  }
  return this;
 }
 group(pipeline,items){
  const id=value=>{if(!this.ids.has(value))this.ids.set(value,++this.nextId);return this.ids.get(value);};
  const key=id(pipeline)+':'+items.map(([binding,value])=>binding+'='+id(value)).join(',');
  if(!this.groups.has(key))this.groups.set(key,this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:items.map(([binding,value])=>({binding,resource:value.view||{buffer:value}}))}));
  return this.groups.get(key);
 }
 encodeSegment(encoder,pressure,rhs,current=0,sharedPass=null){
  if(!Array.isArray(pressure)||pressure.length!==2||![0,1].includes(current))throw Error('Adaptive pressure requires two fine pressure fields and a valid current index.');
  const pass=sharedPass||encoder.beginComputePass({label:'adaptive-pressure-segment'});
  const run=(name,items,work,offset)=>{
   const pipeline=this.pipelines[name];pass.setPipeline(pipeline);pass.setBindGroup(0,this.group(pipeline,items));
   if(offset===undefined)pass.dispatchWorkgroups(...work);else pass.dispatchWorkgroupsIndirect(this.commands,offset);
  };
  run('mark',[[0,pressure[current]],[1,rhs],[2,this.rawMask],[3,this.counters]],[this.B,this.B,this.B]);
  run('build',[[0,this.rawMask],[1,this.mask],[2,this.tiles],[3,this.counters]],[Math.ceil(this.B/4),Math.ceil(this.B/4),Math.ceil(this.B/4)]);
  run('prepare',[[0,this.counters],[1,this.commands]],[1]);
  for(let i=0;i<this.sweeps;i++){
   run('copyInactive',[[0,pressure[current]],[1,this.mask],[2,pressure[1-current]]],null,24);
   run('denseSmooth',[[0,pressure[current]],[1,rhs],[2,pressure[1-current]]],null,0);
   run('sparseSmooth',[[0,pressure[current]],[1,rhs],[2,pressure[1-current]],[3,this.tiles]],null,12);
   current=1-current;
  }
  if(!sharedPass)pass.end();return current;
 }
 destroy(){for(const buffer of this.buffers)buffer.destroy();this.groups.clear();}
}
