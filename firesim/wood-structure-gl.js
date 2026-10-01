import {woodStructureGLSL} from './wood-structure.js?v=7dfac6909b1f2622';
import {SOURCE_SCALE,SOURCE_CENTER} from './pyro-gpu/objects/forest-tree/source-space.js?v=7dfac6909b1f2622';
import {woodSamplingGLSL} from './wood-state-gl.js?v=7dfac6909b1f2622';

const COLUMNS=12,PER_ROW=4,WIDTH=COLUMNS*PER_ROW;
const structure=woodStructureGLSL(64)
 .replaceAll('woodStockAt(', 'woodStockRest(').replaceAll('woodWearAt(', 'woodWearRest(')
 .replace('n.massSection.y*pow(worldScale,3.)*9.81*clamp(stock+ch,0.,1.)','woodRemainingMassAt(i)*pow(worldScale,3.)*9.81')
 .replace('vec3 endpoint=position+woodRotate(rotation,-r.axisRadius.xyz*r.massSection.z);float low=min(min(position.y,endpoint.y),position.y+lever.y)-r.axisRadius.w;',`vec4 boxLo=texelFetch(woodMechanicsTex,woodNodePoint(root,8),0),boxHi=texelFetch(woodMechanicsTex,woodNodePoint(root,9),0);float low=1e20;for(int corner=0;corner<8;corner++){vec3 point=vec3((corner&1)==0?boxLo.x:boxHi.x,(corner&2)==0?boxLo.y:boxHi.y,(corner&4)==0?boxLo.z:boxHi.z);low=min(low,position.y+woodRotate(rotation,point-r.restParent.xyz).y);}`)
 .replace('vec3 woodRotate(',`WoodNode woodNodeAt(int i);WoodPose woodPoseAt(int i);float woodRemainingMassAt(int i);ivec2 woodNodePoint(int i,int col);
 vec4 woodStockRest(vec3 p);vec4 woodWearRest(vec3 p);
 vec3 woodRotate(`);
export const woodMechanicsGLSL=`
uniform sampler2D woodMechanicsTex,woodRootsTex,woodMassTex;
uniform float woodMechanicsEnabled,woodRestScale;
uniform int woodNodesCount;
uniform vec3 woodRestOrigin;
${structure}
ivec2 woodNodePoint(int i,int col){return ivec2((i%${PER_ROW})*${COLUMNS}+col,i/${PER_ROW});}
vec4 woodRootData(int i,int col){return texelFetch(woodRootsTex,ivec2((i%${PER_ROW})*2+col,i/${PER_ROW}),0);}
WoodNode woodNodeAt(int i){return WoodNode(texelFetch(woodMechanicsTex,woodNodePoint(i,0),0),texelFetch(woodMechanicsTex,woodNodePoint(i,1),0),texelFetch(woodMechanicsTex,woodNodePoint(i,2),0),texelFetch(woodMechanicsTex,woodNodePoint(i,3),0));}
WoodPose woodPoseAt(int i){return WoodPose(texelFetch(woodMechanicsTex,woodNodePoint(i,4),0),texelFetch(woodMechanicsTex,woodNodePoint(i,5),0),texelFetch(woodMechanicsTex,woodNodePoint(i,6),0),texelFetch(woodMechanicsTex,woodNodePoint(i,7),0));}
float woodRemainingMassAt(int i){vec4 range=texelFetch(woodMechanicsTex,woodNodePoint(i,10),0);int end=int(range.y)-1,start=int(range.x)-1;float total=end>=0?texelFetch(woodMassTex,ivec2(end%256,end/256),0).r:0.;return max(0.,total-(start>=0?texelFetch(woodMassTex,ivec2(start%256,start/256),0).r:0.));}
int woodColumnOwner(vec3 rest){
 ivec3 q=clamp(ivec3(floor((rest+1.5)*64./3.)),ivec3(0),ivec3(63));int code=q.x+64*(q.y+64*q.z),texel=code/4;
 return int(texelFetch(woodMechanicsTex,ivec2(texel%${WIDTH},(woodNodesCount+${PER_ROW-1})/${PER_ROW}+texel/${WIDTH}),0)[code%4]);
}
vec3 woodColumnPosition(vec3 restWorld){
 if(woodMechanicsEnabled<.5)return restWorld;vec3 local=(restWorld-woodRestOrigin)/woodRestScale;
 return woodRestOrigin+woodTransformRest(woodColumnOwner(local),local)*woodRestScale;
}
`;

