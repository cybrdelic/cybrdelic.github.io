/* Analytic source props and optional sampled object surfaces, lit by the live
 * fire clusters. These are visual receivers, not fluid collision meshes. */
window.FireProps = `
  #ifndef FIRE_OBJECT_SOURCE
  #define FIRE_OBJECT_SOURCE 1
  #endif
  uniform int visibleEmitter;
  uniform float inspectionLight;
  uniform vec2 sourcePosition;
  uniform float sourceScale;
  #if FIRE_OBJECT_SOURCE
  uniform highp sampler3D objectTex;
  float objectDistanceAt(vec3 world,vec3 center){
    vec3 uv=((world-center)/sourceScale+vec3(1.5))/3.;
    if(any(lessThan(uv,vec3(0)))||any(greaterThan(uv,vec3(1))))
      return (length(max(abs((world-center)/sourceScale)-vec3(1.5),vec3(0)))+.01)*sourceScale;
    return texture(objectTex,uv).r*sourceScale;
  }
  vec3 objectNormalAt(vec3 world,vec3 center){
    float h=.055*sourceScale;
    vec3 g=vec3(
      objectDistanceAt(world+vec3(h,0,0),center)-objectDistanceAt(world-vec3(h,0,0),center),
      objectDistanceAt(world+vec3(0,h,0),center)-objectDistanceAt(world-vec3(0,h,0),center),
      objectDistanceAt(world+vec3(0,0,h),center)-objectDistanceAt(world-vec3(0,0,h),center));
    return g/max(length(g),.0001);
  }
  #endif
  float sphereHit(vec3 eye,vec3 ray,vec3 center,float radius){
    vec3 q=eye-center;float b=dot(q,ray),h=b*b-dot(q,q)+radius*radius;
    return h>0.?max(-b-sqrt(h),0.):1000.;
  }
  void capsuleHit(vec3 eye,vec3 ray,vec3 a,vec3 b,float radius,inout float nearest,inout vec3 normal){
    vec3 axis=b-a,q=eye-a;float aa=dot(axis,axis),ar=dot(axis,ray),aq=dot(axis,q);
    float k2=aa-ar*ar,k1=aa*dot(q,ray)-aq*ar,k0=aa*dot(q,q)-aq*aq-radius*radius*aa;
    float h=k1*k1-k2*k0,t=1000.;
    if(h>0.&&k2>.00001){float hit=(-k1-sqrt(h))/k2;float y=aq+hit*ar;if(hit>0.&&y>0.&&y<aa)t=hit;}
    t=min(t,min(sphereHit(eye,ray,a,radius),sphereHit(eye,ray,b,radius)));
    if(t>0.&&t<nearest){nearest=t;vec3 at=eye+ray*t;normal=normalize(at-(a+axis*clamp(dot(at-a,axis)/aa,0.,1.)));}
  }
  bool sourceProp(vec3 eye,vec3 ray,inout float distance,out vec3 color){
    color=vec3(0);
    #if FIRE_OBJECT_SOURCE
    if(visibleEmitter!=1&&visibleEmitter!=2&&(visibleEmitter<16||visibleEmitter>20))return false;
    #else
    if(visibleEmitter!=1&&visibleEmitter!=2)return false;
    #endif
    vec3 c=vec3(-7.+sourcePosition.x*14.,-1.05+sourcePosition.y*7.875,0.);
    vec3 n=vec3(0);float hit=distance;
    #if FIRE_OBJECT_SOURCE
    if(visibleEmitter>=16&&visibleEmitter<=20){
      float t=sphereHit(eye,ray,c,2.65*sourceScale);
      if(t>=distance)return false;
      for(int i=0;i<52;i++){
        vec3 p=eye+ray*t;
        float sdf=objectDistanceAt(p,c);
        if(abs(sdf)<.042*sourceScale){hit=t;n=objectNormalAt(p,c);break;}
        t+=max(abs(sdf)*.78,.028*sourceScale);
        if(t>=distance||t>20.)break;
      }
    } else
    #endif
    if(visibleEmitter==1){
      capsuleHit(eye,ray,c+vec3(-.95,-.17,-.34)*sourceScale,c+vec3(.95,-.17,.34)*sourceScale,.18*sourceScale,hit,n);
      capsuleHit(eye,ray,c+vec3(-.90,-.17,.37)*sourceScale,c+vec3(.90,-.17,-.37)*sourceScale,.18*sourceScale,hit,n);
      capsuleHit(eye,ray,c+vec3(-.65,.05,-.42)*sourceScale,c+vec3(.65,.05,.42)*sourceScale,.16*sourceScale,hit,n);
    } else {
      capsuleHit(eye,ray,c+vec3(0,-.85,0),c+vec3(0,-.18,0),.095,hit,n);
      capsuleHit(eye,ray,c+vec3(0,-.24,0),c+vec3(0,-.06,0),.19,hit,n);
    }
    if(hit>=distance)return false;
    distance=hit;vec3 at=eye+ray*hit;
    vec3 albedo=visibleEmitter==1?vec3(.14,.065,.025):visibleEmitter==2?vec3(.23,.24,.26)
      :visibleEmitter==18?vec3(.16,.18,.19):visibleEmitter==19?vec3(.32,.28,.24)
      :visibleEmitter==20?vec3(.12,.075,.035):vec3(.18,.09,.04);
    bool timber=woodEnabled>.5&&(visibleEmitter==1||visibleEmitter==16||visibleEmitter==17||visibleEmitter==20);
    float roughness=.85;vec3 grain=visibleEmitter==1||visibleEmitter==16?vec3(1,0,0):vec3(0,1,0);
    vec4 stock=vec4(1,0,0,0),wear=vec4(0,0,0,1);
    if(timber){
      stock=woodStockAt(at);wear=woodWearAt(at);
      vec3 local=(at-c)/sourceScale;bool logs=visibleEmitter==1||visibleEmitter==16;
      vec3 materialPoint=logs?local.yxz:local,materialNormal=logs?n.yxz:n;
      vec4 surface=woodMaterial(materialPoint,materialNormal,stock.g,stock.r,stock.a,wear.z,woodBark);
      albedo=surface.rgb;roughness=surface.a;
      materialNormal=woodNormal(materialPoint,materialNormal,stock.r,stock.a,wear.z,woodBark);
      n=logs?materialNormal.yxz:materialNormal;
    }
    #if FIRE_OBJECT_SOURCE
    if(visibleEmitter>=16&&visibleEmitter<=20){
      vec3 uv=((at-c)/sourceScale+vec3(1.5))/3.;vec4 material=texture(objectTex,clamp(uv,vec3(0),vec3(1)));
      if(visibleEmitter==20&&material.w>7.5){albedo=mix(vec3(.035,.11,.035),vec3(.012,.010,.008),clamp(stock.a/.25,0.,1.));timber=false;}
      if(visibleEmitter==18&&material.y<.05)albedo=vec3(.21,.24,.26);
    }
    #endif
    for(int i=0;i<32;i++){
      vec3 light,power;roomLight(i,light,power);vec3 d=light-at;float r2=max(dot(d,d),.001);
      vec3 l=d*inversesqrt(r2);float nl=max(dot(n,l),0.);
      color+=(albedo+(timber?vec3(woodSpecular(n,l,normalize(eye-at),grain,roughness)):vec3(0)))*power*nl/(r2+.12);
    }
    color+=albedo*ambientLight*(.25+.75*max(n.y,0.))/3.14159;
    for(int i=0;i<2;i++){
      vec3 direction,power;spotSample(i,at,direction,power);
      float nl=max(dot(n,direction),0.);
      color+=albedo*power*nl/3.14159;
      if(timber)color+=power*woodSpecular(n,direction,normalize(eye-at),grain,roughness)*nl;
    }
    // Black-background mode already uses an inspection key for smoke. Let
    // that key reveal the source too; the dark room still has fire-only light.
    color+=inspectionLight*albedo*.20*max(dot(n,normalize(vec3(-.5,1.,1.5))),0.);
    return true;
  }
`;
