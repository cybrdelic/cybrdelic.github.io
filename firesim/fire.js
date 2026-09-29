import {runtimeScope} from './runtime-scope.js?v=95fcf488354ba45d';
import {legacyProbe} from './legacy-qa.js?v=95fcf488354ba45d';
import {FIRE_PRESETS} from './pyro-gpu/presets.js?v=95fcf488354ba45d';
import {FIRE_COLORS} from './pyro-gpu/fire-colors.js?v=95fcf488354ba45d';
import {emitterKindFor} from './original-source-profile.js?v=95fcf488354ba45d';
export async function mountLegacy({initialPreset='sigil',onRemount,onFailure=()=>{}}={}){
  const scope=runtimeScope(onFailure),on=scope.on;
  const qaParams=new URL(location.href).searchParams,qaCaptureStop=qaParams.has('qa')?Number(qaParams.get('capture'))||0:0;
  'use strict';
  // The source texture is static emitter geometry, not footage or baked motion.
  // Every visible frame is generated from the evolving GPU state below.
  const domain=window.FireDomain;
  const [WX,WY,WZ]=domain.extent;
  const [MINX,MINY]=domain.minimum;
  const NX=domain.nx, NZ=domain.ny, DEPTH=domain.depth, TILES_X=8, TILES_Y=DEPTH/8;
  const SOURCE_NX = 896, SOURCE_NZ = 504;
  const RW = 896, RH = 504;
  const AW = NX * TILES_X, AH = NZ * TILES_Y;
  const STEP = 1 / 30, DURATION = 9.8;
  let stateRevision=0, roomLightRevision=-1, smokeLightRevision=-1, propLightRevision=-1;
  let lightingRevision=-1;
  let turbulenceTexture;
  let objectTexture,emptyObjectTexture;
  const objectModels=new Map();
  const canvas = document.querySelector('#fire');
  const view = document.querySelector('#view');
  const message = document.querySelector('#message');
  const metrics = document.querySelector('#metrics');
  const help = document.querySelector('#help');
  const restartButton = document.querySelector('#restart');
  const extinguishButton = document.querySelector('#extinguish');
  const roomToggle = document.querySelector('#room');
  const orbitControl = document.querySelector('#orbit');
  const zoomControl = document.querySelector('#zoom');
  const focusButton = document.querySelector('#focus-fire');
  const fullscreenButton = document.querySelector('#fullscreen');
  const smokeControl = document.querySelector('#smoke-only');
  const colorControl = document.querySelector('#flame-color');
  const fireLightControl = document.querySelector('#fire-light');
  const benchmarkButton = document.querySelector('#benchmark');
  let inspectSmoke=false,flameColor='natural',fireLight=24,measurement=null;
  const markAppearance=()=>{roomLightRevision=-1;propLightRevision=-1;needsDraw=true;};
  colorControl.replaceChildren(...FIRE_COLORS.map(c=>new Option(c.name,c.id)));
  colorControl.onchange=()=>{flameColor=colorControl.value;markAppearance();};
  smokeControl.onchange=()=>{inspectSmoke=smokeControl.checked;needsDraw=true;};
  smokeControl.title='Hide visible flame while keeping combustion, smoke and fire illumination running.';
  const setFireLight=value=>{
    fireLight=Math.max(0,Math.min(80,Number(value)||0));
    fireLightControl.value=fireLight;
    document.querySelector('#fire-light-value').value=fireLight.toFixed(0);
    markAppearance();
  };
  fireLightControl.oninput=()=>setFireLight(fireLightControl.value);
  benchmarkButton.onclick=()=>{
    if(paused){document.querySelector('#gpu-status').textContent='Resume the simulation before measuring.';return;}
    measurement={start:performance.now(),last:null,intervals:[],steps:0};
    benchmarkButton.disabled=true;
    document.querySelector('#gpu-status').textContent='Measuring 180 rendered frames…';
  };
  const cancelMeasurement=()=>{
    if(!measurement)return;
    measurement=null;benchmarkButton.disabled=false;
    document.querySelector('#gpu-status').textContent='Measurement stopped while the scene was hidden.';
  };
  on(document,'visibilitychange',()=>{if(document.hidden)cancelMeasurement();});
  let viewZoom=1, panX=0, panY=0, panTool=false, panGesture=null;
  const lensTan=()=>.3443276133/viewZoom;
  let roomEnabled = new URL(location.href).searchParams.get('room') !== '0';
  let viewAngle = Number(new URL(location.href).searchParams.get('angle') ?? 16);
  orbitControl.min=-30;orbitControl.max=30;
  viewAngle = Number.isFinite(viewAngle) ? Math.max(-30,Math.min(30,viewAngle)) : 16;
  roomToggle.checked = roomEnabled; orbitControl.value = viewAngle; orbitControl.disabled = !roomEnabled;
  const sceneLabel=document.querySelector('.stamp strong');
  sceneLabel.textContent=roomEnabled?'Fire-lit room · etched stone':'Fire and smoke · black background';
  function camera() {
    const yaw=viewAngle*Math.PI/180;
    const eye=[panX+Math.sin(yaw)*13,3.5+panY,Math.cos(yaw)*13];
    const normalize=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const forward=normalize([panX-eye[0],2.4+panY-eye[1],-eye[2]]);
    const right=normalize(cross(forward,[0,1,0]));
    return {eye,forward,right,up:cross(right,forward)};
  }
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) { await scope.stop(); throw new Error('WebGL 2 is unavailable in this browser session. Reload or reopen the browser.'); }
  if (!gl.getExtension('EXT_color_buffer_float')) { await scope.stop(); gl.getExtension('WEBGL_lose_context')?.loseContext(); throw new Error('Floating point GPU targets are unavailable in this browser.'); }
  const probe=legacyProbe(gl);
  gl.getExtension('OES_texture_float_linear');

  const vertex = `#version 300 es
  precision highp float;
  out vec2 uv;
  void main(){
    vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2);
    uv=p;
    gl_Position=vec4(p*2.0-1.0,0.0,1.0);
  }`;
  const shared = `
  precision highp float;
  precision highp sampler2D;
  in vec2 uv;
  uniform sampler2D vfTex;
  uniform sampler2D chemTex;
  uniform sampler2D noiseTex;
  uniform highp sampler3D turbulenceTex;
  vec3 curlNoise(vec3 q,float scale){
    vec3 p=q/(scale*64.);float h=1./64.;
    vec3 dx=texture(turbulenceTex,p+vec3(h,0,0)).rgb-texture(turbulenceTex,p-vec3(h,0,0)).rgb;
    vec3 dy=texture(turbulenceTex,p+vec3(0,h,0)).rgb-texture(turbulenceTex,p-vec3(0,h,0)).rgb;
    vec3 dz=texture(turbulenceTex,p+vec3(0,0,h)).rgb-texture(turbulenceTex,p-vec3(0,0,h)).rgb;
    return vec3(dy.z-dz.y,dz.x-dx.z,dx.y-dy.x)/(2.*scale);
  }
  uniform float clock;
  const vec3 simExtent=${domain.extentGLSL};
  const vec3 simMin=${domain.minimumGLSL};
  const float NXf=${NX}.0, NZf=${NZ}.0;
  const float DEPTHf=${DEPTH}.0;
  const vec2 atlasSize=vec2(${AW}.0,${AH}.0);
  vec2 atlasUV(vec2 p,float layer){
    p=clamp(p,vec2(.5/NXf,.5/NZf),vec2(1.0-.5/NXf,1.0-.5/NZf));
    float tx=mod(layer,${TILES_X}.0), ty=floor(layer/${TILES_X}.0);
    return (vec2(tx*NXf,ty*NZf)+p*vec2(NXf,NZf))/atlasSize;
  }
  vec4 field(sampler2D tex,vec3 p){
    p=clamp(p,vec3(0.0),vec3(1.0));
    float z=p.z*(DEPTHf-1.0), lo=floor(z), hi=min(DEPTHf-1.0,lo+1.0);
    return mix(texture(tex,atlasUV(p.xy,lo)),texture(tex,atlasUV(p.xy,hi)),fract(z));
  }
  vec4 layer(sampler2D tex,vec2 p,float z){ return texture(tex,atlasUV(p,z)); }
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  `;
  const simulation = () => `#version 300 es
  ${shared}
  ${pressure.samplingGLSL}
  ${vorticity.samplingGLSL}
  uniform sampler2D sourceTex;
  uniform sampler2D widthTex;
  uniform float delta;
  uniform vec2 pointer;
  uniform vec2 pointerMotion;
  uniform float pointerStrength;
  uniform vec2 brushFrom;
  uniform vec2 brushTo;
  uniform float brushActive;
  uniform float sourceEnabled;
  uniform float smokeOnly;
  uniform float presetBuoyancy;
  uniform float sourceHeat;
  uniform float coolingScale;
  ${window.FireEmitters}
  ${advection.correctionGLSL}
  layout(location=0) out vec4 outVF;
  layout(location=1) out vec4 outChem;
  void main(){
    ivec2 ip=ivec2(gl_FragCoord.xy);
    float slice=float(ip.x/${NX}+${TILES_X}*(ip.y/${NZ}));
    vec2 p=(vec2(ip.x%${NX},ip.y%${NZ})+.5)/vec2(NXf,NZf);
    float depth=slice/(DEPTHf-1.0);
    vec3 at=vec3(p,depth);
    vec4 oldVF=texelFetch(vfTex,ip,0);
    oldVF.xyz+=samplePressureCorrection(at);
    vec3 back=at-vec3(oldVF.xy,oldVF.z)*delta;
    vec4 vf=field(vfTex,back);
    vf.xyz+=samplePressureCorrection(back);
    vec4 scalars=maccormackScalars(at,back,oldVF.xyz,sourceEnabled<.5&&emitterKind>0);
    float fuel=scalars.r;
    float oxygen=scalars.g;
    float temp=scalars.b, soot=scalars.a;
    if(temp+soot>.00001) vf.xyz+=vortexForce(at)*delta*(sourceEnabled<.5&&emitterKind==6?2.2:1.);
    // The source field enters as fresh gas. It never clips existing fire to glyph edges.
    float worldX=simMin.x+p.x*simExtent.x, worldZ=simMin.y+p.y*simExtent.y, worldY=(depth-.5)*simExtent.z;
    float support=0.0, sheet=0.0;
    if(sourceEnabled>.5) {
    vec4 source=texture(sourceTex,p);
    support=source.r;
    // Most atlas cells have no emitter. Preserve their air entrainment while
    // avoiding the ignition, thickness, pulse and jet calculations entirely.
    if(support>0.) {
    float age=clock-source.g*10.0;
    float opened=smoothstep(-.055,.04,age);
    float leading=exp(-pow((age-.08)/.105,2.0));
    float valve=exp(-3.2*max(0.0,clock-6.8));
    float corr=.22*sin(worldX*3.1+worldZ*3.7-clock*2.4)+.085*sin(worldX*9.0-worldZ*7.0+clock*4.3);
    float halfwidth=texture(widthTex,p).r*.27;
    float sheetDepth=.065+.045*sqrt(clamp(halfwidth/.27,0.0,1.0));
    sheet=exp(-1.5*pow((worldY-corr)/max(.035,sheetDepth),2.0))*support;
    // Turbulent ambient air meets rising fuel away from the thin source sheet.
    // The sheet itself remains fuel rich, so it cannot become a solid bright mask.
    float entrainment=(.05+.8*clamp(temp,0.0,1.0))*(1.0-clamp(sheet,0.0,1.0));
    oxygen=mix(oxygen,1.0,1.0-exp(-delta*entrainment));
    float front=clamp(sheet*leading*delta*19.0,0.0,1.0);
    float pulse=texture(noiseTex,p*vec2(3.0,2.0)+vec2(clock*.04,-clock*.08)).r;
    float puff=mix(.75,1.25,smoothstep(.35,.65,pulse));
    float sustained=clamp(sheet*opened*valve*delta*2.5*puff,0.0,1.0);
    float inject=clamp(front+sustained,0.0,1.0);
    fuel=mix(fuel,.55,sustained);
    fuel=mix(fuel,.95,front);
    oxygen*=1.0-inject;
    temp=mix(temp,.5,sustained);
    temp=mix(temp,1.25,front);
    vec2 tangent=normalize(source.ba*2.0-1.0+vec2(.0001));
    float speed=.25+7.75*leading;
    float shear=4.8*sin(worldY*19.0+clock*13.0)*cos((worldX+worldZ)*12.0-clock*11.0)*leading;
    vf.x=mix(vf.x,(tangent.x*speed-tangent.y*shear)/simExtent.x,inject);
    vf.y=mix(vf.y,(tangent.y*speed+tangent.x*shear)/simExtent.y,inject);
    vf.z=mix(vf.z,(.18+sin(worldX*38.0+worldZ*27.0+clock*23.0)*(.12+.68*leading))/simExtent.z,inject);
    vf.y+=sheet*leading*sin(worldY*18.0+clock*15.0)*20.0*delta/simExtent.y;
    vf.z+=sheet*leading*cos(worldZ*14.0-clock*12.0)*16.0*delta/simExtent.z;
    } else {
      oxygen=mix(oxygen,1.0,1.0-exp(-delta*(.05+.8*clamp(temp,0.0,1.0))));
    }
    } else {
    if(emitterKind!=6)oxygen=mix(oxygen,1.0,1.0-exp(-delta*(.05+.8*clamp(temp,0.0,1.0))));
    else if(fuel+temp+soot>.001){
      // Mixing comes from adjacent gas, not oxygen created throughout a fuel
      // cloud. A bounded diffusion step lets air reach the wrinkled interface.
      vec3 h=vec3(1./NXf,1./NZf,1./(DEPTHf-1.));
      vec4 neighbors=(field(chemTex,back+vec3(h.x,0,0))+field(chemTex,back-vec3(h.x,0,0))
        +field(chemTex,back+vec3(0,h.y,0))+field(chemTex,back-vec3(0,h.y,0))
        +field(chemTex,back+vec3(0,0,h.z))+field(chemTex,back-vec3(0,0,h.z)))/6.;
      float mixing=1.-exp(-delta*5.);
      fuel=mix(fuel,neighbors.r,mixing);oxygen=mix(oxygen,neighbors.g,mixing);
      temp=mix(temp,neighbors.b,mixing*.5);soot=mix(soot,neighbors.a,mixing*.5);
    }
    if(brushActive>.5 && (emitterKind!=6 || burstAge<.10)) {

    // A click creates a new fuel source in the same simulated volume. During a
    // drag the source fills the segment between consecutive simulation steps.
    vec2 start=simMin.xy+brushFrom*simExtent.xy;
    vec2 end=simMin.xy+brushTo*simExtent.xy;
    vec2 path=end-start;
    vec2 here=vec2(worldX,worldZ);
    float along=clamp(dot(here-start,path)/max(dot(path,path),.00001),0.0,1.0);
    vec2 local=here-(start+path*along);
    float brush; vec3 jet;
    emitter(local,worldY,brush,jet);
    if(brush>.000001) {
    if(emitterKind==6){
      float inject=1.-exp(-brush*delta*9.*fuelProfile.x);
      vec3 mixField=texture(noiseTex,local*.42+worldY*vec2(.31,-.22)+vec2(.17,.38)).rgb;
      fuel=mix(fuel,smokeOnly>.5?0.:mix(.45,.95,smoothstep(.28,.68,mixField.r)),inject);
      oxygen=mix(oxygen,mix(.035,.5,smoothstep(.28,.7,mixField.b)),inject);
      temp=mix(temp,smokeOnly>.5?.08:mix(.5,1.65,smoothstep(.28,.72,mixField.g))*sourceHeat,inject);
      soot=mix(soot,(smokeOnly>.5?.75:.035)*fuelProfile.y,inject);
      vf.xyz=mix(vf.xyz,jet/simExtent,inject);
    }else{
    float gasFeed=brush*(1.0-exp(-1.8*delta))*fuelProfile.x;
    float pulse=.72+.28*sin(clock*47.0);
    if(emitterKind==1||emitterKind==2||emitterKind==5)pulse=mix(.72,1.08,texture(noiseTex,vec2(clock*.27+.13,clock*.07+.7)).r);
    float nozzle=clamp(brush*delta*20.0*pulse*fuelProfile.x,0.0,1.0);
    fuel=mix(fuel,smokeOnly>.5?0.:.22,gasFeed);
    oxygen=mix(oxygen,.80,gasFeed);
    temp=mix(temp,smokeOnly>.5?.06:.80*sourceHeat,gasFeed);
    fuel=mix(fuel,smokeOnly>.5?0.:emitterKind==2?.42:.95,nozzle);
    if(emitterKind==2)oxygen=mix(oxygen,.8,nozzle);
    else oxygen*=1.0-nozzle;
    temp=mix(temp,smokeOnly>.5?.06:(emitterKind==2?.50:.85)*sourceHeat,nozzle);
    if(smokeOnly>.5)soot=mix(soot,.8*fuelProfile.y,nozzle);
    jet/=simExtent;
    jet.xy+=clamp(pointerMotion*.12,vec2(-.24),vec2(.24));
    vf.xyz=mix(vf.xyz,jet,nozzle);
    }
    }
    }
    }

    // Ambient cells retain transported/projected velocity, but need no
    // combustion, turbulence or buoyancy work. Test after source injection so
    // ignition is never skipped, and retain oxygen deficits until they mix out.
    if(fuel+temp+soot<=.00001 && oxygen>=.99999){
      vf.xyz*=exp(-delta*.30);
      if(worldZ<.10)vf.y=max(vf.y,0.);
      outVF=vec4(clamp(vf.xyz,vec3(-1.),vec3(1.)),0.);
      outChem=vec4(0.,1.,0.,0.);
      return;
    }
    float activation=smokeOnly>.5?0.:sourceEnabled<.5&&emitterKind==6?smoothstep(.65,1.05,temp):sourceEnabled<.5&&emitterKind==2?clamp((temp-.25)/.24,0.,1.):clamp((temp-.15)/.22,0.,1.);
    // Dilute transported remnants should extinguish instead of lighting up
    // long sub-voxel trails. Apply the smooth mixing limit in combustion.
    if(sourceEnabled<.5&&emitterKind==2)activation*=smoothstep(.015,.07,fuel)*smoothstep(.025,.12,oxygen);
    float burn=min(fuel,oxygen*.7)*(1.0-exp(-(sourceEnabled<.5&&emitterKind==6?5.5:8.0)*delta))*activation;
    fuel=max(0.0,fuel-burn);
    oxygen=clamp(oxygen-burn/.7,0.0,1.0);
    float cooling=sourceEnabled>.5?1.15:emitterKind==1?2.2:emitterKind==2?2.5:emitterKind==3||emitterKind==4?3.2:emitterKind==6?.72:1.15;
    temp=min(3.0,(temp+burn*5.5)*exp(-cooling*coolingScale*delta));
    // Soot travels with the same corrected flow as heat and fuel. Fuel-rich
    // burning produces more soot; hot oxygen oxidizes it. Cold smoke survives
    // cooling, rather than disappearing with the flame's temperature.
    float fuelBed=sourceEnabled<.5&&emitterKind==1?1.:0.;
    float sootYield=mix(.45,1.55,1.0-oxygen)*fuelProfile.y*mix(1.,.75,fuelBed);
    soot+=burn*sootYield;
    float oxidized=soot*(1.0-exp(-1.2*oxygen*smoothstep(.7,1.8,temp)*delta));
    oxidized=min(oxidized,oxygen/.08);
    soot=clamp((soot-oxidized)*exp(-mix(.055,.22,fuelBed)*delta),0.0,8.0);
    oxygen=max(0.0,oxygen-oxidized*.08);
    temp=min(3.0,temp+oxidized*.3);

    // Buoyancy, resolved swirl and an interactive force all modify the live state.
    float n1=texture(noiseTex,p*vec2(1.6,1.2)+vec2(clock*.037,depth*.41)).r;
    // Reuse the second noise lookup for a finer, depth-varying velocity field.
    // It folds the transported heat/reaction fronts instead of drawing detail
    // on top of the final image or adding another full-screen sample pass.
    vec2 fineNoise=textureLod(noiseTex,p*vec2(7.6,6.2)+vec2(-clock*.12,depth*1.37),1.5).rg;
    float n2=fineNoise.g;
    float curl=(n1-n2)*(.035+.13*temp);
    vf.x+=curl*delta*(sourceEnabled<.5&&emitterKind==2?.8:5.0);
    if(emitterKind!=6 && smokeOnly<.5 && temp>.2){
      vec2 fineFlow=vec2(fineNoise.r-.5,.5-fineNoise.g);
      vf.xy+=fineFlow*delta*smoothstep(.2,1.2,temp)*vec2(3.2,2.4)/simExtent.xy;
    }
    float buoyancy=sourceEnabled>.5?6.5:emitterKind==1?3.2*sourceLift:emitterKind==2?3.:emitterKind==3||emitterKind==4?.35:emitterKind>=7?presetBuoyancy:6.5;
    if(sourceEnabled<.5 && emitterKind==6)buoyancy=mix(.3,3.6,smoothstep(.2,1.2,burstAge));
    vf.y+=(temp*buoyancy-soot*.32)*delta/simExtent.y;
    if(sourceEnabled<.5 && emitterKind==6 && temp>.18){
      // Resolved 3D curl accelerates gas at two smaller scales. Its signal is
      // sampled only by simulation; lighting has no noise or texture overlay.
      vec3 q=vec3(worldX,worldZ-clock*.8,worldY)+vec3(clock*.21,0,-clock*.17);
      vec3 eddy=curlNoise(q,.23)*9.+curlNoise(q+vec3(3.4,1.1,5.7),.11)*2.;
      float energy=smoothstep(.18,.75,temp)*exp(-max(burstAge,0.)*.4);
      vf.xyz+=eddy*energy*delta/simExtent;
    }
    // Sculpted fire uses a circulating force field, not a screen-space mask.
    // Fuel, heat and soot still advect and cool through the same solver.
    if(sourceEnabled<.5 && (emitterKind==3||emitterKind==4) && temp+soot+fuel>.00001){
      vec2 center=simMin.xy+brushTo*simExtent.xy;
      vec2 q=vec2(worldX,worldZ)-center;float radius=length(q);
      float influence=emitterKind==3?exp(-pow((radius-1.30)/.45,2.)):exp(-pow(radius/.95,4.));
      vec2 tangent=vec2(-q.y,q.x)/max(radius,.05);
      vec2 target=tangent*(emitterKind==3?1.8:1.2)+q*.18;
      if(emitterKind==3)vf.xy=mix(vf.xy,target/simExtent.xy,1.-exp(-delta*5.*influence));
      else {
        vec3 q3=vec3(q,worldY);float r=length(q3);
        float weight=exp(-pow(r/1.4,4.));
        vec3 circulating=cross(vec3(.8,.5,1.2),q3)*2.-q3*max(r-.60,0.)*8.;
        vf.xyz=mix(vf.xyz,circulating/simExtent,1.-exp(-delta*12.*weight));
      }
    }
    float waveX=worldX*4.7+clock*2.4+(n1-.5)*3.0;
    float waveZ=worldZ*5.3-clock*1.8+(n2-.5)*3.0;
    float swirl=(.05+.35*clamp(temp,0.0,2.0))*delta*(1.0-.7*support)
                 *mix(.15,1.0,sourceEnabled);
    if(sourceEnabled<.5&&emitterKind==2)swirl*=.15;
    vf.x+=sin(waveX)*cos(waveZ)*swirl;
    vf.y-=cos(waveX)*sin(waveZ)*swirl;
    // Depth shear belongs to the evolving velocity, never the display shader.
    vf.z+=(sin(worldX*3.7+worldZ*4.3+clock*2.1)*(n2-.5))
          *delta*(.15+.55*clamp(temp+soot,0.,1.))/simExtent.z;
    vec2 distance=p-pointer;
    float falloff=exp(-dot(distance,distance)/(pointerStrength>.5?.005:.0025));
    vf.xy+=pointerStrength*falloff*(pointerMotion*.055+normalize(distance+vec2(.0001))*.075)*delta*24.0;
    vf.xyz*=exp(-delta*.30);
    // Free gas leaves the finite domain instead of sticking to its boundary.
    float edge=smoothstep(0.0,.055,p.x)*smoothstep(0.0,.055,1.0-p.x)
              *smoothstep(0.0,.07,p.y)*smoothstep(0.0,.05,1.0-p.y);
    float depthEdge=smoothstep(0.,.055,depth)*smoothstep(0.,.055,1.-depth);
    edge*=depthEdge;
    fuel*=edge; temp*=edge; soot*=edge;
    // A no-through-flow floor keeps cursor flames attached to the room.
    if(worldZ<0.){fuel=0.;temp=0.;soot=0.;burn=0.;oxygen=1.;vf.y=max(vf.y,0.);}
    else if(worldZ<.10) vf.y=max(vf.y,0.);
    oxygen=mix(1.0,oxygen,edge);
    // Keep transported scalars together: the limiter reads one RGBA texel per
    // corner. Reaction is recomputed here, so it shares velocity's spare lane.
    outVF=vec4(clamp(vf.xyz,vec3(-1.0),vec3(1.0)),burn/max(delta,.0001));
    outChem=vec4(fuel,oxygen,temp,soot);
  }`;
  const rendering = () => `#version 300 es
  ${shared}
  ${room.surfaceGLSL}
  ${window.FireProps}
  uniform sampler2D smokeLightTex;
  uniform float roomEnabled;
  uniform float customLighting;
  uniform float viewZoom;
  uniform vec2 viewPan;
  uniform float inspectSmoke;
  layout(location=0) out vec4 outColor;
  vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
  void main(){
    vec2 screenWorld=(uv-.5)*vec2(14.,7.875)/viewZoom+vec2(0,2.8875)+viewPan;
    vec2 p=(screenWorld-fireMin.xy)/fireExtent.xy;
    if(roomEnabled<.5 && (any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))){outColor=vec4(0,0,0,1);return;}
    vec3 light=vec3(0.0);
    float transmittance=1.0;
    vec3 ray=roomEnabled>.5?roomRay(uv):vec3(0,0,-1),surfaceNormal=vec3(0);
    vec3 eye=roomEnabled>.5?cameraEye:vec3(fireMin.xy+p*fireExtent.xy,3.);
    float surfaceDistance=1000.;
    vec3 surface=vec3(0);
    if(roomEnabled>.5){
      surfaceDistance=roomHit(cameraEye,ray,surfaceNormal);
      surface=roomSurface(cameraEye+ray*surfaceDistance,surfaceNormal,-ray);
    }
    vec3 propColor;
    if(sourceProp(eye,ray,surfaceDistance,propColor))surface=propColor;
    // Sample every simulated depth layer along the camera ray. The volume has
    // actual parallax; no screen-space billboard or rendered fire plane is used.
    bool fineDepth=visibleEmitter==4||visibleEmitter==6;
    int sampleCount=fineDepth?${DEPTH*2}:${DEPTH};
    for(int i=0;i<${DEPTH*2};i++){
      if(i>=sampleCount)break;
      float z=fineDepth?(float(i)+.5)/float(sampleCount)*float(${DEPTH-1}):float(i);
      z=float(${DEPTH-1})-z;
      float worldDepth=fireMin.z+z/float(${DEPTH-1})*fireExtent.z;
      float distance=(worldDepth-eye.z)/ray.z;
      if(distance<0. || distance>=surfaceDistance)continue;
      if(roomEnabled>.5){
        vec3 at=eye+ray*distance;
        p=(at.xy-fireMin.xy)/fireExtent.xy;
        if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1)))) continue;
      }
      vec4 c=fineDepth?field(chemTex,vec3(p,z/float(${DEPTH-1}))):layer(chemTex,p,z);
      float temp=c.b, soot=c.a;
      if(temp<=0.0 && soot<=0.0) continue;
      float reaction=fineDepth?field(vfTex,vec3(p,z/float(${DEPTH-1}))).a:layer(vfTex,p,z).a;
      // Reacting gas absorbs as well as emits. A nearly transparent flame
      // stacks dozens of bright layers into one pale sheet and hides gaps.
      float sigma=clamp(sootExtinction(soot)+(1.-inspectSmoke)*reaction*(visibleEmitter==1?.42:.025),0.0,24.0);
      vec3 emission=(1.-inspectSmoke)*(fireEmission(reaction,temp)+sootEmission(soot,temp));
      float stepLength=fireExtent.z/float(sampleCount)/(roomEnabled>.5?max(-ray.z,.1):1.);
      float opacity=1.0-exp(-sigma*stepLength);
      // Light is attenuated by the advected soot above this point. This gives
      // cold smoke volume and self-shadowing without a procedural overlay.
      vec3 scatter;
      if(roomEnabled>.5||customLighting>.5) scatter=smokeIrradiance(vec3(p,z/float(${DEPTH-1})));
      else {
        float lo=floor(z),hi=min(lo+1.,float(${DEPTH-1}));
        vec2 lp=clamp(p,vec2(.5/128.0,.5/72.0),vec2(1.0-.5/128.0,1.0-.5/72.0));
        vec2 lightUV=(vec2(mod(lo,8.0),floor(lo/8.0))+lp)/vec2(8.0,${TILES_Y}.0);
        vec2 lightHi=(vec2(mod(hi,8.0),floor(hi/8.0))+lp)/vec2(8.0,${TILES_Y}.0);
        float key=exp(-mix(texture(smokeLightTex,lightUV).r,texture(smokeLightTex,lightHi).r,fract(z)));
        scatter=vec3(.020,.019,.025)+vec3(1.4,1.10,.85)*key;
      }
      // A modest scattering albedo gives soot illuminated rims while its
      // extinction still silhouettes the dense core against the room.
      float scattering=(roomEnabled>.5||customLighting>.5)?sootExtinction(soot)*(domainBlast>.5?.018:mix(.14,.025,smoothstep(.3,.95,temp))):soot*4.4*.42/12.56637;
      light+=transmittance*(emission+scattering*scatter)*opacity/max(sigma,.0001);
      transmittance*=1.0-opacity;
    }
    outColor=vec4(light+transmittance*surface,1.0);
  }`;
  const presentation = `#version 300 es
  precision highp float;
  in vec2 uv;
  uniform sampler2D projection;
  layout(location=0) out vec4 outColor;
  vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
  void main(){
    vec2 stepSize=1.0/vec2(${RW}.0,${RH}.0);
    vec3 linear=texture(projection,uv).rgb;
    vec3 glow=(texture(projection,uv+vec2(stepSize.x*3.0,0.0)).rgb+
               texture(projection,uv-vec2(stepSize.x*3.0,0.0)).rgb+
               texture(projection,uv+vec2(0.0,stepSize.y*3.0)).rgb+
               texture(projection,uv-vec2(0.0,stepSize.y*3.0)).rgb)*.25;
    linear=(linear+max(glow-vec3(1.),vec3(0))*.012)*.60;
    float luminance=dot(linear,vec3(.2126,.7152,.0722));
    vec3 huePreserving=linear*aces(vec3(luminance)).x/max(luminance,.00001);
    vec3 mapped=mix(aces(linear),clamp(huePreserving,0.,1.),.45);
    mapped=mix(mapped*12.92,1.055*pow(mapped,vec3(1.0/2.4))-.055,step(vec3(.0031308),mapped));
    outColor=vec4(mapped,1.0);
  }`;

  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader compile failed');
    return s;
  }
  function program(fragment) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Shader link failed');
    return p;
  }
  // Uniform locations are stable for a linked program. Avoid synchronously
  // looking up twenty locations on every simulation step.
  const locations = new WeakMap();
  function uniform(p, name) {
    let cache=locations.get(p);
    if (!cache) { cache=new Map(); locations.set(p,cache); }
    if (!cache.has(name)) cache.set(name,gl.getUniformLocation(p,name));
    return cache.get(name);
  }
  function texture(width, height, data, filter = gl.LINEAR, internal = gl.RGBA8, format = gl.RGBA, type = gl.UNSIGNED_BYTE) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    return t;
  }
  function target() {
    const filter = halfFloatLinear ? gl.LINEAR : gl.NEAREST;
    const vf = texture(AW, AH, null, filter, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const chem = texture(AW, AH, null, filter, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vf, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, chem, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Floating point simulation framebuffer incomplete');
    return { vf, chem, fbo };
  }
  function projectionTarget() {
    const color = texture(RW, RH, null, gl.LINEAR, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Volume projection framebuffer incomplete');
    return { color, fbo };
  }
  function bind(tex, unit, location) {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(location, unit);
  }
  function reset() {
    stateRevision++;
    elapsed = 0; accumulator = 0;
    needsDraw = true;
    brush.active = false;
    brush.fromX = brush.x; brush.fromY = brush.y;
    pointer.vx = 0; pointer.vy = 0;
    if (!pressure || !targets) return;
    pressure.reset();
    for (const t of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, AW, AH);
      gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
      gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0, 1, 0, 0]));
    }
    current = 0;
  }
  function runStep() {
    const from = targets[current], to = targets[1 - current];
    vorticity.update(from.vf,from.chem,brush,freeMode && emitterKind<3,freeMode && emitterKind===6);
    const predictor = advection.step(from.vf, from.chem, pressure.getCorrection(), STEP);
    gl.useProgram(simProgram); gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo); gl.viewport(0, 0, AW, AH);
    bind(from.vf, 0, uniform(simProgram, 'vfTex'));
    bind(from.chem, 1, uniform(simProgram, 'chemTex'));
    bind(sourceTexture, 2, uniform(simProgram, 'sourceTex'));
    bind(noiseTexture, 3, uniform(simProgram, 'noiseTex'));
    bind(widthTexture, 4, uniform(simProgram, 'widthTex'));
    bind(pressure.getCorrection(), 5, uniform(simProgram, 'pressureCorrectionTex'));
    bind(predictor, 6, uniform(simProgram, 'mcPredictorTex'));
    bind(vorticity.texture, 7, uniform(simProgram, 'vortexTex'));
    gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_3D,objectTexture);gl.uniform1i(uniform(simProgram,'objectTex'),14);
    gl.activeTexture(gl.TEXTURE15);gl.bindTexture(gl.TEXTURE_3D,turbulenceTexture);gl.uniform1i(uniform(simProgram,'turbulenceTex'),15);
    gl.uniform3fv(uniform(simProgram, 'vortexOrigin'), vorticity.origin);
    gl.uniform3fv(uniform(simProgram, 'vortexSpan'), vorticity.span);
    gl.uniform1i(uniform(simProgram,'emitterKind'),emitterKind);
    gl.uniform1f(uniform(simProgram,'burstAge'),elapsed-burstStart);
    const sourceShape=shapeFor(activePreset),profile=sharedPresets.get(activePreset);
    gl.uniform1i(uniform(simProgram,'sourceEffectKind'),profile?.effect[0]??-1);
    gl.uniform1f(uniform(simProgram,'objectVariation'),profile?.ignition==='all'?1:profile?.moisture==='damp'?2:profile?.ignition==='crown'?3:0);
    gl.uniform1f(uniform(simProgram,'burstDuration'),profile?.effect[2]||.10);
    const fuel=fuelProfiles[fuelControl.value];
    gl.uniform3f(uniform(simProgram,'fuelProfile'),fuel[0]*sourceShape[2]*(profile?.chemistry[0]||1),fuel[1]*(profile?.chemistry[2]||1),fuel[2]);
    gl.uniform1f(uniform(simProgram,'sourceScale'),sourceShape[0]);
    gl.uniform1f(uniform(simProgram,'sourceLift'),sourceShape[1]);
    gl.uniform1f(uniform(simProgram,'presetBuoyancy'),(profile?.dynamics[3]||1)*4.);
    gl.uniform1f(uniform(simProgram,'sourceHeat'),profile?.chemistry[1]||1);
    gl.uniform1f(uniform(simProgram,'coolingScale'),1/Math.max(.4,profile?.chemistry[1]||1));
    gl.uniform1f(uniform(simProgram,'smokeOnly'),profile?.smokeSimulation||activePreset==='smoke-burst'?1:0);
    gl.uniform1f(uniform(simProgram, 'clock'), elapsed);
    gl.uniform1f(uniform(simProgram, 'delta'), STEP);
    gl.uniform2f(uniform(simProgram, 'pointer'), pointer.x, pointer.y);
    const movingSource = !freeMode || pointer.down;
    gl.uniform2f(uniform(simProgram, 'pointerMotion'), movingSource ? pointer.vx : 0, movingSource ? pointer.vy : 0);
    // Holding a source must not continuously push gas radially away from it.
    gl.uniform1f(uniform(simProgram, 'pointerStrength'), !freeMode && pointer.active ? .32 : 0.0);
    gl.uniform2f(uniform(simProgram, 'brushFrom'), brush.fromX, brush.fromY);
    gl.uniform2f(uniform(simProgram, 'brushTo'), brush.x, brush.y);
    gl.uniform1f(uniform(simProgram, 'brushActive'), brush.active ? 1.0 : 0.0);
    gl.uniform1f(uniform(simProgram, 'sourceEnabled'), freeMode ? 0.0 : 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    brush.fromX = brush.x; brush.fromY = brush.y;
    current = 1 - current;
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, null);
    const blastAge=elapsed-burstStart;
    const expansion=freeMode&&emitterKind===6?1.25+380.*(sharedPresets.get(activePreset)?.dynamics[1]||1)*Math.exp(-Math.max(blastAge,0)*14.):freeMode&&emitterKind===1?1.2:0;
    pressure.update(targets[current].vf,expansion);
    stateRevision++;
    pointer.vx *= .48; pointer.vy *= .48;
  }
  function draw() {
    // Camera changes do not change emission or soot. Reuse their illumination
    // while paused so inspecting the volume does not rebuild all shadow maps.
    const hasProps=freeMode&&(emitterKind===1||emitterKind===2||(emitterKind>=16&&emitterKind<=20));
    const litVolume=roomEnabled||window.SceneLights.active;
    if(lightingRevision!==window.SceneLights.revision||(litVolume?roomLightRevision!==stateRevision:hasProps&&propLightRevision!==stateRevision)){
      const color=FIRE_COLORS.find(c=>c.id===flameColor);
      room.update(targets[current].vf,targets[current].chem,fuelControl.value==='gas'?1:0,litVolume,roomEnabled,color?.rgb||[1,1,1],flameColor==='natural'?0:1,fireLight/24);
      propLightRevision=stateRevision;roomLightRevision=litVolume?stateRevision:-1;lightingRevision=window.SceneLights.revision;
    }
    if(!litVolume && smokeLightRevision!==stateRevision){
      smokeLight.update(targets[current].chem);smokeLightRevision=stateRevision;
    }
    gl.useProgram(renderProgram); gl.bindFramebuffer(gl.FRAMEBUFFER, projected.fbo);
    gl.viewport(0, 0, RW, RH);
    bind(targets[current].vf, 0, uniform(renderProgram, 'vfTex'));
    bind(targets[current].chem, 1, uniform(renderProgram, 'chemTex'));
    gl.activeTexture(gl.TEXTURE14);gl.bindTexture(gl.TEXTURE_3D,objectTexture);gl.uniform1i(uniform(renderProgram,'objectTex'),14);
    bind(smokeLight.texture, 8, uniform(renderProgram, 'smokeLightTex'));
    room.bind(renderProgram,uniform);
    window.SceneLights.bind(gl,name=>uniform(renderProgram,name),roomEnabled);
    gl.uniform1f(uniform(renderProgram,'customLighting'),window.SceneLights.active?1:0);
    gl.uniform1f(uniform(renderProgram,'gasFlame'),fuelControl.value==='gas'?1:0);
    const tint=FIRE_COLORS.find(c=>c.id===flameColor);
    gl.uniform3fv(uniform(renderProgram,'flameTint'),tint?.rgb||[1,1,1]);
    gl.uniform1f(uniform(renderProgram,'tintStrength'),flameColor==='natural'?0:1);
    gl.uniform1f(uniform(renderProgram,'inspectSmoke'),inspectSmoke?1:0);
    gl.uniform1i(uniform(renderProgram,'visibleEmitter'),freeMode?emitterKind:0);
    gl.uniform1f(uniform(renderProgram,'inspectionLight'),litVolume?0:1);
    gl.uniform2f(uniform(renderProgram,'sourcePosition'),brush.x,brush.y);
    gl.uniform1f(uniform(renderProgram,'sourceScale'),shapeFor(activePreset)[0]);
    gl.uniform1f(uniform(renderProgram,'roomEnabled'),roomEnabled?1:0);
    gl.uniform1f(uniform(renderProgram,'cameraTan'),lensTan());
    gl.uniform1f(uniform(renderProgram,'viewZoom'),viewZoom);
    gl.uniform2f(uniform(renderProgram,'viewPan'),panX,panY);
    const viewCamera=camera();
    for(const name of ['eye','forward','right','up']) {
      gl.uniform3fv(uniform(renderProgram,'camera'+name[0].toUpperCase()+name.slice(1)),viewCamera[name]);
    }
    gl.uniform1f(uniform(renderProgram, 'clock'), elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(presentProgram); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    bind(projected.color, 0, uniform(presentProgram, 'projection'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  const pointer = { x: .5, y: .5, vx: 0, vy: 0, active: false, down: false, id: null, last: 0 };
  const brush = { x: .5, y: .5, fromX: .5, fromY: .5, active: false };
  let freeMode = false, activePreset = initialPreset;
  let emitterKind=0, burstStart=-100;
  const presetControl=document.querySelector('#preset');
  const fuelControl=document.querySelector('#fuel');
  const burstButton=document.querySelector('#burst');
  const fuelProfiles={wood:[1,1,1],gas:[.85,.22,1.25],oil:[1.15,2.4,.85]};
  const sharedPresets=new Map(FIRE_PRESETS.map(p=>[p.id,p]));
  // Three distinct wood beds share the same coupled fluid and combustion.
  // Scale the fuel footprint, log receiver and lift together.
  const sourceShapes={campfire:[1,1,1],bonfire:[1.48,.82,1.12],hearth:[.68,.64,.78]};
  async function loadObject(name){
    if(objectModels.has(name))return objectModels.get(name);
    const response=await fetch('pyro-gpu/objects/'+name+'.rgba16.bin?v=95fcf488354ba45d');
    if(!response.ok)throw new Error('Object geometry missing: '+name);
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==64*64*64*8)throw new Error('Object geometry has an invalid size: '+name);
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,texture);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,axis,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA16F,64,64,64,0,gl.RGBA,gl.HALF_FLOAT,new Uint16Array(bytes));
    objectModels.set(name,texture);return texture;
  }
  const presets={sigil:0,free:0,campfire:1,bonfire:1,hearth:1,torch:2,ring:3,sphere:4,wall:5,explosion:6};
  const shapeFor=key=>sourceShapes[key]||[sharedPresets.get(key)?.effect[1]||1,Math.max(.35,Math.min(2,(sharedPresets.get(key)?.dynamics[0]||.5)/.5)),1];
  function describeSource(){
    const name=presetControl.selectedOptions[0].textContent;
    message.textContent=emitterKind===6?`${name} · click to burst again`:`${name} · drag to move the source`;
    help.textContent=emitterKind===6
      ? 'Click to detonate at the cursor, or use Trigger burst. Each burst adds to the live smoke. Pause to inspect the expansion.'
      : emitterKind>=16&&emitterKind<=20
      ? 'Original uses the object distance field and a simpler finite surface burn. Choose 3D volume to inspect detailed moisture, char and damage.'
      : 'Click or drag to place the source. Release to keep burning. Stop fuel lets the flame die while its smoke drifts.';
    canvas.setAttribute('aria-label',`${name}. ${help.textContent}`);
  }
  function ignite(){
    brush.active=true;burstStart=elapsed;
    focusButton.disabled=false;extinguishButton.disabled=false;
    paused=false;captureAt=qaCaptureStop;lastFrame=performance.now();
    document.querySelector('#pause').textContent='Pause';
    describeSource();
  }
  async function selectPreset(key,frameSource=true){
    const profile=sharedPresets.get(key);
    if(((profile?.effect[0]===0)||false)!==domain.blast||!!profile?.object!==domain.object){onRemount(key);return;}
    objectTexture=profile?.object?await loadObject(profile.object):emptyObjectTexture;
    activePreset=key;presetControl.value=key;emitterKind=presets[key]??emitterKindFor(profile);
    fuelControl.value=profile?.fuel||'wood';
    flameColor=profile?.color||'natural';colorControl.value=flameColor;
    inspectSmoke=!!profile?.smokeSimulation||key==='smoke-burst';smokeControl.checked=inspectSmoke;
    measurement=null;benchmarkButton.disabled=false;
    freeMode=!['sigil','sigil-cybr','violet-sigil'].includes(key);
    pointer.down=false;pointer.id=null;pointer.active=false;endPan();setTool(false);
    reset();burstStart=-100;
    extinguishButton.hidden=!freeMode;
    burstButton.hidden=emitterKind!==6;
    restartButton.textContent=key==='free'?'Clear fire':'Restart';
    focusButton.disabled=true;
    brush.x=brush.fromX=((profile?.source?.[0]??0)-MINX)/WX;
    const height=profile?.source?.[1]??(key==='ring'?1.65:key==='sphere'?1.6:emitterKind===6?.5:key==='torch'?1.1:key==='hearth'?.28:emitterKind===1?.36:.2);
    brush.y=brush.fromY=(height-MINY)/WY;
    paused=false;document.querySelector('#pause').textContent='Pause';lastFrame=performance.now();
    if(freeMode && key!=='free')ignite();
    else if(freeMode){extinguishButton.disabled=true;describeSource();message.textContent='Free fire · click to ignite';}
    else {
      message.textContent='Live GPU sigil · click to create fire';
      help.textContent='Choose a source above, or click the canvas to create and drag your own fire.';
      canvas.setAttribute('aria-label','Live GPU-simulated volumetric fire forming the Cybrdelic 02 mark. Click to create your own fire.');
    }
    if(frameSource){
      if(freeMode && key!=='free')focusSource();
      else {panX=panY=0;viewZoom=1;updateView();}
    }
    needsDraw=true;
  }
  fuelControl.onchange=()=>{stateRevision++;needsDraw=true;};
  burstButton.onclick=()=>{if(emitterKind===6)ignite();};

  // Rendering and pointer unprojection share the same lens and camera. Keep
  // this unclamped for cursor-anchored zoom and pan; clamp only fuel placement.
  function scenePoint(e) {
    const r = canvas.getBoundingClientRect();
    let x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    let y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    if(roomEnabled) {
      const c=camera();
      const ray=c.forward.map((v,i)=>v+(x*2-1)*(16/9)*lensTan()*c.right[i]+(y*2-1)*lensTan()*c.up[i]);
      const distance=-c.eye[2]/ray[2];
      x=(c.eye[0]+ray[0]*distance-MINX)/WX;
      y=(c.eye[1]+ray[1]*distance-MINY)/WY;
    } else {x=((x-.5)*14/viewZoom+panX-MINX)/WX;y=((y-.5)*7.875/viewZoom+2.8875+panY-MINY)/WY;}
    return {x,y};
  }
  function point(e) {
    const at=scenePoint(e);
    const base=Math.max(sharedPresets.get(activePreset)?.minHeight||0,emitterKind===1?.36:emitterKind===2?1.0:emitterKind===3?1.5:emitterKind===4?.85:.08);
    const x=Math.max(.02,Math.min(.98,at.x)),y=Math.max((base-MINY)/WY,Math.min(.96,at.y));
    const now = performance.now();
    const dt = Math.max(.01, (now - pointer.last) / 1000);
    pointer.vx = pointer.last ? Math.max(-2, Math.min(2, (x - pointer.x) / dt)) : 0;
    pointer.vy = pointer.last ? Math.max(-2, Math.min(2, (y - pointer.y) / dt)) : 0;
    pointer.x = x; pointer.y = y; pointer.last = now; pointer.active = true;
  }
  on(view,'pointermove', e => {
    if(panGesture){
      if(e.pointerId!==panGesture.id)return;
      const at=scenePoint(e);
      panX+=(panGesture.anchor.x-at.x)*WX;panY+=(panGesture.anchor.y-at.y)*WY;
      updateView();return;
    }
    if(panTool||e.shiftKey||e.buttons===2){pointer.active=false;return;}
    if (pointer.down && e.pointerId !== pointer.id) return;
    point(e);
    if (freeMode && pointer.down && emitterKind!==6) { brush.x = pointer.x; brush.y = pointer.y; }
  });
  on(view,'pointerdown', e => {
    if(pointer.down||panGesture)return;
    if(panTool||e.shiftKey||e.button===2){
      e.preventDefault();view.focus({preventScroll:true});
      pointer.active=false;pointer.last=0;
      panGesture={id:e.pointerId,anchor:scenePoint(e)};
      view.setPointerCapture(e.pointerId);view.classList.add('is-panning');return;
    }
    if (pointer.down || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    view.focus({preventScroll:true});
    pointer.last=0;
    point(e);
    pointer.down = true; pointer.id = e.pointerId;
    view.setPointerCapture(e.pointerId);
    if (!freeMode) {
      freeMode = true;emitterKind=0;activePreset='free';presetControl.value='free';
      reset();
      extinguishButton.hidden = false;
      restartButton.textContent = 'Clear fire';
    }
    brush.x = brush.fromX = pointer.x;
    brush.y = brush.fromY = pointer.y;
    ignite();
  });
  on(view,'pointerup', e => {
    if(panGesture?.id===e.pointerId){endPan();return;}
    if (e.pointerId !== pointer.id) return;
    point(e);
    if (freeMode && emitterKind!==6) { brush.x = pointer.x; brush.y = pointer.y; }
    pointer.down = false; pointer.id = null;
  });
  on(view,'pointercancel', e => {
    if(panGesture?.id===e.pointerId){endPan();return;}
    if (e.pointerId !== pointer.id) return;
    pointer.down = false; pointer.id = null; pointer.active = false;
  });
  on(view,'lostpointercapture', () => { endPan();pointer.down = false; pointer.id = null; });
  on(window,'blur', () => { endPan();pointer.down = false; pointer.id = null; pointer.active = false; });
  on(view,'pointerleave', () => { if (!pointer.down) pointer.active = false; });
  let captureAt = Number(new URL(location.href).searchParams.get('capture')) || 0;
  let paused = false, elapsed = 0, accumulator = 0, lastFrame = performance.now();
  let observedSteps = 0, observedDraws = 0, observedStart = lastFrame, needsDraw = true;
  function endPan(){panGesture=null;view.classList.remove('is-panning');pointer.last=0;}
  function updateView(){
    panX=Math.max(-6.5,Math.min(6.5,panX));panY=Math.max(-2.8,Math.min(3.5,panY));
    zoomControl.value=Math.round(viewZoom*100);
    document.querySelector('#zoom-value').textContent=`${Math.round(viewZoom*100)}%`;
    orbitControl.value=viewAngle;document.querySelector('#angle-value').textContent=`${viewAngle}°`;
    document.querySelector('#zoom-out').disabled=viewZoom<=.7;
    document.querySelector('#zoom-in').disabled=viewZoom>=3;
    pointer.active=false;pointer.last=0;needsDraw=true;
  }
  function setZoom(value,anchorEvent){
    if(pointer.down||panGesture)return;
    const before=anchorEvent?scenePoint(anchorEvent):null;
    viewZoom=Math.max(.7,Math.min(3,Math.round(value*100)/100));
    if(before){const after=scenePoint(anchorEvent);panX+=(before.x-after.x)*WX;panY+=(before.y-after.y)*WY;}
    updateView();
  }
  function setTool(pan){
    endPan();panTool=pan;pointer.active=false;
    document.querySelector('#fire-tool').setAttribute('aria-pressed',String(!pan));
    document.querySelector('#pan-tool').setAttribute('aria-pressed',String(pan));
    view.dataset.tool=pan?'pan':'fire';
  }
  on(view,'contextmenu',e=>e.preventDefault());
  on(view,'wheel',e=>{
    e.preventDefault();
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?view.clientHeight:1);
    setZoom(viewZoom*Math.exp(-Math.max(-250,Math.min(250,delta))*.0015),e);
  },{passive:false});
  document.querySelector('#fire-tool').onclick=()=>setTool(false);
  document.querySelector('#pan-tool').onclick=()=>setTool(true);
  zoomControl.oninput=()=>setZoom(Number(zoomControl.value)/100);
  document.querySelector('#zoom-in').onclick=()=>setZoom(viewZoom+.25);
  document.querySelector('#zoom-out').onclick=()=>setZoom(viewZoom-.25);
  document.querySelector('#reset-view').onclick=()=>{endPan();viewZoom=1;panX=panY=0;viewAngle=16;updateView();};
  function focusSource(){
    if(!freeMode)return;
    const lift=emitterKind===3?.15:emitterKind===4?0:emitterKind===1||emitterKind===2?.65:emitterKind===6?1.65:1.1;
    panX=MINX+brush.x*WX;panY=MINY+brush.y*WY+lift-2.4;
    viewZoom=emitterKind===4?2.5:emitterKind===3?1.55:emitterKind===5?1.3:emitterKind===6?1.25:activePreset==='bonfire'?1.85:activePreset==='hearth'?2.5:2.25;
    updateView();
  }
  focusButton.onclick=focusSource;
  fullscreenButton.onclick=async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('main').requestFullscreen();}
    catch{message.textContent='Fullscreen is unavailable in this browser. Zoom and Move view are still available.';}
  };
  on(document,'fullscreenchange',()=>{fullscreenButton.textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';needsDraw=true;});
  updateView();
  const updateLightLabel=()=>{
    sceneLabel.textContent=roomEnabled?(window.SceneLights.active?'Scene lighting · etched stone':'Fire-lit room · etched stone'):'Fire and smoke · black background';
    fireLightControl.disabled=!roomEnabled&&!window.SceneLights.active;
    document.querySelector('.fire-light-control small').textContent=fireLightControl.disabled
      ? 'Enable the room or scene lights to inspect fire illumination. Black view uses smoke inspection fill.'
      : 'Light cast by the flame onto smoke, props and the room.';
  };
  on(window,'scene-light-change',()=>{needsDraw=true;updateLightLabel();});
  updateLightLabel();
  roomToggle.onchange=()=>{
    roomLightRevision=-1;lightingRevision=-1;
    roomEnabled=roomToggle.checked;orbitControl.disabled=!roomEnabled;needsDraw=true;
    updateLightLabel();
  };
  orbitControl.oninput=()=>{viewAngle=Number(orbitControl.value);updateView();};
  document.querySelector('#pause').onclick = () => { paused = !paused; document.querySelector('#pause').textContent = paused ? 'Resume' : 'Pause'; };
  extinguishButton.onclick = () => {
    brush.active = false;
    pointer.down = false; pointer.id = null;
    extinguishButton.disabled = true;
    message.textContent = 'Fuel stopped · smoke continues to drift';
    paused = false; captureAt = 0;
    document.querySelector('#pause').textContent = 'Pause';
  };
  restartButton.onclick = () => selectPreset(presetControl.value,false);
  on(window,'keydown', e => {
    if(!scope.visible)return;
    if(e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
    if(e.target instanceof HTMLElement && (e.target.isContentEditable||e.target.matches('input,select,textarea')))return;
    const key=e.key.toLowerCase();
    if(e.code==='Space' && !(e.target instanceof HTMLElement && e.target.matches('button,a'))){e.preventDefault();document.querySelector('#pause').click();}
    else if(key==='r')restartButton.click();
    else if(key==='0')document.querySelector('#reset-view').click();
    else if(key==='+'||key==='='){e.preventDefault();setZoom(viewZoom+.25);}
    else if(key==='-'||key==='_'){e.preventDefault();setZoom(viewZoom-.25);}
    else if(key==='f')fullscreenButton.click();
    else if(key==='escape'){setTool(false);pointer.down=false;pointer.id=null;}
  });
  let simProgram, renderProgram, presentProgram, targets, projected, sourceTexture, widthTexture, noiseTexture, pressure, advection, vorticity, smokeLight, room, current = 0;
  function frame(now) {
    probe.poll(paused);
    if(!scope.visible){lastFrame=now;scope.schedule(frame);return;}
    const delta = Math.min(.08, (now - lastFrame) / 1000); lastFrame = now;
    let steps = 0;
    const probing=!paused&&accumulator+delta>=STEP;if(probing)probe.begin();
    if (!paused) {
      accumulator += delta;
      while (accumulator >= STEP && steps < 2) {
        elapsed += STEP;
        if (!freeMode && elapsed > DURATION) { reset(); accumulator = STEP; }
        runStep(); accumulator -= STEP; steps++;
        observedSteps++;
        if (captureAt > 0 && elapsed >= captureAt) { paused = true; document.querySelector('#pause').textContent = 'Resume'; break; }
      }
      if (steps === 2 && accumulator > STEP * 2) accumulator = STEP;
    }
    const drawn=steps>0||needsDraw;
    if (drawn) { draw(); observedDraws++; needsDraw = false; }
    if(measurement){
      if(paused){measurement=null;benchmarkButton.disabled=false;document.querySelector('#gpu-status').textContent='Measurement stopped while paused.';}
      else {
        measurement.steps+=steps;
        if(drawn){
          if(measurement.last!==null)measurement.intervals.push(now-measurement.last);
          measurement.last=now;
          if(measurement.intervals.length===179){
            const duration=(now-measurement.start)/1000,sorted=[...measurement.intervals].sort((a,b)=>a-b);
            document.querySelector('#gpu-status').textContent=`Render submissions ${(179000/measurement.intervals.reduce((sum,v)=>sum+v,0)).toFixed(1)} fps · frame interval p95 ${sorted[Math.ceil(sorted.length*.95)-1].toFixed(1)} ms · ${(measurement.steps/duration/30).toFixed(2)}× realtime. Browser frame pacing; GPU execution is not measured.`;
            measurement=null;benchmarkButton.disabled=false;
          }
        }
      }
    }
    if(probing)probe.end({time:elapsed,steps,drawn});
    if (now - observedStart > 800) {
      const span = (now - observedStart) / 1000;
      const simRate = Math.round(observedSteps / span);
      const renderRate = Math.round(observedDraws / span);
      metrics.textContent = `${paused ? 'paused' : `${simRate} sim steps/s · ${renderRate} rendered fps`} · ${elapsed.toFixed(1)} s · ${NX} × ${NZ} × ${DEPTH} cells`;
      observedSteps = 0; observedDraws = 0; observedStart = now;
    }
    scope.schedule(frame);
  }
  async function start() {
    try {
      if (AW > gl.getParameter(gl.MAX_TEXTURE_SIZE) || AH > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        throw new Error('This GPU cannot fit the live fire volume');
      }
      pressure = CoarsePressure.setup(gl, { nx: NX, nz: NZ, depth: DEPTH, tilesX: TILES_X, tilesY: TILES_Y, worldX:WX,worldZ:WY,worldY:WZ,coarseX:domain.blast?96:128,coarseZ:domain.blast?96:72,coarseDepth:domain.blast?32:8,iterations:domain.blast?24:18 });
      advection = MacCormackAdvection.setup(gl, {
        nx: NX, nz: NZ, depth: DEPTH, tilesX: TILES_X, tilesY: TILES_Y,
        pressureSamplingGLSL: pressure.samplingGLSL
      });
      vorticity = FireVorticity.setup(gl, {nx: NX, nz: NZ, depth: DEPTH, tilesX: TILES_X});
      smokeLight = SmokeLight.setup(gl, {nx: NX, nz: NZ, depth: DEPTH, tilesX: TILES_X});
      room = FireRoom.setup(gl, {nx: NX, nz: NZ, depth: DEPTH, tilesX: TILES_X});
      simProgram = program(simulation()); renderProgram = program(rendering()); presentProgram = program(presentation);
      gl.bindVertexArray(gl.createVertexArray());
      targets = [target(), target()]; projected = projectionTarget();
      // Periodic smooth noise is sampled by the source and velocity fields.
      // It is a static turbulence basis, not prerecorded motion.
      const n = new Uint8Array(256 * 256 * 4);
      function hash(x, y, channel) {
        let v = (x * 374761393 + y * 668265263 + channel * 1442695041) >>> 0;
        v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
        return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
      }
      function valueNoise(x, y, period, channel) {
        const xx = x * period / 256, yy = y * period / 256;
        const ix = Math.floor(xx), iy = Math.floor(yy);
        const fx = xx - ix, fy = yy - iy;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = hash(ix & (period - 1), iy & (period - 1), channel);
        const b = hash((ix + 1) & (period - 1), iy & (period - 1), channel);
        const c = hash(ix & (period - 1), (iy + 1) & (period - 1), channel);
        const d = hash((ix + 1) & (period - 1), (iy + 1) & (period - 1), channel);
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
      }
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 4; c++) {
        const v = .50 * valueNoise(x, y, 8, c) + .28 * valueNoise(x, y, 16, c)
                + .15 * valueNoise(x, y, 32, c) + .07 * valueNoise(x, y, 64, c);
        n[(y * 256 + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      noiseTexture = texture(256, 256, n);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      // The fine velocity forcing samples a filtered mip to avoid sub-cell
      // noise folding into a stationary grid pattern at the live resolution.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      turbulenceTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,turbulenceTexture);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,axis,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      const turbulence=new Uint8Array(64*64*64*4);
      for(let z=0;z<64;z++)for(let y=0;y<64;y++)for(let x=0;x<64;x++)for(let c=0;c<4;c++)
        turbulence[((z*64+y)*64+x)*4+c]=Math.round(hash(x+z*71,y+z*37,c)*255);
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,64,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,turbulence);
      emptyObjectTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,emptyObjectTexture);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA16F,1,1,1,0,gl.RGBA,gl.HALF_FLOAT,new Uint16Array([0x4900,0,0,0]));
      objectTexture=emptyObjectTexture;
      const [sourceBytes, widthBytes] = await Promise.all([
        fetch('source/source-native.rgba8.bin?v=95fcf488354ba45d').then(r => { if (!r.ok) throw new Error('Source field missing'); return r.arrayBuffer(); }),
        fetch('source/halfwidth-native.r8.bin?v=95fcf488354ba45d').then(r => { if (!r.ok) throw new Error('Source thickness missing'); return r.arrayBuffer(); })
      ]);
      if (sourceBytes.byteLength !== SOURCE_NX * SOURCE_NZ * 4 || widthBytes.byteLength !== SOURCE_NX * SOURCE_NZ) throw new Error('Source field size mismatch');
      const sourcePixels = new Uint8Array(sourceBytes);
      sourceTexture = texture(SOURCE_NX, SOURCE_NZ, sourcePixels);
      widthTexture = texture(SOURCE_NX, SOURCE_NZ, new Uint8Array(widthBytes), gl.LINEAR, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
      canvas.width = 1920; canvas.height = 1080;
      const pendingBrush = brush.active;
      reset();
      if (freeMode && pendingBrush) brush.active = true;
      message.textContent = freeMode
        ? pendingBrush ? 'Free fire · drag to move the source' : 'Free fire · click to ignite'
        : 'Live GPU simulation · click to create fire';
      if(freeMode && pendingBrush)describeSource();
      const initialParams=new URL(location.href).searchParams;
      await selectPreset(initialPreset);
      if(initialParams.has('fuel')&&fuelProfiles[initialParams.get('fuel')])fuelControl.value=initialParams.get('fuel');
      setFireLight(fireLight);
      scope.schedule(frame);
    } catch (err) {
      await scope.stop();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw err;
    }
  }
  on(canvas,'webglcontextlost', e => { e.preventDefault(); scope.setVisible(false); onFailure(new Error('The GPU context was lost. Try again to restart the simulation.')); });
  on(canvas,'webglcontextrestored', () => location.reload());
  await start();
  return {
    async dispose(){await scope.stop();gl.getExtension('WEBGL_lose_context')?.loseContext();},
    setVisible(value){if(!value)cancelMeasurement();scope.setVisible(value);},
    fire:selectPreset,
    snapshot:()=>({fire:'legacy:'+activePreset,fuel:fuelControl.value,smoke:inspectSmoke,color:flameColor,fireLight,room:roomEnabled,camera:{zoom:viewZoom,angle:viewAngle,pan:[panX,panY]}}),
    look(item){
      if(item.fuel)fuelControl.value=item.fuel;
      if(FIRE_COLORS.some(c=>c.id===item.color)){flameColor=item.color;colorControl.value=flameColor;markAppearance();}
      if(typeof item.smoke==='boolean'){inspectSmoke=item.smoke;smokeControl.checked=inspectSmoke;needsDraw=true;}
      if(item.fireLight!==undefined)setFireLight(item.fireLight);
      if(typeof item.room==='boolean'){roomToggle.checked=item.room;roomToggle.dispatchEvent(new Event('change'));}
      if(item.camera){viewZoom=item.camera.zoom??viewZoom;viewAngle=Math.max(-30,Math.min(30,item.camera.angle??viewAngle));[panX,panY]=item.camera.pan??[panX,panY];updateView();}
    }
  };
}
