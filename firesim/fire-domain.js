/* Burst sources get a deeper volume with the same in-plane voxel spacing. */
import { FIRE_PRESETS } from './pyro-gpu/presets.js?v=0c4b630ed586cdec';
export function createFireDomain(preset){
  const params=new URL(location.href).searchParams;
  const blast=FIRE_PRESETS.some(p=>p.id===preset&&p.effect[0]===0);
  const object=FIRE_PRESETS.some(p=>p.id===preset&&!!p.object);
  const extent=blast?[8,8,4]:[14,7.875,object?3:1.8];
  const minimum=[-extent[0]/2,-1.05,-extent[2]/2];
  const glsl=v=>'vec3('+v.map(x=>Number(x).toFixed(5)).join(',')+')';
  return {blast,object,extent,minimum,nx:blast?384:params.get('grid')==='896'?896:640,
    ny:blast?384:params.get('grid')==='896'?504:360,depth:blast?64:32,
    extentGLSL:glsl(extent),minimumGLSL:glsl(minimum)};
}