const scanFragment=`#version 300 es
precision highp float;precision highp int;
uniform sampler2D scanOld,woodMechanicsTex;uniform int scanOffset,scanInit,woodNodesCount;
layout(location=0) out vec4 value;
void main(){ivec2 id=ivec2(gl_FragCoord.xy);int i=id.x+${PER_ROW}*id.y;float n=0.;
 if(i>=woodNodesCount){value=vec4(0);return;}
 if(scanInit==1)n=texelFetch(woodMechanicsTex,ivec2((i%${PER_ROW})*${COLUMNS}+4,i/${PER_ROW}),0).w==float(i)?1.:0.;
 else {n=texelFetch(scanOld,id,0).r;if(i>=scanOffset){int at=i-scanOffset;n+=texelFetch(scanOld,ivec2(at%${PER_ROW},at/${PER_ROW}),0).r;}}
 value=vec4(n,0,0,1);
}`;
const rootVertex=`#version 300 es
precision highp float;precision highp int;
uniform sampler2D scanOld,woodMechanicsTex;uniform int woodNodesCount;
uniform vec3 woodRestOrigin;uniform float woodRestScale;
flat out vec4 rootData;
vec3 rotateQ(vec4 q,vec3 p){vec3 t=2.*cross(q.xyz,p);return p+q.w*t+cross(q.xyz,t);}
void main(){
 int id=gl_VertexID/2,col=gl_VertexID%2;float row=0.;rootData=vec4(0);
 if(id==0){int at=woodNodesCount-1;rootData=col==0?vec4(texelFetch(scanOld,ivec2(at%${PER_ROW},at/${PER_ROW}),0).r,0,0,0):vec4(0);}
 else {int i=id-1;float sum=texelFetch(scanOld,ivec2(i%${PER_ROW},i/${PER_ROW}),0).r,old=i>0?texelFetch(scanOld,ivec2((i-1)%${PER_ROW},(i-1)/${PER_ROW}),0).r:0.;
  if(sum==old){gl_Position=vec4(2,2,2,1);gl_PointSize=1.;return;}row=sum;
  int x=(i%${PER_ROW})*${COLUMNS},y=i/${PER_ROW};vec4 a=texelFetch(woodMechanicsTex,ivec2(x+8,y),0),b=texelFetch(woodMechanicsTex,ivec2(x+9,y),0),pose=texelFetch(woodMechanicsTex,ivec2(x+4,y),0),q=texelFetch(woodMechanicsTex,ivec2(x+5,y),0),rest=texelFetch(woodMechanicsTex,ivec2(x,y),0);
  vec3 centre=woodRestOrigin+(pose.xyz+rotateQ(q,(a.xyz+b.xyz)*.5-rest.xyz))*woodRestScale;
  rootData=col==0?vec4(float(i+1),centre):vec4(length((b.xyz-a.xyz)*.5)*woodRestScale,0,0,0);
 }
 int rank=int(row);gl_Position=vec4((float((rank%${PER_ROW})*2+col)+.5)/${PER_ROW*2}.*2.-1.,(float(rank/${PER_ROW})+.5)/float((woodNodesCount+1+${PER_ROW-1})/${PER_ROW})*2.-1.,0,1);gl_PointSize=1.;
}`;
const rootFragment=`#version 300 es
precision highp float;flat in vec4 rootData;layout(location=0) out vec4 value;void main(){value=rootData;}`;

function massFragment(shared){return `#version 300 es
${shared}
uniform sampler2D massSource,scanOld;uniform int scanInit,scanOffset,massDonors;
layout(location=0) out vec4 value;
void main(){ivec2 id=ivec2(gl_FragCoord.xy);int i=id.x+256*id.y;float mass=0.;
 if(i>=massDonors){value=vec4(0);return;}
 if(scanInit==1){vec4 donor=texelFetch(massSource,id,0);ivec2 base=ivec2(donor.xy);float remaining=0.;for(int y=0;y<4;y++)for(int x=0;x<4;x++){vec4 state=texelFetch(woodStockTex,base+ivec2(x,y),0);remaining+=clamp(state.x+state.w,0.,1.);}mass=donor.z*remaining/16.;}
 else {mass=texelFetch(scanOld,id,0).r;if(i>=scanOffset){int q=i-scanOffset;mass+=texelFetch(scanOld,ivec2(q%256,q/256),0).r;}}
 value=vec4(mass,0,0,1);
}`;}

