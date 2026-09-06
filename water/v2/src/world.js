import {THREE,uniform as U} from './gpu.js';
import {objectVertex,objectFragment,skyVertex,skyFragment} from './water-shaders.js';
import {bedHeightJS} from './environment.js';
import {mulberry32} from './math.js';
function noise3(x,y,z){const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);x-=i;y-=j;z-=k;x=x*x*(3-2*x);y=y*y*(3-2*y);z=z*z*(3-2*z);const h=(a,b,c)=>{let v=Math.imul(a,73856093)^Math.imul(b,19349663)^Math.imul(c,83492791);v=Math.imul(v^(v>>>13),1274126177);return ((v^(v>>>16))>>>0)/4294967296;};let sum=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++)sum+=h(i+a,j+b,k+c)*(a?x:1-x)*(b?y:1-y)*(c?z:1-z);return sum;}
export class World {
 constructor(shared){
  this.shared=shared;this.scene=new THREE.Scene();this.materials=[];this.terrainGroup=new THREE.Group();this.floatingGroup=new THREE.Group();this.scene.add(this.terrainGroup,this.floatingGroup);
  const skyMat=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:skyVertex,fragmentShader:skyFragment,uniforms:shared,side:THREE.BackSide,depthWrite:false,depthTest:false});
  this.sky=new THREE.Mesh(new THREE.SphereGeometry(19000,24,12),skyMat);this.sky.frustumCulled=false;this.sky.renderOrder=-100;this.scene.add(this.sky);
  this.material=({color=[.5,.48,.4],kind=1}={})=>{const mat=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:objectVertex,fragmentShader:objectFragment,uniforms:{...shared,uAlbedo:U(new THREE.Vector3(...color)),uKind:U(kind)},side:THREE.DoubleSide});this.materials.push(mat);return mat;};
  this.sand=this.material({color:[.59,.53,.38],kind:0});this.rock=this.material({color:[.43,.415,.36],kind:1});this.darkRock=this.material({color:[.34,.345,.30],kind:1});this.white=this.material({color:[.73,.76,.74],kind:2});this.wood=this.material({color:[.24,.14,.063],kind:3});this.metal=this.material({color:[.5,.56,.59],kind:4});this.glass=this.material({color:[.032,.078,.089],kind:4});this.black=this.material({color:[.018,.023,.027],kind:2});
  const ground=new THREE.PlaneGeometry(340,340,256,256);ground.rotateX(-Math.PI/2);this.ground=new THREE.Mesh(ground,this.sand);this.terrainGroup.add(this.ground);
  this.makeRocks();this.boat=this.makeBoat();this.floatingGroup.add(this.boat);this.buoyModels=[this.makeBuoy(),this.makeCrate(),this.makeBuoy(true)];this.floatingGroup.add(...this.buoyModels);
  this.depthMarkers=new THREE.Group();this.terrainGroup.add(this.depthMarkers);
  for(let i=0;i<4;i++){const g=new THREE.Group();const color=this.material({color:[[.58,.047,.022],[.045,.29,.57],[.57,.4,.022],[.62,.62,.61]][i],kind:2});for(let j=0;j<4;j++){const b=new THREE.Mesh(new THREE.BoxGeometry(1.5,.25,.8),j%2?this.white:color);b.position.y=j*.25;g.add(b);}g.position.set(-19+i*10,-2-i*.5,-8);this.depthMarkers.add(g);}
 }
 box(parent,size,pos,mat){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);m.position.set(...pos);parent.add(m);return m;}
 cylinder(parent,r1,r2,height,pos,mat,segments=24){const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,height,segments),mat);m.position.set(...pos);parent.add(m);return m;}
 tube(parent,points,radius,mat){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const m=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(12,points.length*6),radius,6,false),mat);parent.add(m);return m;}
 makeRocks(){
  const rng=mulberry32(46209);this.rocks=[];
  const add=(x,y,z,sx,sy,sz,index)=>{const geo=new THREE.SphereGeometry(1,index<13?56:24,index<13?36:16),a=geo.attributes.position;
   for(let i=0;i<a.count;i++){const px=a.getX(i),py=a.getY(i),pz=a.getZ(i),n=.47*(noise3(px*2.4+index*11,py*2.4,pz*2.4)-.5)+.15*(noise3(px*7.2,py*7.2+index*7,pz*7.2)-.5)+.055*(noise3(px*20,py*20,pz*20+index*3)-.5);
    a.setXYZ(i,px*(1+n),py*(1+n*.65),pz*(1+n));}
   geo.computeVertexNormals();const m=new THREE.Mesh(geo,index%4===0?this.darkRock:this.rock);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.set(rng()*.2,rng()*6.28,rng()*.15);this.terrainGroup.add(m);this.rocks.push(m);
  };
  [[-23,1.0,-17,6,5,5],[-29,3,-29,7,8,6],[-33,7,-41,7,11,8],[-22,5,-43,6,10,6],[-13,3,-46,6,7,5],[31,2,-26,8,7,7],[39,6,-39,8,12,8],[25,6,-49,7,11,8],[14,3,-52,9,7,6],[-10,-2.8,-8,2.2,2.2,2.7],[8,-4,-2,2.6,2.2,2.1],[17,-2.6,-22,2.9,3.3,3.1],[-24,-.1,0,2.6,3.2,3.7]].forEach((v,i)=>add(...v,i));
  for(let i=0;i<50;i++){let x=(rng()-.5)*80,z=-25-rng()*35;const rad=.35+rng()*1.7;add(x,-1.6+rng()*1.5,z,rad,rad*.8,rad*1.2,i+20);}
  for(let i=0;i<30;i++){const x=(rng()-.5)*70,z=(rng()-.5)*30,r=.14+rng()*.5;add(x,-4.6-.072*x-.022*z,z,r,r*.55,r*1.1,i+90);}
 }
 makeBoat(){
  const g=new THREE.Group();g.name='Dynamic 7 m motor launch';
  const vertices=[],indices=[];const nx=52,nc=24;for(let i=0;i<=nx;i++){const s=i/nx,x=(s-.5)*7.,w=1.08*Math.pow(Math.sin(Math.PI*s),.45)*(1.-.15*s);for(let j=0;j<=nc;j++){const a=j/nc*Math.PI,z=w*Math.cos(a),y=.42-.91*Math.pow(Math.sin(a),.85)*( .80+.20*Math.sin(Math.PI*s));vertices.push(x,y,z);}}
  for(let i=0;i<nx;i++)for(let j=0;j<nc;j++){const a=i*(nc+1)+j,b=a+nc+1;indices.push(a,a+1,b,a+1,b+1,b);}
  const hull=new THREE.BufferGeometry();hull.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));hull.setIndex(indices);hull.computeVertexNormals();g.add(new THREE.Mesh(hull,this.white));
  const deck=[];for(let i=0;i<nx;i++){for(const si of [i/nx,(i+1)/nx]){const x=(si-.5)*7,w=1.07*Math.pow(Math.sin(Math.PI*si),.45)*(1-.15*si);deck.push([x,.43,-w],[x,.43,w]);}}
  const dv=[];for(let i=0;i<deck.length;i+=4)for(const q of [deck[i],deck[i+1],deck[i+2],deck[i+1],deck[i+3],deck[i+2]])dv.push(...q);const dg=new THREE.BufferGeometry();dg.setAttribute('position',new THREE.Float32BufferAttribute(dv,3));dg.computeVertexNormals();g.add(new THREE.Mesh(dg,this.wood));
  this.box(g,[2.9,.18,1.62],[-.7,.50,0],this.white);this.box(g,[2.5,.07,1.3],[-.75,.61,0],this.black);
  for(const x of [-1.55,-.2]){this.box(g,[.44,.22,.65],[x,.75,0],this.white);this.box(g,[.15,.53,.68],[x-.18,1.02,0],this.white);}
  this.box(g,[.48,.48,1.36],[.72,.77,0],this.white);
  const screen=this.box(g,[.065,.53,1.40],[.85,1.28,0],this.glass);screen.rotation.z=-.3;
  this.box(g,[1.27,.05,.97],[2.,.49,0],this.white);
  for(const side of [-1,1]){
   this.tube(g,[[-2.8,.65,side*.64],[-1.9,.89,side*.97],[0.,.90,side*.98],[1.6,.90,side*.74],[2.65,.7,side*.4],[3.35,.60,0]],.024,this.metal);
   for(const x of [-2,-.5,1.0])this.tube(g,[[x,.44,side*.89],[x,.89,side*.89]],.018,this.metal);
   const rub=this.tube(g,[[-3.45,.34,0],[-2.6,.37,side*.72],[0,.39,side*.99],[2.6,.38,side*.54],[3.45,.33,0]],.04,this.black);
  }
  this.box(g,[.63,.76,.56],[-3.15,.45,0],this.black);this.box(g,[.34,.78,.26],[-3.28,-.16,0],this.black);
  this.cylinder(g,.18,.18,.05,[-3.29,-.52,0],this.metal).rotation.x=Math.PI/2;
  for(const z of [-.61,.61])this.box(g,[.18,.065,.09],[.97,.91,z],this.metal);
  return g;
 }
 makeBuoy(small=false){const g=new THREE.Group(),r=small?.65:.9;const yellow=this.material({color:[.65,.34,.016],kind:2});this.cylinder(g,r,r*.88,.42,[0,0,0],this.black);this.cylinder(g,r*.82,r*.95,.34,[0,.32,0],yellow);this.cylinder(g,r*.30,r*.38,1.0,[0,.98,0],yellow);this.cylinder(g,.07,.07,.5,[0,1.66,0],this.metal);this.cylinder(g,.13,.13,.14,[0,1.98,0],this.glass);for(let i=0;i<4;i++){const a=i*Math.PI*.5;this.tube(g,[[Math.cos(a)*r*.7,.5,Math.sin(a)*r*.7],[Math.cos(a)*r*.3,1.3,Math.sin(a)*r*.3]],.026,this.metal);}return g;}
 makeCrate(){const g=new THREE.Group();for(let i=0;i<7;i++)this.box(g,[1.65,.095,.205],[0,.19,(i-3)*.23],this.wood);for(const z of [-.68,.68])this.box(g,[1.65,.35,.14],[0,-.03,z],this.wood);for(const x of [-.65,.65])this.box(g,[.14,.33,1.5],[x,-.02,0],this.wood);this.box(g,[.64,.38,.69],[.18,.44,.16],this.black);return g;}
 configure(p){this.terrainGroup.visible=p.terrain;this.boat.visible=p.boat;this.buoyModels.forEach(m=>m.visible=p.buoys);this.depthMarkers.visible=['Optics / clear water','Optics / suspended sediment'].includes(p.name);const a=this.ground.geometry.attributes.position;for(let i=0;i<a.count;i++)a.setY(i,bedHeightJS(a.getX(i),a.getZ(i),p.bed));a.needsUpdate=true;this.ground.geometry.computeVertexNormals();for(let i=0;i<this.depthMarkers.children.length;i++){const m=this.depthMarkers.children[i];m.position.y=bedHeightJS(m.position.x,m.position.z,p.bed)+.06;}}
}
