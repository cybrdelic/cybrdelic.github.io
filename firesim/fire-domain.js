/* Explosion gets a deeper volume with the same in-plane voxel spacing. */
export function createFireDomain(preset){
  const params=new URL(location.href).searchParams;
  const blast=preset==='explosion';
  const extent=blast?[8,8,4]:[14,7.875,1.8];
  const minimum=[-extent[0]/2,-1.05,-extent[2]/2];
  const glsl=v=>'vec3('+v.map(x=>Number(x).toFixed(5)).join(',')+')';
  return {blast,extent,minimum,nx:blast?384:params.get('grid')==='896'?896:640,
    ny:blast?384:params.get('grid')==='896'?504:360,depth:blast?64:32,
    extentGLSL:glsl(extent),minimumGLSL:glsl(minimum)};
}