export function createWoodStructureGL(gl,{shared,program,uniform,bind}){
 let asset=null,origin=[0,0,0],scale=1,ready=false;
 const cache=new Map(),resources=[];
 const mechanicsProgram=program(`#version 300 es
${shared}
uniform float woodDelta;uniform int woodPhase;uniform vec3 woodForce;
layout(location=0) out vec4 value;
void main(){ivec2 id=ivec2(gl_FragCoord.xy);int i=id.y*${PER_ROW}+id.x/${COLUMNS},col=id.x%${COLUMNS};
 if(i>=woodNodesCount||col<4||col>=8){value=texelFetch(woodMechanicsTex,id,0);return;}
 WoodPose pose=woodPhase==0?woodFailure(i,woodNodeAt(i),woodPoseAt(i),woodDelta,woodRestScale,woodForce):woodPose(i,woodDelta,woodRestScale,-woodRestOrigin.y/woodRestScale);
 value=col==4?pose.positionDetached:col==5?pose.rotation:col==6?pose.velocityHeat:pose.angularDamage;
}`),scanProgram=program(scanFragment),rootsProgram=program(rootFragment,rootVertex),massProgram=program(massFragment(shared));
 function texture(w,h,data=null,internal=gl.RGBA32F,format=gl.RGBA){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const p of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,gl.FLOAT,data);resources.push({texture:t});return t;}
 function target(w,h,data=null){const tex=texture(w,h,data),fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Wood structure framebuffer incomplete');resources.push({fbo});return {texture:tex,fbo,width:w,height:h};}
 function begin(p,t,h=t.height){gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.viewport(0,0,t.width,h);}
 function common(p){gl.uniform1f(uniform(p,'woodMechanicsEnabled'),ready?1:0);gl.uniform1i(uniform(p,'woodNodesCount'),asset?.count||0);gl.uniform3fv(uniform(p,'woodRestOrigin'),origin);gl.uniform1f(uniform(p,'woodRestScale'),scale);}
 function bound(p,render=false){common(p);if(!ready)return;bind(asset.states[0].texture,render?3:11,uniform(p,'woodMechanicsTex'));bind(asset.roots.texture,render?15:12,uniform(p,'woodRootsTex'));}
 async function load(name){
  ready=false;if(!name){asset=null;return;}
  if(cache.has(name)){asset=cache.get(name);ready=true;reset();return;}
  const base=`pyro-gpu/objects/${name==='cybr-tree'?'forest-tree/structure':name}/`;
  const response=await fetch(base+"manifest.json?v=7dfac6909b1f2622");if(!response.ok)throw Error('Wood structure missing: '+name);const manifest=await response.json();
  const files=await Promise.all(['nodes.bin','bounds.bin','voxel-owners.bin'].map(async file=>{const r=await fetch(base+file + "?v=7dfac6909b1f2622");if(!r.ok)throw Error('Wood structure asset missing: '+name+'/'+file);return r.arrayBuffer();}));
  const nodes=new Float32Array(files[0]),bounds=new Float32Array(files[1]),owners=new Uint32Array(files[2]),count=manifest.nodes;
  if(manifest.layoutVersion!==1||manifest.maxDepth>64||nodes.length!==count*16||bounds.length!==count*8||owners.length!==64**3||owners.some(i=>i>=count))throw Error('Invalid Original wood structure');
  const rows=Math.ceil(count/PER_ROW),height=rows+Math.ceil(owners.length/(WIDTH*4)),data=new Float32Array(WIDTH*height*4);
  if(height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('Wood structure exceeds this GPU texture limit');
  for(let i=0;i<count;i++){const row=(Math.floor(i/PER_ROW)*WIDTH+(i%PER_ROW)*COLUMNS)*4;data.set(nodes.subarray(i*16,i*16+16),row);data.set([nodes[i*16],nodes[i*16+1],nodes[i*16+2],-1,0,0,0,1,0,0,0,0,0,0,0,0],row+16);data.set(bounds.subarray(i*8,i*8+8),row+32);}
  for(let i=0;i<owners.length;i++)data[rows*WIDTH*4+i]=owners[i];
  const children=Array.from({length:count},()=>[]);for(let i=1;i<count;i++)children[nodes[i*16+3]].push(i);const tin=new Uint32Array(count),tout=new Uint32Array(count);let ordinal=0;const visit=i=>{tin[i]=ordinal++;for(const child of children[i])visit(child);tout[i]=ordinal;};visit(0);
  const thermalPath=name==='cybr-tree'?'pyro-gpu/objects/forest-tree/wood-solid.rgba16.bin':base+'solid.rgba16.bin';const thermalResponse=await fetch(thermalPath + "?v=7dfac6909b1f2622");if(!thermalResponse.ok)throw Error('Wood thermal mass asset missing: '+name);const half=new Uint16Array(await thermalResponse.arrayBuffer());if(half.length!==64**3*4)throw Error('Invalid wood thermal mass asset');
  const decode=v=>{const sign=v&32768?-1:1,exp=(v>>10)&31,mantissa=v&1023;return exp?sign*(1+mantissa/1024)*2**(exp-15):sign*mantissa*2**-24;};
  // Thermal state is projected, but gravitational mass must keep each actual
  // depth voxel's owner. Collapsing mass onto the column centroid would unload
  // overlapping beams which still contain material.
  const donors=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++){const byOwner=new Map();for(let z=0;z<64;z++){const cell=x+64*(y+64*z),m=Math.fround(decode(half[cell*4+1])/1.5*495*3/64);if(m<=0)continue;const owner=owners[cell];byOwner.set(owner,Math.fround((byOwner.get(owner)||0)+m));}for(const [owner,column]of byOwner)donors.push({owner,rank:tin[owner],x:x*4,y:y*4,mass:column*(3/64)**2});}
  donors.sort((a,b)=>a.rank-b.rank);const massCount=donors.length,massHeight=Math.max(1,Math.ceil(massCount/256)),massData=new Float32Array(256*massHeight*4),limits=new Uint32Array(count+1);let pointer=0;for(let rank=0;rank<=count;rank++){while(pointer<massCount&&donors[pointer].rank<rank)pointer++;limits[rank]=pointer;}for(let i=0;i<count;i++){const point=(Math.floor(i/PER_ROW)*WIDTH+(i%PER_ROW)*COLUMNS+10)*4;data.set([limits[tin[i]],limits[tout[i]],0,0],point);}for(let i=0;i<massCount;i++)massData.set([donors[i].x,donors[i].y,donors[i].mass,donors[i].owner],i*4);
  asset={name,base,manifest,count,rows,data,massCount,massData,massHeight,massSource:texture(256,massHeight,massData),massScan:[target(256,massHeight),target(256,massHeight)],states:[target(WIDTH,height,data),target(WIDTH,height,data)],scan:[target(PER_ROW,rows),target(PER_ROW,rows)],roots:target(PER_ROW*2,Math.ceil((count+1)/PER_ROW))};cache.set(name,asset);ready=true;reset();
 }
 function reset(){if(!ready)return;for(const state of asset.states){gl.bindTexture(gl.TEXTURE_2D,state.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,state.width,state.height,gl.RGBA,gl.FLOAT,asset.data);}gl.bindFramebuffer(gl.FRAMEBUFFER,asset.roots.fbo);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));}
 return {
  get ready(){return ready;},get asset(){return asset;},load,reset,
  configure(centre,sourceScale){origin=[...centre,0];scale=sourceScale;},bind:bound,
  step(wood,dt){
   if(!ready||dt<=0)return false;
   let massCurrent=0;begin(massProgram,asset.massScan[0]);wood.bind(massProgram);bound(massProgram);bind(asset.massSource,0,uniform(massProgram,'massSource'));gl.uniform1i(uniform(massProgram,'scanInit'),1);gl.uniform1i(uniform(massProgram,'massDonors'),asset.massCount);gl.drawArrays(gl.TRIANGLES,0,3);
   for(let offset=1;offset<asset.massCount;offset*=2){begin(massProgram,asset.massScan[1-massCurrent]);bind(asset.massScan[massCurrent].texture,0,uniform(massProgram,'scanOld'));gl.uniform1i(uniform(massProgram,'scanInit'),0);gl.uniform1i(uniform(massProgram,'scanOffset'),offset);gl.drawArrays(gl.TRIANGLES,0,3);massCurrent=1-massCurrent;}
   for(let phase=0;phase<2;phase++){begin(mechanicsProgram,asset.states[1-phase],asset.rows);wood.bind(mechanicsProgram);bound(mechanicsProgram);bind(asset.states[phase].texture,11,uniform(mechanicsProgram,'woodMechanicsTex'));bind(asset.massScan[massCurrent].texture,12,uniform(mechanicsProgram,'woodMassTex'));gl.uniform1f(uniform(mechanicsProgram,'woodDelta'),dt);gl.uniform1i(uniform(mechanicsProgram,'woodPhase'),phase);gl.uniform3fv(uniform(mechanicsProgram,'woodForce'),[0,0,0]);gl.drawArrays(gl.TRIANGLES,0,3);}
   let current=0;begin(scanProgram,asset.scan[current]);bind(asset.states[0].texture,0,uniform(scanProgram,'woodMechanicsTex'));gl.uniform1i(uniform(scanProgram,'scanInit'),1);gl.uniform1i(uniform(scanProgram,'woodNodesCount'),asset.count);gl.drawArrays(gl.TRIANGLES,0,3);
   for(let offset=1;offset<asset.count;offset*=2){begin(scanProgram,asset.scan[1-current]);bind(asset.scan[current].texture,0,uniform(scanProgram,'scanOld'));gl.uniform1i(uniform(scanProgram,'scanInit'),0);gl.uniform1i(uniform(scanProgram,'scanOffset'),offset);gl.drawArrays(gl.TRIANGLES,0,3);current=1-current;}
   begin(rootsProgram,asset.roots);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));bind(asset.scan[current].texture,0,uniform(rootsProgram,'scanOld'));bind(asset.states[0].texture,1,uniform(rootsProgram,'woodMechanicsTex'));common(rootsProgram);gl.drawArrays(gl.POINTS,0,(asset.count+1)*2);return true;
  },
  destroy(){for(const r of resources){if(r.texture)gl.deleteTexture(r.texture);if(r.fbo)gl.deleteFramebuffer(r.fbo);}for(const p of[mechanicsProgram,scanProgram,rootsProgram,massProgram])gl.deleteProgram(p);cache.clear();asset=null;ready=false;}
 };
}

