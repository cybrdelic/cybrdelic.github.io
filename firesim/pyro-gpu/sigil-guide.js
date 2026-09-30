// A thin, physical substrate for the approved CYBR emitter contour. The
// coordinates deliberately match charge() in shaders.js; this is static
// source artwork, not a rendered fire frame or a camera-facing overlay.
export const sigilGuideWGSL = `
@group(0) @binding(31) var guideSource:texture_2d<f32>;
fn guidePixel(x:vec3f)->vec2f{
 let q=(x-object.origin.xyz)/object.origin.w;
 return vec2f((q.x*4.+7.)/14.,(q.y*4.+2.95)/7.875)*vec2f(textureDimensions(guideSource))-.5;
}
fn guideCorners(cell:vec2i)->vec4f{
 let hi=vec2i(textureDimensions(guideSource))-1;
 return vec4f(textureLoad(guideSource,clamp(cell,vec2i(0),hi),0).r,
  textureLoad(guideSource,clamp(cell+vec2i(1,0),vec2i(0),hi),0).r,
  textureLoad(guideSource,clamp(cell+vec2i(0,1),vec2i(0),hi),0).r,
  textureLoad(guideSource,clamp(cell+vec2i(1),vec2i(0),hi),0).r);
}
fn guideBilinear(c:vec4f,f:vec2f)->f32{return mix(mix(c.x,c.y,f.x),mix(c.z,c.w,f.x),f.y);}
fn guideSupport(pixel:vec2f)->f32{
 let cell=vec2i(floor(pixel));return guideBilinear(guideCorners(cell),pixel-vec2f(cell));
}
// A bilinear support field along a ray is quadratic within one texture cell.
// Check its interior maximum as well as its endpoints, then bisect the first
// ascending interval. This catches narrow side-wall crossings at grazing
// angles instead of sparsely probing the slab and skipping contour strokes.
fn guideCrossing(c:vec4f,f:vec2f,d:vec2f)->f32{
 if(guideBilinear(c,f)>=.5){return 0.;}
 let k=c.w-c.y-c.z+c.x;
 let a=k*d.x*d.y;
 let b=(c.y-c.x)*d.x+(c.z-c.x)*d.y+k*(f.x*d.y+f.y*d.x);
 var peak=1.;if(a<0.){peak=clamp(-b/(2.*a),0.,1.);}
 if(guideBilinear(c,f+d*peak)<.5){return 2.;}
 var low=0.;var high=peak;
 for(var i=0u;i<12u;i++){let mid=(low+high)*.5;
  if(guideBilinear(c,f+d*mid)>=.5){high=mid;}else{low=mid;}}
 return high;
}
fn sigilGuideHit(eye:vec3f,ray:vec3f,limit:f32)->vec4f{
 if(abs(cam.ambient.w-10.)>.5||object.origin.w<=0.){return vec4f(0,0,0,limit);}
 // The native texture has a zero border. Its UV domain bounds the Y extent;
 // X also retains charge()'s +/-1.6 source limit. Clip against the fluid
 // domain/floor so the substrate cannot continue below the rendered room.
 let low=max(LO,object.origin.xyz+vec3f(-1.6,-2.95/4.,-.018)*object.origin.w);
 let high=min(LO+EXT,object.origin.xyz+vec3f(1.6,(7.875-2.95)/4.,.018)*object.origin.w);
 let safe=select(vec3f(.000001),ray,abs(ray)>vec3f(.000001));
 let a=(low-eye)/safe;let b=(high-eye)/safe;let near=min(a,b);let far=max(a,b);
 let start=max(0.,max(near.x,max(near.y,near.z)));let end=min(limit,min(far.x,min(far.y,far.z)));
 if(end<=start){return vec4f(0,0,0,limit);}
 var cap=vec3f(0,0,-sign(ray.z));
 if(near.x>=near.y&&near.x>=near.z){cap=vec3f(-sign(ray.x),0,0);}
 else if(near.y>=near.z){cap=vec3f(0,-sign(ray.y),0);}
 let origin=guidePixel(eye);let pixel=guidePixel(eye+ray*start);
 if(guideSupport(pixel)>=.5){return vec4f(cap,start);}
 let size=vec2f(textureDimensions(guideSource));
 let direction=ray.xy/object.origin.w*vec2f(4./14.,4./7.875)*size;
 var cell=vec2i(floor(pixel));
 // On an exact cell edge choose the cell the ray is entering, particularly
 // for negative directions. Subsequent crossings advance integer indices.
 if(pixel.x==floor(pixel.x)&&direction.x<0.){cell.x-=1;}
 if(pixel.y==floor(pixel.y)&&direction.y<0.){cell.y-=1;}
 var t=start;
 let count=textureDimensions(guideSource).x+textureDimensions(guideSource).y+4u;
 for(var i=0u;i<count;i++){
  let edge=vec2f(cell)+select(vec2f(0),vec2f(1),direction>vec2f(0));
  let crossing=select(vec2f(1e20),(edge-origin)/select(vec2f(.000001),direction,abs(direction)>vec2f(.000001)),abs(direction)>vec2f(.000001));
  let next=min(end,min(crossing.x,crossing.y));
  if(next>t){
   let c=guideCorners(cell);let f=origin+direction*t-vec2f(cell);
   let delta=direction*(next-t);let hit=guideCrossing(c,f,delta);
   if(hit<=1.){
    let at=f+delta*hit;let k=c.w-c.y-c.z+c.x;
    let gradient=vec2f(c.y-c.x+k*at.y,c.z-c.x+k*at.x)*size*vec2f(4./14.,4./7.875);
    let n=vec3f(-gradient,0);return vec4f(n/max(length(n),.000001),mix(t,next,hit));
   }
  }
  if(next>=end){break;}
  if(crossing.x<=crossing.y){cell.x+=select(-1,1,direction.x>0.);}
  if(crossing.y<=crossing.x){cell.y+=select(-1,1,direction.y>0.);}
  t=max(t,next);
 }
 return vec4f(0,0,0,limit);
}
`;
