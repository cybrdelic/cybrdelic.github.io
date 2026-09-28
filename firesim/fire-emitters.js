/* Analytic fuel emitters. Shapes only inject gas; they never mask the rendered
 * flame. Burst age is simulation time, so pausing also pauses the explosion. */
window.FireEmitters = `
  uniform int emitterKind;
  uniform float burstAge;
  uniform vec3 fuelProfile; // feed, soot yield, jet speed
  void emitter(vec2 local,float depth,out float density,out vec3 jet){
    density=0.;jet=vec3(0);
    if(emitterKind==6){
      // One irregular finite charge. Expansion is solved from combustion in
      // the pressure pass; there are no moving spherical emission pockets.
      if(burstAge<0. || burstAge>.10 || any(greaterThan(abs(local),vec2(.95))))return;
      vec3 q=vec3(local,depth);
      vec2 seed=vec2(clock-burstAge)*vec2(.137,.231);
      vec3 n=texture(noiseTex,local*.25+depth*vec2(.19,-.11)+seed).rgb;
      vec3 m=texture(noiseTex,local*.7+depth*vec2(-.31,.23)+seed+vec2(.13,.61)).rgb;
      float irregular=.65+1.4*(n.r-.5)+.35*(m.g-.5);
      float radius=length(q/vec3(1.,.9,.8));
      float body=1.-smoothstep(irregular-.12,irregular+.06,radius);
      density=body*mix(.12,1.4,smoothstep(.22,.72,n.g))*4.*(1.-smoothstep(.04,.10,burstAge));
      jet=(normalize(q+vec3(.0001))*mix(3.,18.,smoothstep(.28,.72,m.r))+cross(vec3(.3,.8,.5),q)*8.+(n-m)*vec3(5.,5.,2.)+vec3(0,2.,0))*fuelProfile.z;
      return;
    }
    // Conservative support bounds avoid evaluating jets in millions of empty
    // cells. Bounds include every point inside the r² < 12 injection cutoff.
    vec2 bounds=emitterKind==1?vec2(3.30,.66):emitterKind==2?vec2(.70,.42)
      :emitterKind==3?vec2(1.86):emitterKind==4?vec2(1.08)
      :emitterKind==5?vec2(3.60,.53):emitterKind==6?vec2(3.76,3.18):vec2(1.46,.63);
    if(any(greaterThan(abs(local),bounds)))return;
    float shear=4.8*sin(depth*19.+clock*13.)*cos((local.x+local.y)*12.-clock*11.);
    float center=.16*sin(clock*7.3)+local.x*.48*sin(clock*9.1);
    float r2=dot(local/vec2(.42,.18),local/vec2(.42,.18))+pow((depth-center)/.15,2.);
    jet=vec3(shear*.35,2.8+shear*.30,sin(local.x*23.+local.y*19.+clock*13.)*1.1);
    if(emitterKind==1){ // Three separated tongues above the crossed logs.
      float pocket=floor(clamp(local.x/.60+1.5,0.,2.99))-1.;
      r2=pow((local.x-pocket*.60)/.27,2.)+pow((local.y-.18)/.13,2.)+pow((depth-pocket*.18)/.26,2.);
      jet=vec3(shear*.19,.8+shear*.15,sin(local.x*12.+clock*8.)*.45);
    } else if(emitterKind==2){ // A narrow, fast torch jet.
      // Gas exits a thin opening instead of a spherical glowing reservoir.
      r2=pow(local.x/.16,2.)+pow((local.y-.06)/.045,2.)+pow(depth/.15,2.);
      vec2 eddy=texture(noiseTex,vec2(local.x*1.7+depth*.8+clock*.13,local.y*.8-clock*.22)).rg;
      float speed=fuelProfile.y<.5?5.8:2.8;
      jet=vec3((eddy.r-.5)*9.,speed*(.7+.6*eddy.g),(eddy.g-.5)*4.);
    } else if(emitterKind==3){ // Upright ring with real depth.
      r2=pow((length(local)-1.30)/.11,2.)+pow((depth-.08*sin(clock*3.+local.y*5.))/.16,2.);
      vec2 radial=normalize(local+vec2(.0001));
      jet=vec3(-radial.y*1.8+radial.x*.55+shear*.08,radial.x*1.8+radial.y*.55,sin(clock*9.+local.x*8.)*.4);
    } else if(emitterKind==4){ // Spherical shell, not a disk facing the camera.
      vec3 q=vec3(local,depth);
      float surface=.51+.045*sin(q.x*12.+clock*6.)*sin(q.y*10.-q.z*9.-clock*5.);
      r2=pow((length(q)-surface)/.08,2.);
      jet=cross(vec3(.8,.5,1.2),q)*2.+q*.25+vec3(shear*.25,0,0);
    } else if(emitterKind==5){ // Broad line of fuel, forming a fire wall.
      r2=pow(max(abs(local.x)-3.0,0.)/.17,2.)+pow(local.y/.15,2.)+pow((depth-.12*sin(local.x*4.+clock*3.))/.20,2.);
      jet=vec3(shear*.12,5.5+sin(local.x*5.+clock*4.)*1.3,sin(local.x*7.+clock*11.)*.6);
    }
    if(r2>12.)return;
    float feed=.62+.38*sin(local.x*18.+depth*23.+clock*11.)*sin(local.x*9.-depth*17.-clock*7.3);
    if(emitterKind==1||emitterKind==2||emitterKind==5){
      float variation=texture(noiseTex,local*vec2(.8,1.3)+depth*vec2(.5,-.3)+clock*vec2(.14,-.19)).b;
      feed=mix(.35,1.1,smoothstep(.2,.8,variation));
    }
    density=exp(-1.5*r2)*feed;
    if(emitterKind==1)density*=.85;
    if(emitterKind==2)density*=4.4;
    if(emitterKind==3)density*=.65;
    if(emitterKind==4)density*=.30*feed;
    jet*=fuelProfile.z;
  }
`;
