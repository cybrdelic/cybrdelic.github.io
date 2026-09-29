// A compact 3D atlas of 8^3 chemistry bricks. Page zero is unmapped.
// One-texel halos support hardware trilinear filtering across brick seams;
// the halo-free QA mode reads the eight seam voxels explicitly.
export function sparseSamplerWGSL({ D = 256, brick = 8, halo = 1, atlasTiles = 12,
  name = 'virtualField', atlasBinding = 1, pagesBinding = 3, samplerBinding = 2,
  samplerName = `${name}Sampler`, declareSampler = true, seamMode = 'manual' } = {}) {
  if (!Number.isInteger(D) || D % brick || brick < 2 || !Number.isInteger(halo) || halo < 0 || halo > 1 || !Number.isInteger(atlasTiles) || atlasTiles < 1)
    throw Error('Invalid sparse atlas dimensions');
  if (!['manual','filtered'].includes(seamMode)) throw Error('Invalid sparse seam mode');
  if (halo === 0 && seamMode === 'filtered') throw Error('Hardware-filtered sparse fields require a halo');
  const B = D / brick, stride = brick + 2 * halo, side = atlasTiles * stride;
  return `
@group(0) @binding(${atlasBinding}) var ${name}Atlas:texture_3d<f32>;
@group(0) @binding(${pagesBinding}) var<storage,read> ${name}Pages:array<u32>;
${declareSampler ? `@group(0) @binding(${samplerBinding}) var ${samplerName}:sampler;` : ''}
fn ${name}Voxel(i:vec3i)->vec4f{
 let voxel=clamp(i,vec3i(0),vec3i(${D-1}));let b=voxel/${brick};
 let page=${name}Pages[u32(b.x+${B}*(b.y+${B}*b.z))];if(page==0u){return vec4f(0);}
 let slot=page-1u;let tile=vec3u(slot%${atlasTiles}u,(slot/${atlasTiles}u)%${atlasTiles}u,slot/${atlasTiles*atlasTiles}u);
 return textureLoad(${name}Atlas,vec3i(tile*${stride}u)+voxel-b*${brick}+vec3i(${halo}),0);
}
fn ${name}(x:vec3f)->vec4f{
 if(any(x<vec3f(-3.,0.,-3.))||any(x>vec3f(3.,6.,3.))){return vec4f(0);}
 let q=(x-vec3f(-3.,0.,-3.))*(${D}./6.)-vec3f(.5);
 let low=vec3i(floor(q));let high=low+vec3i(1);
 let first=clamp(low,vec3i(0),vec3i(${D-1}))/${brick};
 let last=clamp(high,vec3i(0),vec3i(${D-1}))/${brick};
 ${seamMode === 'manual' ? `if(any(first!=last)){
  let a=${name}Voxel(low);let b=${name}Voxel(low+vec3i(1,0,0));
  let c=${name}Voxel(low+vec3i(0,1,0));let d=${name}Voxel(low+vec3i(1,1,0));
  let e=${name}Voxel(low+vec3i(0,0,1));let f=${name}Voxel(low+vec3i(1,0,1));
  let g=${name}Voxel(low+vec3i(0,1,1));let h=${name}Voxel(high);
  let t=fract(q);return mix(mix(mix(a,b,t.x),mix(c,d,t.x),t.y),mix(mix(e,f,t.x),mix(g,h,t.x),t.y),t.z);
 }` : ''}
 var b=first;var page=${name}Pages[u32(b.x+${B}*(b.y+${B}*b.z))];
 ${seamMode === 'filtered' ? `if(page==0u&&any(first!=last)){
  for(var corner=1u;corner<8u;corner++){
   let candidate=vec3i(select(first.x,last.x,(corner&1u)!=0u),select(first.y,last.y,(corner&2u)!=0u),select(first.z,last.z,(corner&4u)!=0u));
   let entry=${name}Pages[u32(candidate.x+${B}*(candidate.y+${B}*candidate.z))];
   if(entry>0u){b=candidate;page=entry;break;}
  }
 }` : ''}
 if(page==0u){return vec4f(0);}
 let slot=page-1u;let tile=vec3u(slot%${atlasTiles}u,(slot/${atlasTiles}u)%${atlasTiles}u,slot/${atlasTiles*atlasTiles}u);
 let texel=vec3f(tile*${stride}u)+${halo === 0 ? `clamp(q,vec3f(0),vec3f(${D-1}))` : 'q'}-vec3f(b*${brick})+vec3f(${halo}.);
 return textureSampleLevel(${name}Atlas,${samplerName},(texel+vec3f(.5))/${side}.,0);
}`;
}
