// Scalar layout: soot, temperature, fuel, oxygen deficit (zero is fresh air).
// Shared by transport, expansion and emission so they use the same reaction.
// Wood uses a reduced hot-product ignition memory: real advected soot and
// oxygen consumption indicate prior burning. This is not radical/species
// chemistry. Cold products alone cannot burn; fuel, oxygen and heat remain
// required and products cool below480 K into the same extinguished state.
const smooth=(low,high,value)=>{const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t);};
export function woodCombustionActivation(c){
  if(c.length!==4||!Array.from(c).every(value=>Number.isFinite(value)&&value>=0))
    throw Error('Invalid wood combustion state');
  const ignited=smooth(.005,.05,Math.max(c[0],c[3]));
  return Math.max(smooth(.35,.75,c[1]),ignited*smooth(.15,.35,c[1]));
}
export function woodReactionRate(c){
  return Math.min(c[2],Math.max(1-c[3],0)/.7)*4*woodCombustionActivation(c);
}
export const combustionWGSL=`
fn reactionRate(c:vec4f)->f32{
 let oxygen=max(1.-c.w,0.);
 return min(max(c.z,0.),oxygen/.7)*4.*smoothstep(.35,.75,c.y);
}
fn flameActivity(c:vec4f)->f32{return min(reactionRate(c)*.5,1.);}
fn woodCombustionActivation(c:vec4f)->f32{
 let products=smoothstep(.005,.05,max(c.x,c.w));
 return max(smoothstep(.35,.75,c.y),products*smoothstep(.15,.35,c.y));
}
fn woodReactionRate(c:vec4f)->f32{
 let oxygen=max(1.-c.w,0.);
 return min(max(c.z,0.),oxygen/.7)*4.*woodCombustionActivation(c);
}
fn woodFlameActivity(c:vec4f)->f32{return min(woodReactionRate(c)*.5,1.);}
`;
// Include this only with objectWGSL. Non-wood source chemistry is unchanged.
export const objectCombustionWGSL=`
fn sceneReactionRate(c:vec4f)->f32{
 if(abs(object.tint.w)>.5){return woodReactionRate(c);}return reactionRate(c);
}
fn sceneFlameActivity(c:vec4f)->f32{
 if(abs(object.tint.w)>.5){return woodFlameActivity(c);}return flameActivity(c);
}
`;