export function createWoodMeshGL(gl,{shared,lightingGLSL,materialGLSL,program,uniform,bind,width,height}){
 const resources=[],cache=new Map();let draws=[],ready=false,barkTextures=null,tree=false,barkKind=0;
 // Vertex work uses only rigid pose and rest material sampling. Exclude the
 // chemistry and failure kernels from this stage rather than relying on a
 // driver to eliminate their large, unreachable loops.
 const failureStart=woodMechanicsGLSL.indexOf('WoodPose woodFailure('),definitionsStart=woodMechanicsGLSL.indexOf('\nivec2 woodNodePoint(int i,int col){');
 const vertexMechanics=woodMechanicsGLSL.slice(0,failureStart)+woodMechanicsGLSL.slice(definitionsStart);
 const vertexSampling=woodSamplingGLSL.slice(0,woodSamplingGLSL.indexOf('float woodGasRest('));
 const vertex=`#version 300 es
 precision highp float;precision highp int;precision highp sampler2D;
 ${vertexMechanics}
 ${vertexSampling}
 vec4 woodStockRest(vec3 p){vec3 at=woodRestOrigin+p*woodRestScale;return woodCapacityAt(at).r>0.?woodStockAt(at):vec4(0);}vec4 woodWearRest(vec3 p){vec3 at=woodRestOrigin+p*woodRestScale;return woodCapacityAt(at).r>0.?woodWearAt(at):vec4(0);}
 layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in uvec2 owners;layout(location=3) in float material;layout(location=4) in vec2 sourceUV;
 uniform sampler2D woodMicroTex;
 uniform vec3 cameraEye,cameraForward,cameraRight,cameraUp;uniform float cameraTan,roomEnabled,viewZoom;uniform vec2 viewPan;
 out vec2 uv,woodMeshUV;out vec3 woodAt,woodRest,woodRestNormal;flat out uvec2 woodOwners;flat out float woodMaterialId;
 void main(){
  woodOwners=owners;woodRest=position;woodRestNormal=normal;woodMaterialId=material;woodMeshUV=sourceUV;
  vec3 restWorld=woodRestOrigin+position*woodRestScale;vec4 stock=woodStockAt(restWorld),wear=woodWearAt(restWorld);
  float fissure=woodBark>.5&&woodBark<1.5?1.-smoothstep(.3,.58,textureLod(woodMicroTex,sourceUV,0.).r):0.;
  float erosion=material>7.5&&material<8.5?0.:(1.-stock.r)*.004+wear.z*fissure*.0025;
  woodAt=woodRestOrigin+woodTransformRest(int(owners.x),position-normal*erosion)*woodRestScale;
  if(roomEnabled>.5){vec3 relative=woodAt-cameraEye;float depth=dot(relative,cameraForward);gl_Position=vec4(dot(relative,cameraRight)/(cameraTan*(16./9.)),dot(relative,cameraUp)/cameraTan,(40.05/39.95)*depth-(4./39.95),depth);}
  else gl_Position=vec4((woodAt.x-viewPan.x)*viewZoom/7.,(woodAt.y-2.8875-viewPan.y)*viewZoom/3.9375,-woodAt.z/10.,1.);
  uv=gl_Position.xy/max(gl_Position.w,.00001)*.5+.5;
 }`;
 const fragment=`#version 300 es
 ${shared}
 ${lightingGLSL}
 ${materialGLSL}
 in vec3 woodAt,woodRest,woodRestNormal;in vec2 woodMeshUV;flat in uvec2 woodOwners;flat in float woodMaterialId;
 uniform sampler2D woodBarkTex,woodMicroTex,woodRoughnessTex;
 uniform float roomEnabled,inspectionLight;
 layout(location=0) out vec4 surface;
 void main(){
  int owner=int(woodOwners.x);if(woodMaterialId>8.5&&!woodCapVisible(owner,woodOwners.y))discard;
  vec3 restWorld=woodRestOrigin+woodRest*woodRestScale;vec4 stock=woodStockAt(restWorld),wear=woodWearAt(restWorld);
  WoodNode node=woodNodeAt(owner);vec3 grain=normalize(node.axisRadius.xyz),side=normalize(cross(grain,abs(grain.z)<.9?vec3(0,0,1):vec3(1,0,0))),radial=cross(grain,side);
  vec3 local=woodRest-node.restParent.xyz,p=vec3(dot(local,side),dot(woodRest,grain),dot(local,radial));
  vec3 normal=normalize(woodRestNormal)*(gl_FrontFacing?1.:-1.),n=vec3(dot(normal,side),dot(normal,grain),dot(normal,radial));
  bool treeBark=woodBark>.5&&woodBark<1.5;float bark=float(woodMaterialId>.5&&woodMaterialId<1.5&&(treeBark||(woodBark>1.5&&abs(dot(woodRestNormal,grain))<.75)));vec4 mat=woodMaterial(p,n,stock.g,stock.r,stock.a,wear.z,bark);
  n=woodNormal(p,n,stock.r,stock.a,wear.z,bark);normal=normalize(woodTransformNormal(owner,side*n.x+grain*n.y+radial*n.z));grain=normalize(woodTransformNormal(owner,grain));
  if(treeBark&&bark>.5){
   vec3 color=texture(woodBarkTex,woodMeshUV).rgb;
   vec3 source=woodRest/${SOURCE_SCALE}+vec3(${SOURCE_CENTER[0]},${SOURCE_CENTER[2]},${SOURCE_CENTER[1]});vec3 weights=pow(abs(woodRestNormal),vec3(4));weights/=max(dot(weights,vec3(1)),.0001);
   vec3 planar=texture(woodBarkTex,source.zy*vec2(1,.5)).rgb*weights.x+texture(woodBarkTex,source.xz).rgb*weights.y+texture(woodBarkTex,source.xy*vec2(1,.5)).rgb*weights.z;color=mix(color,planar,clamp(1.25-source.y,0.,1.));
   float carbon=smoothstep(.008,.13,stock.a),ash=smoothstep(.9,1.,1.-stock.r)*(1.-smoothstep(.002,.035,stock.a));
   color=mix(color,color*vec3(.4,.21,.11),smoothstep(.03,.24,1.-stock.r));color=mix(color,mat.rgb,clamp(carbon+ash,0.,1.));
   float height=texture(woodMicroTex,woodMeshUV).r;vec3 px=dFdx(woodAt),py=dFdy(woodAt),r1=cross(py,normal),r2=cross(normal,px);float det=dot(px,r1);normal=normalize(abs(det)*normal-sign(det)*.005*(dFdx(height)*r1+dFdy(height)*r2));
   color*=1.-.75*(1.-smoothstep(.32,.58,height))*wear.z;mat=vec4(color,mix(clamp(texture(woodRoughnessTex,woodMeshUV).r,.5,.98),mat.a,carbon));
  }
  if(woodMaterialId>7.5&&woodMaterialId<8.5){float conversion=1.-stock.r,edge=min(min(woodMeshUV.x,1.-woodMeshUV.x),min(woodMeshUV.y,1.-woodMeshUV.y));if(conversion>.92||edge<conversion*.16)discard;mat=vec4(mix(vec3(.033,.11,.013),vec3(.15,.07,.018),clamp(smoothstep(.18,.5,wear.g)*(1.-wear.r)+conversion,0.,1.)),.88);}
  vec3 eye=roomEnabled>.5?cameraEye:vec3(woodAt.xy,3.),view=normalize(eye-woodAt),color=vec3(0);
  for(int i=0;i<32;i++){vec3 light,power;roomLight(i,light,power);vec3 d=light-woodAt;float r2=max(dot(d,d),.001);vec3 l=d*inversesqrt(r2);float nl=max(dot(normal,l),0.);color+=(mat.rgb+vec3(woodSpecular(normal,l,view,grain,mat.a)))*power*nl/(r2+.12);}
  color+=mat.rgb*ambientLight*(.25+.75*max(normal.y,0.))/3.14159;
  for(int i=0;i<2;i++){vec3 l,power;spotSample(i,woodAt,l,power);float nl=max(dot(normal,l),0.);color+=power*(mat.rgb/3.14159+vec3(woodSpecular(normal,l,view,grain,mat.a)))*nl;}
  color+=inspectionLight*mat.rgb*.20*max(dot(normal,normalize(vec3(-.5,1.,1.5))),0.);
  surface=vec4(color,roomEnabled>.5?distance(eye,woodAt):3.-woodAt.z);
 }`;
 const meshProgram=program(fragment,vertex),fallback=gl.createTexture();resources.push({texture:fallback});gl.bindTexture(gl.TEXTURE_2D,fallback);for(const p of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
 const texture=gl.createTexture();resources.push({texture});gl.bindTexture(gl.TEXTURE_2D,texture);for(const p of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);for(const p of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.HALF_FLOAT,null);
 const fbo=gl.createFramebuffer(),depth=gl.createRenderbuffer();resources.push({fbo},{renderbuffer:depth});gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Wood mesh surface framebuffer incomplete');
 function gpuBuffer(bytes,target){const b=gl.createBuffer();resources.push({buffer:b});gl.bindBuffer(target,b);gl.bufferData(target,bytes,gl.STATIC_DRAW);return b;}
 async function load(asset){
  ready=false;draws=[];tree=asset?.name==='cybr-tree';barkKind=tree?1:asset?.name==='logs'?2:0;if(!asset)return;if(cache.has(asset.name)){draws=cache.get(asset.name);ready=true;return;}
  if(tree&&!barkTextures){barkTextures=await Promise.all(['bark-color.png','bark-micro.png','bark-roughness.png'].map(async(name,index)=>{const r=await fetch('pyro-gpu/objects/forest-tree/'+name + "?v=7dfac6909b1f2622");if(!r.ok)throw Error('Reviewed bark asset missing: '+name);const bitmap=await createImageBitmap(await r.blob(),{colorSpaceConversion:'none',imageOrientation:'flipY'});const tex=gl.createTexture();resources.push({texture:tex});gl.bindTexture(gl.TEXTURE_2D,tex);for(const p of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);for(const p of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.REPEAT);gl.texImage2D(gl.TEXTURE_2D,0,index===0?gl.SRGB8_ALPHA8:gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);bitmap.close();return tex;}));}
  async function mesh(vertices,indices,owners,count){
   const responses=await Promise.all([vertices,indices,owners].map(async name=>{const r=await fetch(asset.base+name + "?v=7dfac6909b1f2622");if(!r.ok)throw Error('Wood mesh missing: '+name);const bytes=await r.arrayBuffer();if(bytes.byteLength!==asset.manifest.files[name].bytes)throw Error('Wood mesh incomplete: '+name);return bytes;}));
   const vao=gl.createVertexArray();resources.push({vao});gl.bindVertexArray(vao);gpuBuffer(responses[0],gl.ARRAY_BUFFER);
   for(const [index,size,offset]of[[0,3,0],[1,3,12],[3,1,32],[4,2,24]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,36,offset);}
   gpuBuffer(responses[2],gl.ARRAY_BUFFER);gl.enableVertexAttribArray(2);gl.vertexAttribIPointer(2,2,gl.UNSIGNED_INT,8,0);gpuBuffer(responses[1],gl.ELEMENT_ARRAY_BUFFER);gl.bindVertexArray(null);return {vao,count};
  }
  draws.push(await mesh('vertices.bin','indices.bin','owners.bin',asset.manifest.partitionTriangles*3));
  if(asset.manifest.caps.triangles)draws.push(await mesh('cap-vertices.bin','cap-indices.bin','cap-owner-pairs.bin',asset.manifest.caps.triangles*3));cache.set(asset.name,draws);ready=true;
 }
 return {
  get ready(){return ready;},load,
  draw({wood,mechanics,room,roomEnabled,sourceVisible=true,camera,tan,zoom,pan,lighting}){
   if(!ready||!mechanics.ready||!sourceVisible)return false;
   gl.useProgram(meshProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,width,height);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,1000]));gl.clearBufferfv(gl.DEPTH,0,new Float32Array([1]));gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
   wood.bind(meshProgram,true);mechanics.bind(meshProgram,true);room.bind(meshProgram,uniform);lighting(meshProgram);gl.uniform1f(uniform(meshProgram,'woodBark'),barkKind);gl.uniform1f(uniform(meshProgram,'roomEnabled'),roomEnabled?1:0);gl.uniform1f(uniform(meshProgram,'inspectionLight'),roomEnabled||window.SceneLights.active?0:1);gl.uniform1f(uniform(meshProgram,'cameraTan'),tan);gl.uniform1f(uniform(meshProgram,'viewZoom'),zoom);gl.uniform2f(uniform(meshProgram,'viewPan'),...pan);
   for(const [unit,name,index]of[[0,'woodBarkTex',0],[1,'woodMicroTex',1],[2,'woodRoughnessTex',2]])bind(tree?barkTextures[index]:fallback,unit,uniform(meshProgram,name));
   for(const key of['eye','forward','right','up'])gl.uniform3fv(uniform(meshProgram,'camera'+key[0].toUpperCase()+key.slice(1)),camera[key]);
   for(const draw of draws){gl.bindVertexArray(draw.vao);gl.drawElements(gl.TRIANGLES,draw.count,gl.UNSIGNED_INT,0);}gl.bindVertexArray(null);gl.disable(gl.DEPTH_TEST);return true;
  },
  bind(p,visible){bind(texture,3,uniform(p,'woodSurfaceTex'));gl.uniform1f(uniform(p,'woodSurfaceVisible'),visible?1:0);},
  destroy(){for(const r of resources){if(r.texture)gl.deleteTexture(r.texture);if(r.fbo)gl.deleteFramebuffer(r.fbo);if(r.renderbuffer)gl.deleteRenderbuffer(r.renderbuffer);if(r.buffer)gl.deleteBuffer(r.buffer);if(r.vao)gl.deleteVertexArray(r.vao);}gl.deleteProgram(meshProgram);cache.clear();draws=[];ready=false;}
 };
}
