// Bounded source choreography. The gas solver supplies the displayed flame,
// soot and lighting; these routines only release fuel and momentum.
// The source choreography is shared by both solvers. Packets carry weighted
// momentum and react in the gas; these functions never render fire geometry.
import {powerExpansionWGSL} from './fire-power-definitions.js?v=46ff16af6f281449';
export const abilityMotionWGSL = `
fn abilityForward(direction:vec3f)->vec3f{
 let h:vec3f=vec3f(direction.x,0,direction.z);
 if(length(h)<.01){return vec3f(1,0,0);}return normalize(h);
}
fn abilitySide(direction:vec3f)->vec3f{let f:vec3f=abilityForward(direction);return vec3f(-f.z,0,f.x);}
fn abilityCrescentAxis(side:vec3f)->vec3f{return side*.3+vec3f(0,.9539392,0);}
fn abilityReach(aim:vec3f,limit:f32)->f32{return max(.2,min(limit,length(aim.xz)-.3));}
fn abilityPathForward(kind:f32,aim:vec3f,dir:vec3f)->vec3f{
 if((kind>6.5&&kind<7.5)||(kind>17.5&&kind<18.5)||kind>23.5){if(length(aim.xz)>.05){return abilityForward(aim);}}
 return abilityForward(dir);
}
fn abilityCapsule(q:vec3f,a:vec3f,b:vec3f,r:f32,pad:f32)->bool{
 let ab:vec3f=b-a;let u:f32=clamp(dot(q-a,ab)/max(dot(ab,ab),.0001),0.,1.);
 return length(q-a-ab*u)<=r+pad;
}
fn abilityPacket(q:vec3f,c:vec3f,v:vec3f,r:vec3f,weight:f32,clock:f32)->vec4f{
 if(weight<=0.){return vec4f(0);}let d:vec3f=(q-c)/max(r,vec3f(.03));
 if(dot(d,d)>10.){return vec4f(0);}
 // A resolved folded fuel sheet supplies internal gaps. Counter-rotation
 // enters momentum and survives transport; no noise is added to the image.
 let fold:f32=powerFold((q-c)*2.3,clock);
 let pockets:f32=.18+.82*smoothstep(-.35,.45,fold);
 let w:f32=weight*exp(-dot(d,d)*1.2)*pockets;
 let axis:vec3f=v/max(length(v),.01);let spin:vec3f=cross(axis,q-c)*(9.+3.*fold);
 return vec4f((v+spin)*w,w);
}
fn abilityRibbon(q:vec3f,a:vec3f,b:vec3f,r:f32,v:vec3f,weight:f32,clock:f32)->vec4f{
 if(!abilityCapsule(q,a,b,r*2.8,0.)){return vec4f(0);}
 let ab:vec3f=b-a;let u:f32=clamp(dot(q-a,ab)/max(dot(ab,ab),.0001),0.,1.);
 return abilityPacket(q,a+ab*u,v,vec3f(r),weight*(.4+.6*u),clock);
}
fn abilityWallPanel(q:vec3f,center:vec3f,f:vec3f,s:vec3f,height:f32,sway:f32,clock:f32)->vec4f{
 let d:vec3f=q-center;let lateral:f32=dot(d,s);
 if(abs(lateral)>.64||d.y<-.10||d.y>height+.20){return vec4f(0);}
 // Overlapping fuel sheets form a connected wall. Folded material and
 // counter-flow break up the sheet after release rather than drawing pillars.
 let normal:f32=dot(d,f)-sway*clamp(d.y/max(height,.01),0.,1.);
 if(abs(normal)>.38){return vec4f(0);}
 let fold:f32=powerFold(d*2.3,clock);
 let edge:f32=(1.-smoothstep(.48,.64,abs(lateral)))*smoothstep(-.10,.03,d.y)*(1.-smoothstep(height-.15,height+.20,d.y));
 let w:f32=.52*edge*exp(-pow(normal/.12,2.))*(.35+.65*smoothstep(-.35,.45,fold));
 let v:vec3f=vec3f(0,3.+.5*fold,0)+s*(.6*sin(d.y*5.-clock*3.))+f*(sway+.6*fold);
 return vec4f(v*w,w);
}
fn abilityFinish(p:vec4f)->vec4f{
 let v:vec3f=p.xyz/max(p.w,.00001);return vec4f(v/max(1.,length(v)/18.),p.w);
}
fn abilityCue(q:vec3f,t:f32,end:f32,clock:f32)->vec4f{
 if(t<0.||t>=end){return vec4f(0);}let u:f32=clamp(t/max(end,.01),0.,1.);
 let radius:f32=.30-.17*u;let spin:f32=clock*7.;
 let a:vec3f=vec3f(cos(spin),.4+.06*sin(spin*2.),sin(spin))*vec3f(radius,1,radius);
 let b:vec3f=vec3f(cos(spin+2.0944),.4+.06*sin(spin*2.+2.),sin(spin+2.0944))*vec3f(radius,1,radius);
 let c:vec3f=vec3f(cos(spin+4.1888),.4+.06*sin(spin*2.+4.),sin(spin+4.1888))*vec3f(radius,1,radius);
 return abilityPacket(q,a,-a*2.+vec3f(0,.7,0),vec3f(.10),.3+.3*u,clock)+abilityPacket(q,b,-b*2.+vec3f(0,.7,0),vec3f(.10),.3+.3*u,clock+2.)+abilityPacket(q,c,-c*2.+vec3f(0,.7,0),vec3f(.10),.3+.3*u,clock+4.);
}
fn abilityBurst(q:vec3f,center:vec3f,t:f32,weight:f32,clock:f32)->vec4f{
 if(t<0.||t>.42){return vec4f(0);}let d:vec3f=q-center;let r:f32=length(d);
 let fold:f32=powerFold(d*1.7,clock);let radius:f32=.22+3.2*t+.14*fold;
 if(r>radius+.5){return vec4f(0);}
 let axis:vec3f=d/max(r,.04);let shell:f32=exp(-pow((r-radius)/.21,2.));
 let pockets:f32=.12+.88*smoothstep(-.25,.45,powerFold(d*2.3,clock));
 let w:f32=(shell+.18*exp(-dot(d,d)/.09))*(1.-smoothstep(.12,.42,t))*weight*pockets;
 let v:vec3f=axis*(7.+fold)+cross(vec3f(.3,.8,.5),d)*2.+vec3f(0,1.3,0);
 return vec4f(v*w,w);
}
fn abilityProjectileCenter(a:vec3f,b:vec3f,t:f32,duration:f32,arc:f32)->vec3f{
 let u:f32=clamp(t/max(duration,.01),0.,1.);return mix(a,b,u)+vec3f(0,sin(u*3.14159265)*arc,0);
}
fn abilityProjectile(q:vec3f,a:vec3f,b:vec3f,t:f32,duration:f32,arc:f32,radius:f32,weight:f32,clock:f32)->vec4f{
 if(t<0.){return vec4f(0);}if(t>=duration){return abilityBurst(q,b,t-duration,weight*.85,clock);}
 let u:f32=t/duration;let c:vec3f=abilityProjectileCenter(a,b,t,duration,arc);
 let v:vec3f=(b-a)/duration+vec3f(0,cos(u*3.14159265)*arc*3.14159265/duration,0);
 let heading:vec3f=v/max(length(v),.01);let wake:vec3f=c-heading*.65;
 return abilityPacket(q,c,v,vec3f(radius),weight,clock)+abilityRibbon(q,wake,c,radius*.36,v,.22*weight,clock+1.);
}
fn abilityProjectileSupport(q:vec3f,a:vec3f,b:vec3f,t:f32,duration:f32,arc:f32,radius:f32,pad:f32)->bool{
 if(t<0.||t>duration+.42){return false;}
 if(t>=duration){return length(q-b)<.40+3.2*(t-duration)+.5+pad;}
 let u:f32=t/duration;let c:vec3f=abilityProjectileCenter(a,b,t,duration,arc);
 let v:vec3f=(b-a)/duration+vec3f(0,cos(u*3.14159265)*arc*3.14159265/duration,0);
 return abilityCapsule(q,c-v/max(length(v),.01)*.65,c,radius*3.2,pad);
}
fn abilityWave(q:vec3f,center:vec3f,t:f32,speed:f32,life:f32,weight:f32,clock:f32)->vec4f{
 if(t<0.||t>life){return vec4f(0);}let d:vec3f=q-center;let r:f32=length(d.xz);let theta:f32=atan2(d.z,d.x);
 let radius:f32=.2+speed*t+.08*sin(theta*7.+sin(theta*3.)-clock*2.);
 let height:f32=.12+.07*sin(theta*9.-clock*3.);
 let e:f32=pow((r-radius)/.15,2.)+pow((d.y-height)/.20,2.);if(e>10.){return vec4f(0);}
 let axis:vec3f=vec3f(d.x,0,d.z)/max(r,.05);let roll:f32=clamp((d.y-height)/.2,-1.,1.);
 let v:vec3f=axis*(speed+roll*1.5)+vec3f(0,1.2+2.*clamp((r-radius)/.15,-1.,1.),0);
 let w:f32=exp(-e)*weight*(1.-smoothstep(life*.5,life,t))*(.45+.55*pow(.5+.5*sin(theta*11.+clock),2.));return vec4f(v*w,w);
}
fn abilityWhipPoints(t:f32,f:vec3f,s:vec3f)->vec4f{
 let u:f32=clamp(t/1.15,0.,1.);let angle:f32=-1.5+3.5*smoothstep(.08,.7,u)-1.1*smoothstep(.7,1.,u);
 let reach:f32=.45+2.15*sin(u*3.14159265);return vec4f((f*cos(angle)+s*sin(angle))*reach+vec3f(0,.5+.5*sin(u*3.14159265),0),angle);
}
fn abilitySerpentCenter(destination:vec3f,t:f32)->vec3f{
 let u:f32=clamp(t/1.5,0.,1.);let f:vec3f=abilityForward(destination);let s:vec3f=abilitySide(f);
 return destination*u+s*(sin(u*12.56637)*.38*sin(u*3.14159))+vec3f(0,.35+.28*sin(u*3.14159)+.35*sin(u*12.56637)*sin(u*3.14159),0);
}
fn abilityOrbitCenter(index:f32,t:f32,f:vec3f,s:vec3f)->vec3f{
 let angle:f32=t*7.+index*2.0944;let r:f32=.72-.28*smoothstep(.65,1.2,t);
 return (f*cos(angle)+s*sin(angle))*r+vec3f(0,.7+.1*sin(angle*2.+index),0);
}
fn abilityEruptionWarning(age:f32,f:vec3f,s:vec3f,reach:f32)->vec3f{
 let a:vec3f=f*(reach*.25);let b:vec3f=f*(reach*.625)+s*.18;let c:vec3f=f*reach-s*.18;
 if(age<.28){return mix(vec3f(0),a,clamp(age/.28,0.,1.));}
 if(age<.7){return mix(a,b,clamp((age-.28)/.42,0.,1.));}return mix(b,c,clamp((age-.7)/.42,0.,1.));
}
fn abilityRainWork(q:vec3f,cell:vec2f,age:f32,pad:f32)->bool{
 let center:vec3f=powerRainCenter(cell,age);let d:vec3f=q-center;
 let dx:f32=max(0.,abs(d.x)-pad);let dz:f32=max(0.,abs(d.z)-pad);
 if(dx>.65||dz>.65){return false;}
 let dy:f32=max(0.,abs(d.y)-pad);if(pow(dx/.145,2.)+pow(dz/.145,2.)+pow(dy/.23,2.)<=10.){return true;}
 if(d.y>=-pad&&d.y<=.75+pad&&(dx*dx+dz*dz)<=.12){return true;}
 let seed:f32=powerHash(vec3f(cell,3.71));let phase:f32=fract(age/(1.1+.32*seed)+seed);
 let floorY:f32=max(0.,abs(q.y+.08)-pad);
 return phase>=.85&&(dx*dx+dz*dz)/.06+pow(floorY/.12,2.)<=10.;
}
fn abilityScatterAim(index:f32,aim:vec3f,f:vec3f,s:vec3f)->vec3f{
 if(index<.5){return aim+f*.32-s*.70+vec3f(0,.15,0);}
 if(index<1.5){return aim-f*.32-s*.42+vec3f(0,.58,0);}
 if(index<2.5){return aim+f*.55+vec3f(0,.08,0);}
 if(index<3.5){return aim-f*.22+s*.42+vec3f(0,.54,0);}return aim+f*.30+s*.68+vec3f(0,.10,0);
}
fn abilityNewSource(kind:f32,q:vec3f,aim:vec3f,age:f32,clock:f32,dir:vec3f)->vec4f{
 let f:vec3f=abilityPathForward(kind,aim,dir);let s:vec3f=abilitySide(f);let up:vec3f=vec3f(0,1,0);
 if(kind<7.5){
  if(age<.18){return abilityCue(q,age,.18,clock);}let t:f32=age-.18;
  let reach:f32=abilityReach(aim,3.6);if(t>.95){return abilityBurst(q,f*reach+up*.1,t-.95,.6,clock);}
  let u:f32=smoothstep(0.,.95,t);let c:vec3f=f*(reach*u)+up*(.1+.08*sin(t*18.));let progress:f32=clamp(t/.95,0.,1.);let speed:f32=6.*reach*progress*(1.-progress)/.95;
  return abilityRibbon(q,c-f*.75,c,.16,f*speed+up*.9,1.,clock)+abilityPacket(q,c, f*speed+up*1.4,vec3f(.26,.23,.35),.7,clock);
 }
 if(kind<8.5){
  if(age<.3){return abilityCue(q,age,.3,clock);}let t:f32=age-.3;if(t>1.55){return vec4f(0);}
  let tip:vec4f=abilityWhipPoints(t,f,s);let bend:vec3f=(f*cos(tip.w-.6)+s*sin(tip.w-.6))*(length(tip.xz)*.48)+up*.7;
  let next:vec4f=abilityWhipPoints(min(1.15,t+.005),f,s);let v:vec3f=(next.xyz-tip.xyz)*200.+up*.3;
  let rope:vec4f=abilityRibbon(q,up*.25,bend,.095,v,.45,clock)+abilityRibbon(q,bend,tip.xyz,.12,v,.8,clock);
  return rope*(1.-smoothstep(.85,1.15,t))+abilityBurst(q,abilityWhipPoints(.75,f,s).xyz,t-.75,.7,clock);
 }
 if(kind<9.5){
  if(age<.35){return abilityCue(q,age,.35,clock);}let t:f32=age-.35;
  let a:vec3f=abilityOrbitCenter(0.,min(t,1.2),f,s);let b:vec3f=abilityOrbitCenter(1.,min(t,1.2),f,s);let c:vec3f=abilityOrbitCenter(2.,min(t,1.2),f,s);
  if(t<1.2){return abilityPacket(q,a,cross(up,a)*5.+up*.4,vec3f(.24),.9,clock)+abilityPacket(q,b,cross(up,b)*5.+up*.4,vec3f(.24),.9,clock+2.)+abilityPacket(q,c,cross(up,c)*5.+up*.4,vec3f(.24),.9,clock+4.);}
  return abilityProjectile(q,a,aim+s*.65,t-1.2,.7,.28,.24,.8,clock)+abilityProjectile(q,b,aim,t-1.2,.8,.45,.24,.8,clock+2.)+abilityProjectile(q,c,aim-s*.65,t-1.2,.9,.22,.24,.8,clock+4.);
 }
 if(kind<10.5){
  if(age<.28){return abilityCue(q,age,.28,clock);}let t:f32=age-.28;
  if(t>=1.1){return abilityBurst(q,aim,t-1.1,1.1,clock);}
  let u:f32=t/1.1;let curve:f32=sin(u*3.14159265);let c:vec3f=aim*u+s*(sin(u*12.56637)*.35*curve)+up*(.35*(1.-u)+.65*curve);
  let v:vec3f=aim/1.1+s*((12.56637*cos(u*12.56637)*curve+3.14159*sin(u*12.56637)*cos(u*3.14159))*.35/1.1)+up*((-.35+.65*3.14159*cos(u*3.14159))/1.1);
  return abilityPacket(q,c,v,vec3f(.23),1.,clock)+abilityRibbon(q,c-v/max(length(v),.01)*.7,c,.09,v,.24,clock);
 }
 if(kind<11.5){
  if(age<.35){return abilityCue(q,age,.35,clock);}let t:f32=age-.35;
  if(t<.9){let c:vec3f=aim*(t/.9)*.35+up*(.3+2.5*sin(t/.9*1.570796));let span:f32=.45+.55*sin(t*8.);
   return abilityRibbon(q,c,c+s*span-f*.4,.12,f*2.+up*3.,.9,clock)+abilityRibbon(q,c,c-s*span-f*.4,.12,f*2.+up*3.,.9,clock+2.)+abilityPacket(q,c,f*2.+up*3.,vec3f(.22),.7,clock);}
  let start:vec3f=aim*.35+up*2.8;return abilityProjectile(q,start,aim,t-.9,.7,.2,.26,1.2,clock)+abilityWave(q,aim,t-1.6,3.,.65,.6,clock);
 }
 if(kind<12.5){
  if(age<.4){return abilityCue(q,age,.4,clock);}let t:f32=age-.4;let pulse:f32=.7+.3*sin(t*9.);let launch:f32=fract(t/.48)*max(.15,min(3.2,length(aim)-.3));
  let d:vec3f=aim/max(length(aim),.01);let head:vec3f=d*(.3+launch)+s*(.13*sin(t*7.))+up*.35;
  return abilityRibbon(q,up*.35,head,.11+launch*.045,d*9.+up*.6,.62*pulse,clock)+abilityPacket(q,head,d*9.+up*.8,vec3f(.20+launch*.025),.65*pulse,clock);
 }
 if(kind<13.5){
  if(age<.5){return abilityCue(q,age,.5,clock)+abilityPacket(q,dir*.15+up*.4,up*.7,vec3f(.10,.20,.10),age*.4,clock);}
  let t:f32=age-.5;let axis:vec3f=aim-up*.4;return abilityProjectile(q,up*.4,aim,t,.22,.05,.12,1.,clock)+abilityRibbon(q,up*.4,aim,.07,axis/max(length(axis),.01)*16.,.35*(1.-smoothstep(.08,.20,t)),clock);
 }
 if(kind<14.5){
  let t:f32=age-.45;if(t<0.){return abilityRibbon(q,-s*1.4,s*1.4,.075,up*.5,.25*smoothstep(0.,.45,age),clock);}
  let height:f32=.15+1.8*smoothstep(0.,.4,t);let heightB:f32=.15+1.8*smoothstep(.18,.58,t);let heightC:f32=.15+1.8*smoothstep(.36,.76,t);
  let a:vec3f=-s*1.05;let b:vec3f=s*.0;let c:vec3f=s*1.05;let sway:f32=.10*sin(t*5.);
  return abilityWallPanel(q,a,f,s,height,sway,clock)*(1.-smoothstep(2.1,2.85,t))+abilityWallPanel(q,b,f,s,heightB,-sway,clock+2.)*(1.-smoothstep(2.3,3.05,t))+abilityWallPanel(q,c,f,s,heightC,sway,clock+4.)*(1.-smoothstep(2.5,3.25,t));
 }
 if(kind<15.5){
  if(age<.35){return abilityCue(q,age,.35,clock);}let t:f32=age-.35;if(t>3.3){return vec4f(0);}
  let r:f32=length(q.xz);let theta:f32=atan2(q.z,q.x);let radius:f32=1.35+.10*sin(theta*5.-t*3.);
  let height:f32=.25+1.0*smoothstep(0.,.45,t);let e:f32=pow((r-radius)/.19,2.);
  if(e>10.||q.y<-.15||q.y>height+.35){return vec4f(0);}
  let pulse:f32=.35+.65*pow(.5+.5*sin(theta*9.-t*7.),2.);let axis:vec3f=vec3f(q.x,0,q.z)/max(r,.05);
  let w:f32=exp(-e)*(1.-smoothstep(height-.25,height+.35,q.y))*(1.-smoothstep(2.3,3.3,t))*pulse*.65;
  return vec4f((-axis*1.2+cross(up,axis)*2.+up*2.5)*w,w);
 }
 if(kind<16.5){
  if(age<.25){return abilityCue(q,age,.25,clock);}return abilityProjectile(q,aim-f*1.2+up*4.1,aim,age-.25,.9,.3,.28,1.1,clock)+abilityWave(q,aim,age-1.15,3.8,.6,.7,clock);
 }
 if(kind<17.5){
  if(age<.3){return abilityCue(q,age,.3,clock);}
  let a:vec3f=aim-s*.75-f*.4;let b:vec3f=aim+s*.75;let c:vec3f=aim+f*.65;
  return abilityProjectile(q,a-f*1.1+up*4.1,a,age-.3,.75,.2,.24,.85,clock)+abilityProjectile(q,b-f*.8+up*4.1,b,age-.8,.8,.35,.26,.9,clock+2.)+abilityProjectile(q,c-f*1.3+up*4.1,c,age-1.3,.85,.25,.28,1.,clock+4.);
 }
 if(kind<18.5){
  let reach:f32=abilityReach(aim,2.4);let a:vec3f=f*(reach*.25);let b:vec3f=f*(reach*.625)+s*.18;let c:vec3f=f*reach-s*.18;
  let t:f32=age-.28;let u:f32=age-.7;let v:f32=age-1.12;
  var warning:vec4f=vec4f(0);if(age<1.12){warning=abilityPacket(q,abilityEruptionWarning(age,f,s,reach)+up*.035,f*(reach/1.12)+up*.3,vec3f(.11,.05,.11),.20*(1.-smoothstep(.98,1.12,age)),clock);}
  return warning+abilityProjectile(q,a,a+up*1.3,t,.3,0.,.19,.9,clock)+abilityProjectile(q,b,b+up*1.6,u,.35,0.,.21,1.,clock+2.)+abilityProjectile(q,c,c+up*1.9,v,.4,0.,.23,1.1,clock+4.)+abilityWave(q,c,v-.4,3.,.45,.45,clock);
 }
 if(kind<19.5){
  if(age<1.8){let pulse:f32=.15+.2*pow(.5+.5*sin(age*14.),4.);return abilityPacket(q,up*.05,up*.4,vec3f(.18,.08,.18),pulse,clock)+abilityWave(q,vec3f(0),fract(age/.45)*.3,2.,.3,.12,clock);}
  return abilityBurst(q,up*.18,age-1.8,1.3,clock)+abilityWave(q,vec3f(0),age-1.8,4.5,.5,.8,clock);
 }
 if(kind<20.5){
  if(age<.3){return abilityCue(q,age,.3,clock);}let t:f32=age-.3;
  if(t<1.1){let angle:f32=t*10.;let r:f32=.95-.65*smoothstep(0.,1.1,t);let a:vec3f=(f*cos(angle)+s*sin(angle))*r+up*.18;
   return abilityPacket(q,a,cross(up,a)*6.-a*2.+up*1.5,vec3f(.19),.85,clock)+abilityPacket(q,-a+up*.36,-cross(up,a)*6.+a*2.+up*1.5,vec3f(.19),.85,clock+3.);}
  return abilityBurst(q,up*.45,t-1.1,1.2,clock)+abilityWave(q,vec3f(0),t-1.1,3.8,.6,.65,clock);
 }
 if(kind<21.5){
  if(age<.3){return abilityCue(q,age,.3,clock);}let t:f32=age-.3;if(t>=1.5){return abilityBurst(q,aim+up*.35,t-1.5,1.,clock);}
  let a:vec3f=abilitySerpentCenter(aim,t);let tb:f32=max(0.,t-.25);let tc:f32=max(0.,t-.5);let td:f32=max(0.,t-.75);
  let b:vec3f=abilitySerpentCenter(aim,tb);let c:vec3f=abilitySerpentCenter(aim,tc);let d:vec3f=abilitySerpentCenter(aim,td);
  let v:vec3f=(abilitySerpentCenter(aim,min(1.5,t+.01))-a)*100.+up*.3;
  let vb:vec3f=(abilitySerpentCenter(aim,min(1.5,tb+.01))-b)*100.+up*.3;
  let vc:vec3f=(abilitySerpentCenter(aim,min(1.5,tc+.01))-c)*100.+up*.3;
  return abilityPacket(q,a,v,vec3f(.24),1.,clock)+abilityRibbon(q,b,a,.22,v,1.6,clock)+abilityRibbon(q,c,b,.19,vb,1.3,clock+2.)+abilityRibbon(q,d,c,.15,vc,.95,clock+4.);
 }
 if(kind<22.5){
  if(age<.32){return abilityCue(q,age,.32,clock);}let t:f32=age-.32;
  return abilityProjectile(q,up*.4,abilityScatterAim(0.,aim,f,s),t,.65,.35,.13,.65,clock)+abilityProjectile(q,up*.4,abilityScatterAim(1.,aim,f,s),t-.04,.7,.3,.14,.7,clock+1.)+abilityProjectile(q,up*.4,abilityScatterAim(2.,aim,f,s),t-.08,.75,.4,.16,.8,clock+2.)+abilityProjectile(q,up*.4,abilityScatterAim(3.,aim,f,s),t-.12,.8,.3,.14,.7,clock+3.)+abilityProjectile(q,up*.4,abilityScatterAim(4.,aim,f,s),t-.16,.85,.35,.13,.65,clock+4.);
 }
 if(kind<23.5){
  if(age<.3){return abilityCue(q,age,.3,clock);}let t:f32=age-.3;
  let a:f32=1.4*smoothstep(0.,.65,t);let b:f32=1.4*smoothstep(.2,.85,t);let center:vec3f=up*.1;
  let va:vec3f=f*(2.5*clamp(dot(q,f)*3.,-1.,1.))+up*.8;let vb:vec3f=s*(2.5*clamp(dot(q,s)*3.,-1.,1.))+up*.8;
  let first:f32=1.3*(1.-smoothstep(.65,.85,t));let second:f32=1.3*smoothstep(.2,.25,t)*(1.-smoothstep(.85,1.05,t));
  return (abilityRibbon(q,center,center+f*a,.18,va,first,clock)+abilityRibbon(q,center,center-f*a,.18,va,first,clock+1.))+(abilityRibbon(q,center,center+s*b,.18,vb,second,clock+2.)+abilityRibbon(q,center,center-s*b,.18,vb,second,clock+3.))+abilityBurst(q,up*.15,t-.75,.8,clock);
 }
 if(age<.25){return abilityCue(q,age,.25,clock);}let t:f32=age-.25;if(t>1.75){return vec4f(0);}
 let u:f32=clamp(t/1.4,0.,1.);let outbound:f32=sin(u*3.14159265);let reach:f32=abilityReach(aim,2.8);let blade:vec3f=abilityCrescentAxis(s);let c:vec3f=f*(reach*outbound)+blade*(.75*sin(u*6.2831853))+up*.55;
 let v:vec3f=f*(reach*3.14159*cos(u*3.14159)/1.4)+blade*(.75*6.28318*cos(u*6.28318)/1.4);
 let width:f32=.45+.28*outbound;let middle:vec3f=c+f*.15;
 return (abilityRibbon(q,c-blade*width,middle,.15,v,1.3,clock)+abilityRibbon(q,middle,c+blade*width,.15,v,1.3,clock+2.))*(1.-smoothstep(1.25,1.5,t));
}
fn powerCastSupport(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,padding:f32,destination:vec3f,direction:vec3f,charge:f32)->bool{
 if(kind<.5||kind>24.5||age<0.||scale<=0.){return false;}
 let q:vec3f=(x-origin)/max(scale,.05);let aim:vec3f=(destination-origin)/max(scale,.05);let pad:f32=max(padding,0.)/max(scale,.05);
 let f:vec3f=abilityPathForward(kind,aim,direction);let s:vec3f=abilitySide(f);let up:vec3f=vec3f(0,1,0);
 if(kind<1.5){if(age<.18){return length(q-up*.4)<.65+pad;}let t:f32=age-.18;
  if(t>.45){return false;}let radius:f32=.12+4.5*t;
  let dr:f32=max(0.,abs(length(q.xz)-radius)-.135-pad);let dy:f32=max(0.,abs(q.y-.1)-.13-pad);
  return pow(dr/.16,2.)+pow(dy/.17,2.)<=12.;}
 if(kind<2.5){if(age<.22){return length(q-up*.4)<.65+pad;}return abilityProjectileSupport(q,up*.4,aim,age-.22,.65,.28,.44,pad);}
 if(kind<3.5){
  if(!powerSupport(kind,x,origin,scale,age-.25,padding)){return false;}
  if(pad<=0.){return true;}
  let t:f32=age-.25;
  return abilityRainWork(q,vec2f(0,0),t,pad)||abilityRainWork(q,vec2f(0,1),t,pad)||abilityRainWork(q,vec2f(0,2),t,pad)||abilityRainWork(q,vec2f(1,0),t,pad)||abilityRainWork(q,vec2f(1,1),t,pad)||abilityRainWork(q,vec2f(1,2),t,pad)||abilityRainWork(q,vec2f(2,0),t,pad)||abilityRainWork(q,vec2f(2,1),t,pad)||abilityRainWork(q,vec2f(2,2),t,pad);
 }
 if(kind<4.5){if(age<.4){return length(q-up*.4)<.65+pad;}let radial:f32=length(q.xz);
  let high:f32=min(3.4,q.y+pad);let height:f32=max(high,0.);let radius:f32=powerTornadoRadius(height)+.035+(.17+.02*height)*3.464102+.075*1.414214*clamp(high,0.,3.);
  return q.y>-.22-pad&&q.y<3.4+pad&&radial<min(2.25,max(1.03,radius))+pad;}
 if(kind<5.5){return false;}
 if(kind<6.5){if(age<1.2){let orbit:vec3f=vec3f(cos(age*18.),.13*sin(age*11.),sin(age*18.))*.18;return length(q-orbit)<.45+pad;}return age<=1.49&&length(q)<.64+3.6*(age-1.2)+pad;}
 if(kind<7.5){if(age<.18){return length(q-up*.4)<.65+pad;}let t:f32=age-.18;let reach:f32=abilityReach(aim,3.6);let c:vec3f=f*(reach*smoothstep(0.,.95,t))+up*(.1+.08*sin(t*18.));
  if(t>.95){return t<1.37&&length(q-f*reach-up*.1)<.40+3.2*(t-.95)+.5+pad;}return abilityCapsule(q,c-f*.75,c,1.12,pad);}
 if(kind<8.5){if(age<.3){return length(q-up*.4)<.65+pad;}let t:f32=age-.3;if(t>1.17){return false;}
  let tip:vec4f=abilityWhipPoints(t,f,s);let bend:vec3f=(f*cos(tip.w-.6)+s*sin(tip.w-.6))*(length(tip.xz)*.48)+up*.7;
  let impact:vec3f=abilityWhipPoints(.75,f,s).xyz;
  return abilityCapsule(q,up*.25,bend,.34,pad)||abilityCapsule(q,bend,tip.xyz,.39,pad)||(t>=.75&&length(q-impact)<.40+3.2*(t-.75)+.5+pad);}
 if(kind<9.5){if(age<1.55){return length(q-up*.7)<1.6+pad;}let t:f32=age-1.55;
  return abilityProjectileSupport(q,abilityOrbitCenter(0.,1.2,f,s),aim+s*.65,t,.7,.28,.24,pad)||abilityProjectileSupport(q,abilityOrbitCenter(1.,1.2,f,s),aim,t,.8,.45,.24,pad)||abilityProjectileSupport(q,abilityOrbitCenter(2.,1.2,f,s),aim-s*.65,t,.9,.22,.24,pad);}
 if(kind<10.5){if(age<.28){return length(q-up*.4)<.65+pad;}let t:f32=age-.28;if(t>1.1){return t<1.52&&length(q-aim)<.40+3.2*(t-1.1)+.5+pad;}
  let u:f32=t/1.1;let c:vec3f=aim*u+s*(sin(u*12.56637)*.35*sin(u*3.14159265))+up*(.35*(1.-u)+.65*sin(u*3.14159265));return length(q-c)<1.5+pad;}
 if(kind<11.5){if(age<.35){return length(q-up*.4)<.65+pad;}let t:f32=age-.35;if(t<.9){let c:vec3f=aim*(t/.9)*.35+up*(.3+2.5*sin(t/.9*1.570796));return length(q-c)<1.75+pad;}
  return abilityProjectileSupport(q,aim*.35+up*2.8,aim,t-.9,.7,.2,.26,pad)||(t>=1.6&&t<2.25&&abs(length((q-aim).xz)-(.2+3.*(t-1.6)))<.6+pad&&abs(q.y-aim.y)<.85+pad);}
 if(kind<12.5){if(age<.4){return length(q-up*.4)<.65+pad;}let launch:f32=fract((age-.4)/.48)*max(.15,min(3.2,length(aim)-.3));let d:vec3f=aim/max(length(aim),.01);let head:vec3f=d*(.3+launch)+s*(.13*sin((age-.4)*7.))+up*.35;return abilityCapsule(q,up*.35,head,1.,pad);}
 if(kind<13.5){if(age<.5){return length(q-up*.4)<.65+pad||length(q-direction*.15-up*.4)<.64+pad;}let t:f32=age-.5;return abilityProjectileSupport(q,up*.4,aim,t,.22,.05,.12,pad)||(t<.2&&abilityCapsule(q,up*.4,aim,.23,pad));}
 if(kind<14.5){let t:f32=age-.45;let height:f32=.15+1.8*smoothstep(0.,.4,t);return t<3.25&&abilityCapsule(q,-s*1.05+up*(height*.5),s*1.05+up*(height*.5),height*.5+.85,pad);}
 if(kind<15.5){let t:f32=age-.35;if(t<0.){return length(q-up*.4)<.65+pad;}return t<3.3&&abs(length(q.xz)-1.35)<.71+pad&&q.y>-.15-pad&&q.y<1.6+pad;}
 if(kind<16.5){if(age<.25){return length(q-up*.4)<.65+pad;}let t:f32=age-.25;return abilityProjectileSupport(q,aim-f*1.2+up*4.1,aim,t,.9,.3,.28,pad)||(t>=.9&&t<1.5&&abs(length((q-aim).xz)-(.2+3.8*(t-.9)))<.6+pad&&abs(q.y-aim.y)<.85+pad);}
 if(kind<17.5){if(age<.3){return length(q-up*.4)<.65+pad;}let a:vec3f=aim-s*.75-f*.4;let b:vec3f=aim+s*.75;let c:vec3f=aim+f*.65;
  return abilityProjectileSupport(q,a-f*1.1+up*4.1,a,age-.3,.75,.2,.24,pad)||abilityProjectileSupport(q,b-f*.8+up*4.1,b,age-.8,.8,.35,.26,pad)||abilityProjectileSupport(q,c-f*1.3+up*4.1,c,age-1.3,.85,.25,.28,pad);}
 if(kind<18.5){let reach:f32=abilityReach(aim,2.4);let a:vec3f=f*(reach*.25);let b:vec3f=f*(reach*.625)+s*.18;let c:vec3f=f*reach-s*.18;let t:f32=age-1.12;
  return (age<1.12&&length(q-abilityEruptionWarning(age,f,s,reach)-up*.035)<.35+pad)||abilityProjectileSupport(q,a,a+up*1.3,age-.28,.3,0.,.19,pad)||abilityProjectileSupport(q,b,b+up*1.6,age-.7,.35,0.,.21,pad)||abilityProjectileSupport(q,c,c+up*1.9,t,.4,0.,.23,pad)||(t>=.4&&t<.85&&abs(length((q-c).xz)-(.2+3.*(t-.4)))<.6+pad&&abs(q.y)<.85+pad);}
 if(kind<19.5){if(age<1.8){return length(q)<1.55+pad;}let t:f32=age-1.8;return (t<.42&&length(q-up*.18)<.9+3.2*t+pad)||(t<.5&&abs(length(q.xz)-(.2+4.5*t))<.6+pad&&abs(q.y)<.85+pad);}
 if(kind<20.5){if(age<.3){return length(q-up*.4)<.65+pad;}let t:f32=age-.3;if(t<1.1){return length(q-up*.18)<1.6+pad;}let release:f32=t-1.1;return (release<.42&&length(q-up*.45)<.9+3.2*release+pad)||(release<.6&&abs(length(q.xz)-(.2+3.8*release))<.6+pad&&abs(q.y)<.85+pad);}
 if(kind<21.5){if(age<.3){return length(q-up*.4)<.65+pad;}let t:f32=age-.3;if(t>=1.5){return t<1.92&&length(q-aim-up*.35)<.9+3.2*(t-1.5)+pad;}
  let a:vec3f=abilitySerpentCenter(aim,t);let b:vec3f=abilitySerpentCenter(aim,max(0.,t-.25));let c:vec3f=abilitySerpentCenter(aim,max(0.,t-.5));let d:vec3f=abilitySerpentCenter(aim,max(0.,t-.75));return abilityCapsule(q,b,a,.78,pad)||abilityCapsule(q,c,b,.62,pad)||abilityCapsule(q,d,c,.49,pad);}
 if(kind<22.5){if(age<.32){return length(q-up*.4)<.65+pad;}let t:f32=age-.32;
  return abilityProjectileSupport(q,up*.4,abilityScatterAim(0.,aim,f,s),t,.65,.35,.13,pad)||abilityProjectileSupport(q,up*.4,abilityScatterAim(1.,aim,f,s),t-.04,.7,.3,.14,pad)||abilityProjectileSupport(q,up*.4,abilityScatterAim(2.,aim,f,s),t-.08,.75,.4,.16,pad)||abilityProjectileSupport(q,up*.4,abilityScatterAim(3.,aim,f,s),t-.12,.8,.3,.14,pad)||abilityProjectileSupport(q,up*.4,abilityScatterAim(4.,aim,f,s),t-.16,.85,.35,.13,pad);}
 if(kind<23.5){if(age<.3){return length(q-up*.4)<.65+pad;}let t:f32=age-.3;
  let a:f32=1.4*smoothstep(0.,.65,t);let b:f32=1.4*smoothstep(.2,.85,t);
  return (t<.85&&abilityCapsule(q,-f*a+up*.1,f*a+up*.1,.58,pad))||(t>=.2&&t<1.05&&abilityCapsule(q,-s*b+up*.1,s*b+up*.1,.58,pad))||(t>=.75&&t<1.17&&length(q-up*.15)<.9+3.2*(t-.75)+pad);}
 if(age<.25){return length(q-up*.4)<.65+pad;}let t:f32=age-.25;if(t>1.5){return false;}let u:f32=clamp(t/1.4,0.,1.);let outbound:f32=sin(u*3.14159265);
 let reach:f32=abilityReach(aim,2.8);let blade:vec3f=abilityCrescentAxis(s);let c:vec3f=f*(reach*outbound)+blade*(.75*sin(u*6.2831853))+up*.55;let width:f32=.45+.28*outbound;
 return abilityCapsule(q,c-blade*width,c+f*.15,.49,pad)||abilityCapsule(q,c+f*.15,c+blade*width,.49,pad);
}
fn powerCastSource(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,clock:f32,direction:vec3f,strength:f32,destination:vec3f,charge:f32)->vec4f{
 if(!powerCastSupport(kind,x,origin,scale,age,0.,destination,direction,charge)){return vec4f(0);}
 let q:vec3f=(x-origin)/max(scale,.05);let aim:vec3f=(destination-origin)/max(scale,.05);
 let drive:f32=clamp(strength,.25,2.)*clamp(charge,.65,1.);
 if(kind<1.5){if(age<.18){let cue:vec4f=abilityFinish(abilityCue(q,age,.18,clock));return vec4f(cue.xyz*sqrt(drive),cue.w*drive);}return powerSource(kind,x,origin,scale,age-.18,clock,direction,drive);}
 if(kind<2.5){var p:vec4f=abilityCue(q,age,.22,clock);if(age>=.22){p=abilityProjectile(q,vec3f(0,.4,0),aim,age-.22,.65,.28,.44,1.2,clock);}let result:vec4f=abilityFinish(p);return vec4f(result.xyz*scale*sqrt(drive),result.w*drive);}
 if(kind<3.5){return powerSource(kind,x,origin,scale,age-.25,clock,direction,drive);}
 if(kind<4.5){if(age<.4){let cue:vec4f=abilityFinish(abilityCue(q,age,.4,clock));return vec4f(cue.xyz*sqrt(drive),cue.w*drive);}return powerSource(kind,x,origin,scale,age-.4,clock,direction,drive);}
 if(kind<6.5){return powerSource(kind,x,origin,scale,age,clock,direction,drive);}
 let result:vec4f=abilityFinish(abilityNewSource(kind,q,aim,age,clock,direction));return vec4f(result.xyz*scale*sqrt(drive),result.w*drive);
}
fn powerCastAcceleration(kind:f32,x:vec3f,origin:vec3f,scale:f32,age:f32,clock:f32,direction:vec3f,strength:f32,destination:vec3f,charge:f32)->vec3f{
 if(kind>3.5&&kind<4.5){return powerAcceleration(kind,x,origin,scale,age-.4,clock,direction,strength);}
 if(kind<19.5||kind>20.5||age<.3||age>1.4){return vec3f(0);}
 let q:vec3f=(x-origin)/max(scale,.05);let r:f32=length(q.xz);if(r>1.6||q.y<-.2||q.y>1.3){return vec3f(0);}
 let axis:vec3f=vec3f(q.x,0,q.z)/max(r,.08);let band:f32=exp(-pow(r/1.1,2.))*(1.-smoothstep(.5,1.3,q.y));
 return (cross(vec3f(0,1,0),axis)*5.-axis*3.+vec3f(0,1,0))*band*clamp(strength,.25,2.);
}
${powerExpansionWGSL}
`;
