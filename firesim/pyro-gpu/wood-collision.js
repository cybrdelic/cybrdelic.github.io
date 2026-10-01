import {woodPoseWGSL} from '../wood-structure.js?v=54c82352661e679d';
// A fixed voxel ownership map follows fractured bodies. The detailed authored
// mesh remains the visible surface. This conservative collision proxy uses the
// existing 128³ gas resolution; it never changes render or chemistry quality.
export const woodCollisionSampleWGSL=`
@group(0) @binding(40) var<storage,read> woodCells:array<u32>;
@group(0) @binding(43) var<storage,read> woodBroken:array<u32>;
fn woodMoved()->bool{return woodBroken[0]>0u;}
fn woodCellCode(x:vec3f)->u32{
 let c=vec3i(floor((x-vec3f(-3,0,-3))*(128./6.)));
 if(any(c<vec3i(0))||any(c>=vec3i(128))){return 0u;}
 return woodCells[u32(c.x+128*(c.y+128*c.z))];
}
fn woodRestUV(code:u32)->vec3f{
 let i=code-1u;return (vec3f(f32(i%64u),f32((i/64u)%64u),f32(i/4096u))+.5)/64.;
}
`;
export const woodCollisionWGSL=`
${woodPoseWGSL()}
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(11) var woodSolid:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(40) var<storage,read_write> woodCells:array<atomic<u32>>;
@group(0) @binding(41) var<storage,read> woodOwners:array<u32>;
@group(0) @binding(43) var<storage,read> woodBroken:array<u32>;
@compute @workgroup_size(256) fn clear(@builtin(global_invocation_id) id:vec3u){
 if(woodBroken[0]==0u||id.x>=2097152u){return;}atomicStore(&woodCells[id.x],0xffffffffu);
}
@compute @workgroup_size(4,4,4) fn fill(@builtin(global_invocation_id) id:vec3u){
 if(woodBroken[0]==0u||any(id>=vec3u(64))){return;}
 let m=textureLoad(woodSolid,vec3i(id),0);if(m.x>0.||m.w>7.5){return;}
 let index=id.x+64u*(id.y+64u*id.z);let owner=woodOwners[index];
 let rest=(vec3f(id)+.5)*3./64.-1.5;
 let p=object.origin.xyz+woodTransformRest(owner,rest)*object.origin.w;
 let h=3.*object.origin.w/64.;let radius=h*.866026+6./128.*.5;
 let lo=max(vec3i(floor((p-vec3f(radius)-vec3f(-3,0,-3))*(128./6.))),vec3i(0));
 let hi=min(vec3i(floor((p+vec3f(radius)-vec3f(-3,0,-3))*(128./6.))),vec3i(127));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let cell=vec3i(x,y,z);let at=vec3f(-3,0,-3)+(vec3f(cell)+.5)*(6./128.);
  let local=woodInversePose(owner,(at-object.origin.xyz)/object.origin.w);
  if(all(abs(local-rest)<=vec3f(1.5/64.+3./128./object.origin.w))){
   atomicMin(&woodCells[u32(x+128*(y+128*z))],index+1u);
  }
 }}}
}
@compute @workgroup_size(256) fn finish(@builtin(global_invocation_id) id:vec3u){
 if(woodBroken[0]==0u||id.x>=2097152u){return;}
 if(atomicLoad(&woodCells[id.x])==0xffffffffu){atomicStore(&woodCells[id.x],0u);}
}
`;
export class WoodCollision{
 constructor(solver){this.s=solver;this.device=solver.device;}
 async init(){
  const d=this.device;this.cells=d.createBuffer({label:'moving wood collision ownership',size:128**3*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.pipelines={};for(const name of ['clear','fill','finish'])this.pipelines[name]=await this.s.pipeline(woodCollisionWGSL,'wood-collision-'+name,name);
  return this;
 }
 bindings(){return [[40,{buffer:this.cells}],[43,{buffer:this.s.woodStructure?.metadata||this.s.emptyWoodMetadata}]];}
 encode(encoder){const s=this.s;if(!s.woodStructure?.ready)return;
  const counter=[43,{buffer:s.woodStructure.metadata}];
  const linear=name=>{const p=this.pipelines[name];const pass=encoder.beginComputePass({label:'wood collision '+name});pass.setPipeline(p);pass.setBindGroup(0,s.group(p,[[40,{buffer:this.cells}],counter]));pass.dispatchWorkgroups(128**3/256);pass.end();};
  linear('clear');
  s.dispatch(encoder,this.pipelines.fill,[[11,s.objectModels[s.objectId]],[13,{buffer:s.objectSettings}],[40,{buffer:this.cells}],[41,{buffer:s.woodOwners}],...s.woodPoseBindings(),counter],64);
  linear('finish');
 }
 dispose(){this.cells?.destroy();}
}
