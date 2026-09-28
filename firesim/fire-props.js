/* Small analytic source props, lit by the live fire clusters. No model assets
 * or baked lighting. These are visual receivers, not fluid collision meshes. */
window.FireProps = `
  uniform int visibleEmitter;
  uniform float inspectionLight;
  uniform vec2 sourcePosition;
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
    if(visibleEmitter!=1&&visibleEmitter!=2)return false;
    vec3 c=vec3(-7.+sourcePosition.x*14.,-1.05+sourcePosition.y*7.875,0.);
    vec3 n=vec3(0);float hit=distance;
    if(visibleEmitter==1){
      capsuleHit(eye,ray,c+vec3(-.95,-.17,-.34),c+vec3(.95,-.17,.34),.18,hit,n);
      capsuleHit(eye,ray,c+vec3(-.90,-.17,.37),c+vec3(.90,-.17,-.37),.18,hit,n);
      capsuleHit(eye,ray,c+vec3(-.65,.05,-.42),c+vec3(.65,.05,.42),.16,hit,n);
    } else {
      capsuleHit(eye,ray,c+vec3(0,-.85,0),c+vec3(0,-.18,0),.095,hit,n);
      capsuleHit(eye,ray,c+vec3(0,-.24,0),c+vec3(0,-.06,0),.19,hit,n);
    }
    if(hit>=distance)return false;
    distance=hit;vec3 at=eye+ray*hit;
    vec3 albedo=visibleEmitter==1?vec3(.14,.065,.025):vec3(.23,.24,.26);
    if(visibleEmitter==1){
      float grain=sin(at.z*65.+at.y*43.+sin(at.x*3.)*.7);
      albedo*=.45+.55*smoothstep(-.5,.8,grain);
    }
    for(int i=0;i<32;i++){
      vec3 light,power;roomLight(i,light,power);vec3 d=light-at;float r2=max(dot(d,d),.001);
      color+=albedo*power*max(dot(n,d*inversesqrt(r2)),0.)/(r2+.12);
    }
    color+=albedo*ambientLight*(.25+.75*max(n.y,0.))/3.14159;
    for(int i=0;i<2;i++){
      vec3 direction,power;spotSample(i,at,direction,power);
      color+=albedo*power*max(dot(n,direction),0.)/3.14159;
    }
    // Black-background mode already uses an inspection key for smoke. Let
    // that key reveal the source too; the dark room still has fire-only light.
    color+=inspectionLight*albedo*.20*max(dot(n,normalize(vec3(-.5,1.,1.5))),0.);
    return true;
  }
`;
