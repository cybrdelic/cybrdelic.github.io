// Scalar layout: soot, temperature, fuel, oxygen deficit (zero is fresh air).
// Shared by transport, expansion and emission so they use the same reaction.
export const combustionWGSL=`
fn reactionRate(c:vec4f)->f32{
 let oxygen=max(1.-c.w,0.);
 return min(max(c.z,0.),oxygen/.7)*4.*smoothstep(.35,.75,c.y);
}
fn flameActivity(c:vec4f)->f32{return min(reactionRate(c)*.5,1.);}
`;
