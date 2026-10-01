/* Live fire and optional user lighting. Emission and emission-weighted positions are reduced
 * entirely on the GPU into 32 moving area-light clusters. No baked animation,
 * prerecorded illumination or readback is used. Soot attenuates each light
 * segment; receiver irradiance is cached separately from the fine material.
 * This is clustered direct lighting, not path-traced global illumination. */
window.createFireRoom = () => {
  'use strict';
  const vertex=`#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
  const common=`#version 300 es
  precision highp float;
  precision highp sampler2D;
  `;
  const lightingGLSL=`
  ${window.FireOptics}
  uniform sampler2D roomPowerTex;
  uniform sampler2D roomMomentTex;
  uniform float fireLightGain;
  uniform vec3 ambientLight;
  uniform vec3 spotPosition[2],spotDirection[2],spotPower[2];
  uniform vec2 spotCone[2];
  void spotSample(int i,vec3 at,out vec3 direction,out vec3 intensity){
    vec3 d=spotPosition[i]-at;float r2=max(dot(d,d),.001);direction=d*inversesqrt(r2);
    float cone=smoothstep(spotCone[i].x,spotCone[i].y,dot(-direction,spotDirection[i]));
    intensity=spotPower[i]*cone/(r2+.2);
  }
  const vec3 roomExtent=fireExtent;
  const vec3 roomMin=fireMin;
  // Radiance integrated over voxel volume; shared by smoke and receivers.
  const float roomLightScale=(fireExtent.x*fireExtent.y*fireExtent.z)/(128.*64.*16.)*8.;
  void roomLight(int i,out vec3 position,out vec3 power){
    ivec2 cell=ivec2(i%8,i/8);
    vec4 energy=texelFetch(roomPowerTex,cell,0);
    power=energy.rgb*roomLightScale*fireLightGain;
    position=roomMin+roomExtent*texelFetch(roomMomentTex,cell,0).xyz/max(energy.a,.00001);
  }
  `;
  class FireRoom {
    constructor(gl,{nx,nz,depth,tilesX}) {
      this.gl=gl;
      const compile=fragment=>{
        const p=gl.createProgram();
        for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
          const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(p,s);gl.deleteShader(s);
        }
        gl.linkProgram(p);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        const uniforms=new Map();
        return {p,u:name=>{if(!uniforms.has(name)) uniforms.set(name,gl.getUniformLocation(p,name));return uniforms.get(name);}};
      };
      const target=(x,y,z,channels)=>{
        const tx=Math.min(z,4),ty=Math.ceil(z/tx),width=x*tx,height=y*ty;
        const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
        const textures=[];
        for(let i=0;i<channels;i++) {
          const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.HALF_FLOAT,null);
          gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);
          textures.push(t);
        }
        gl.drawBuffers(textures.map((_,i)=>gl.COLOR_ATTACHMENT0+i));
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Fire room framebuffer incomplete');
        return {x,y,z,tx,width,height,fbo,textures};
      };
      this.levels=[[128,64,16],[64,32,8],[32,16,4],[16,8,2],[8,4,1]].map((s,i)=>target(...s,i===0?3:2));
      this.gather=compile(common+window.FireOptics+`
      uniform sampler2D velocity;
      uniform sampler2D chemistry;
      layout(location=0) out vec4 energy;
      layout(location=1) out vec4 moment;
      layout(location=2) out vec4 density;
      vec4 sampleVolume(sampler2D t,vec3 p){
        float z=p.z*${depth-1}.,lo=floor(z),hi=min(lo+1.,${depth-1}.);
        vec2 size=vec2(${nx}.,${nz}.),atlas=size*vec2(${tilesX}.,${Math.ceil(depth/tilesX)}.);
        vec2 xy=clamp(p.xy,.5/size,1.-.5/size)*size;
        vec2 a=(vec2(mod(lo,${tilesX}.),floor(lo/${tilesX}.))*size+xy)/atlas;
        vec2 b=(vec2(mod(hi,${tilesX}.),floor(hi/${tilesX}.))*size+xy)/atlas;
        return mix(texture(t,a),texture(t,b),fract(z));
      }
      void main(){
        ivec2 ip=ivec2(gl_FragCoord.xy);
        vec3 p=vec3((vec2(ip.x%128,ip.y%64)+.5)/vec2(128.,64.),float(ip.x/128+4*(ip.y/64))/15.);
        float reaction=sampleVolume(velocity,p).a;
        vec4 chem=sampleVolume(chemistry,p);
        vec3 e=fireEmission(reaction,chem.b)+sootEmission(chem.a,chem.b);
        // Four subcell samples retain thin advected soot in the shadow grid.
        vec3 h=vec3(.25/128.,.25/64.,.25/15.);
        float soot=.25*(sampleVolume(chemistry,p+h).a+sampleVolume(chemistry,p-h).a
          +sampleVolume(chemistry,p+h*vec3(1,-1,-1)).a+sampleVolume(chemistry,p+h*vec3(-1,1,1)).a);
        density=vec4(sootExtinction(soot),0.,0.,1.);
        float weight=dot(e,vec3(.2126,.7152,.0722));
        energy=vec4(e,weight);moment=vec4(p*weight,weight);
      }`);
      this.reduce=compile(common+`
      uniform sampler2D energyTex;
      uniform sampler2D momentTex;
      uniform ivec4 inputGrid;
      uniform ivec4 outputGrid;
      layout(location=0) out vec4 energy;
      layout(location=1) out vec4 moment;
      void main(){
        ivec2 ip=ivec2(gl_FragCoord.xy);
        ivec3 base=ivec3(ip.x%outputGrid.x,ip.y%outputGrid.y,ip.x/outputGrid.x+outputGrid.w*(ip.y/outputGrid.y))*2;
        energy=vec4(0);moment=vec4(0);
        for(int z=0;z<2;z++) for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
          ivec3 c=base+ivec3(x,y,z);
          ivec2 q=ivec2((c.z%inputGrid.w)*inputGrid.x+c.x,(c.z/inputGrid.w)*inputGrid.y+c.y);
          energy+=texelFetch(energyTex,q,0);moment+=texelFetch(momentTex,q,0);
        }
      }`);
      // Low-resolution optical depth is integrated along the actual source-to-
      // receiver segment. Clipping to the gas bounds avoids wasting taps in air.
      const shadowGLSL=lightingGLSL+`
      uniform sampler2D densityTex;
      float extinctionAt(vec3 world){
        vec3 p=clamp((world-roomMin)/roomExtent,vec3(0),vec3(1));
        float z=p.z*15.,lo=floor(z),hi=min(lo+1.,15.);
        vec2 xy=clamp(p.xy,vec2(.5/128.,.5/64.),vec2(1.-.5/128.,1.-.5/64.));
        return mix(texture(densityTex,(vec2(mod(lo,4.),floor(lo/4.))+xy)/4.).r,
                   texture(densityTex,(vec2(mod(hi,4.),floor(hi/4.))+xy)/4.).r,fract(z));
      }
      float visibility(vec3 receiver,vec3 emitter){
        vec3 delta=emitter-receiver;
        vec3 safe=sign(delta+vec3(1e-9))*max(abs(delta),vec3(1e-6));
        vec3 a=(roomMin-receiver)/safe,b=(roomMin+roomExtent-receiver)/safe;
        vec3 near=min(a,b),far=max(a,b);
        float enter=max(0.,max(near.x,max(near.y,near.z)));
        float leave=min(1.,min(far.x,min(far.y,far.z)));
        if(leave<=enter)return 1.;
        float stride=(leave-enter)/12.,tau=0.;
        for(int j=0;j<12;j++)tau+=extinctionAt(receiver+delta*(enter+(float(j)+.5)*stride));
        return exp(-min(tau*length(delta)*stride,14.));
      }
      uniform sampler2D directReceiverTex;
      uniform float bounceGain,includeBounce;
      // Two quadrature patches on each of five diffuse room surfaces. This
      // approximates one reflected bounce; it is not a converged GI solution.
      vec3 indirectIrradiance(vec3 at,vec3 normal,bool surface){
        if(bounceGain<=0.||includeBounce<.5)return vec3(0);
        vec3 total=vec3(0);
        for(int f=0;f<5;f++)for(int j=0;j<2;j++){
          vec2 uv=vec2(.3+.4*float(j),.4);vec3 p,n;float area;
          if(f==0||f==4){p=vec3(mix(-7.4,7.4,uv.x),f==0?.01:7.19,mix(-2.5,10.,uv.y));n=vec3(0,f==0?1.:-1.,0);area=92.5;}
          else if(f==1){p=vec3(mix(-7.4,7.4,uv.x),uv.y*7.2,-2.49);n=vec3(0,0,1);area=53.28;}
          else{p=vec3(f==2?-7.39:7.39,uv.y*7.2,mix(-2.5,10.,uv.x));n=vec3(f==2?1.:-1.,0,0);area=45.;}
          vec3 delta=p-at;float r2=max(dot(delta,delta),.01);vec3 d=delta*inversesqrt(r2);
          float a=max(dot(n,-d),0.)*(surface?max(dot(normal,d),0.):1.);
          if(a<=.0001)continue;
          vec3 incoming=texture(directReceiverTex,vec2((float(f)+uv.x)/5.,uv.y)).rgb;
          // Finite patch denominator prevents near-field point-light spikes.
          total+=incoming*vec3(.115,.12,.125)/3.14159*a*area/(r2+area/3.14159)*visibility(at,p);
        }
        return total*bounceGain;
      }
      vec3 irradiance(vec3 at,vec3 normal,bool surface){
        vec3 result=vec3(0);
        for(int i=0;i<32;i++){
          vec3 center,power;roomLight(i,center,power);
          if(dot(power,power)<1e-10)continue;
          vec3 d=center-at;float r2=dot(d,d);
          float cosine=surface?max(dot(normal,d*inversesqrt(max(r2,.0001))),0.):1.;
          if(cosine<.001)continue;
          result+=power*(cosine*visibility(at,center)/(r2+.12));
        }
        vec3 sky=vec3(at.x,7.19,at.z);
        if(dot(ambientLight,ambientLight)>.000001)result+=ambientLight*(surface?(.25+.75*max(normal.y,0.)):1.)*visibility(at,sky);
        for(int i=0;i<2;i++){
          if(dot(spotPower[i],spotPower[i])<.00001)continue;
          vec3 direction,power;spotSample(i,at,direction,power);
          float cosine=surface?max(dot(normal,direction),0.):1.;
          if(cosine>0.&&dot(power,power)>.00001)result+=power*cosine*visibility(at,spotPosition[i]);
        }
        return result+indirectIrradiance(at,normal,surface);
      }`;
      this.illumination=target(64,36,16,1);
      this.illuminate=compile(common+shadowGLSL+`
      out vec4 result;
      void main(){
        ivec2 ip=ivec2(gl_FragCoord.xy);
        vec3 p=vec3((vec2(ip.x%64,ip.y%36)+.5)/vec2(64.,36.),float(ip.x/64+4*(ip.y/36))/15.);
        vec3 at=roomMin+roomExtent*p;
        // Expand occupied support by one lighting cell for interpolation at
        // thin smoke boundaries. Empty air needs no scattering illumination.
        vec3 h=roomExtent/vec3(64.,36.,15.);
        float support=extinctionAt(at)+extinctionAt(at+vec3(h.x,0,0))+extinctionAt(at-vec3(h.x,0,0))
          +extinctionAt(at+vec3(0,h.y,0))+extinctionAt(at-vec3(0,h.y,0))
          +extinctionAt(at+vec3(0,0,h.z))+extinctionAt(at-vec3(0,0,h.z));
        result=vec4(support>.00001?irradiance(at,vec3(0),false):vec3(0),1.);
      }`);
      // Camera-independent irradiance atlas: five receivers, 96² samples each.
      // Keep the fine etched material in the full-resolution display pass.
      this.receivers=target(96*5,96,1,1);
      this.bouncedReceivers=target(96*5,96,1,1);
      this.receiverTexture=this.receivers.textures[0];
      this.lightReceivers=compile(common+shadowGLSL+`
      out vec4 result;
      void main(){
        int face=int(gl_FragCoord.x)/96;
        vec2 q=vec2(mod(gl_FragCoord.x,96.),gl_FragCoord.y)/96.;
        vec3 at,n;
        if(face==0||face==4){at=vec3(mix(-7.4,7.4,q.x),face==0?0.:7.2,mix(-2.5,10.,q.y));n=vec3(0,face==0?1.:-1.,0);}
        else if(face==1){at=vec3(mix(-7.4,7.4,q.x),q.y*7.2,-2.5);n=vec3(0,0,1);}
        else{at=vec3(face==2?-7.4:7.4,q.y*7.2,mix(-2.5,10.,q.x));n=vec3(face==2?1.:-1.,0,0);}
        result=vec4(irradiance(at,n,true),1.);
      }`);
      this.lightingGLSL=lightingGLSL;
      this.surfaceGLSL=`
      ${lightingGLSL}
      uniform sampler2D roomSmokeTex;
      uniform sampler2D roomReceiverTex;
      uniform vec3 cameraEye,cameraForward,cameraRight,cameraUp;
      uniform float cameraTan;
      vec3 roomRay(vec2 screen){return normalize(cameraForward+(screen.x*2.-1.)*(16./9.)*cameraTan*cameraRight+(screen.y*2.-1.)*cameraTan*cameraUp);}
      vec3 smokeIrradiance(vec3 p){
        p=clamp(p,vec3(0),vec3(1));
        float z=p.z*15.,lo=floor(z),hi=min(lo+1.,15.);
        vec2 xy=clamp(p.xy,vec2(.5/64.,.5/36.),vec2(1.-.5/64.,1.-.5/36.));
        vec2 a=(vec2(mod(lo,4.),floor(lo/4.))+xy)/4.;
        vec2 b=(vec2(mod(hi,4.),floor(hi/4.))+xy)/4.;
        return mix(texture(roomSmokeTex,a).rgb,texture(roomSmokeTex,b).rgb,fract(z));
      }
      void hitPlane(vec3 eye,vec3 ray,vec3 normal,float offset,inout float nearest,inout vec3 n){
        float denom=dot(ray,normal);
        if(denom>=-.0001) return;
        float t=(offset-dot(eye,normal))/denom;
        if(t>.0 && t<nearest){nearest=t;n=normal;}
      }
      float roomHit(vec3 eye,vec3 ray,out vec3 n){
        float t=1000.;n=vec3(0);
        hitPlane(eye,ray,vec3(0,1,0),0.,t,n);
        hitPlane(eye,ray,vec3(0,0,1),-2.5,t,n);
        hitPlane(eye,ray,vec3(1,0,0),-7.4,t,n);
        hitPlane(eye,ray,vec3(-1,0,0),-7.4,t,n);
        hitPlane(eye,ray,vec3(0,-1,0),-7.2,t,n);
        return t;
      }
      vec3 roomSurface(vec3 at,vec3 n,vec3 viewDirection){
        vec3 u,v;
        if(abs(n.y)>.5){u=vec3(1,0,0);v=vec3(0,0,1);}
        else if(abs(n.z)>.5){u=vec3(1,0,0);v=vec3(0,1,0);}
        else{u=vec3(0,0,1);v=vec3(0,1,0);}
        vec2 q=vec2(dot(at,u),dot(at,v));
        // Analytic coverage keeps the 3 mm etching thin at oblique angles.
        vec2 distanceToLine=abs(fract(q/.5+.5)-.5)*.5;
        vec2 footprint=max(fwidth(q),vec2(.0001));
        vec2 coverage=clamp((vec2(.003)+footprint*.5-distanceToLine)/footprint,0.,1.);
        float groove=max(coverage.x,coverage.y);
        float mineral=.96+.025*sin(q.x*3.7+sin(q.y*2.3))+.015*sin(q.y*13.1+q.x*8.7);
        vec3 albedo=vec3(.115,.12,.125)*mineral*mix(1.,.48,groove);
        int face;vec2 st;
        if(abs(n.y)>.5){face=n.y>0.?0:4;st=vec2((at.x+7.4)/14.8,(at.z+2.5)/12.5);}
        else if(n.z>.5){face=1;st=vec2((at.x+7.4)/14.8,at.y/7.2);}
        else{face=n.x>0.?2:3;st=vec2((at.z+2.5)/12.5,at.y/7.2);}
        st=clamp(st,vec2(.5/96.),vec2(1.-.5/96.));
        vec3 incoming=texture(roomReceiverTex,vec2((float(face)+st.x)/5.,st.y)).rgb;
        return incoming*albedo/3.14159;
      }
      `;
    }
    update(vf,chem,gasFlame=0,shadeRoom=true,roomVisible=true,tint=[1,1,1],tintStrength=0,fireLightGain=1,powerFlame=0) {
      this.fireLightGain=fireLightGain;
      const gl=this.gl;
      const bind=(program,name,tex,unit)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(program.u(name),unit);};
      const begin=(program,target)=>{gl.useProgram(program.p);gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.viewport(0,0,target.width,target.height);};
      // These targets were samplers during the previous display pass.
      for(const unit of [9,10,11,12]) {gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}
      begin(this.gather,this.levels[0]);bind(this.gather,'velocity',vf,0);bind(this.gather,'chemistry',chem,1);
      gl.uniform1f(this.gather.u('gasFlame'),gasFlame);
      gl.uniform1f(this.gather.u('powerFlame'),powerFlame);
      gl.uniform3fv(this.gather.u('flameTint'),tint);
      gl.uniform1f(this.gather.u('tintStrength'),tintStrength);
      gl.drawArrays(gl.TRIANGLES,0,3);
      for(let i=1;i<this.levels.length;i++) {
        const from=this.levels[i-1],to=this.levels[i];begin(this.reduce,to);
        bind(this.reduce,'energyTex',from.textures[0],0);bind(this.reduce,'momentTex',from.textures[1],1);
        gl.uniform4i(this.reduce.u('inputGrid'),from.x,from.y,from.z,from.tx);
        gl.uniform4i(this.reduce.u('outputGrid'),to.x,to.y,to.z,to.tx);
        gl.drawArrays(gl.TRIANGLES,0,3);
      }
      if(!shadeRoom){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);return;}
      const lightingPass=(program,target,bounce)=>{
        begin(program,target);
        bind(program,'roomPowerTex',this.levels[4].textures[0],0);
        bind(program,'roomMomentTex',this.levels[4].textures[1],1);
        bind(program,'densityTex',this.levels[0].textures[2],2);
        // A sampler must never alias the framebuffer being written.
        bind(program,'directReceiverTex',bounce?this.receivers.textures[0]:this.levels[0].textures[2],3);
        window.SceneLights.bind(gl,program.u,roomVisible);
        gl.uniform1f(program.u('fireLightGain'),fireLightGain);
        gl.uniform1f(program.u('includeBounce'),bounce?1:0);
        gl.drawArrays(gl.TRIANGLES,0,3);
      };
      const bounce=roomVisible&&window.SceneLights.bounce>0;
      if(roomVisible)lightingPass(this.lightReceivers,this.receivers,false);
      lightingPass(this.illuminate,this.illumination,bounce);
      if(bounce)lightingPass(this.lightReceivers,this.bouncedReceivers,true);
      this.receiverTexture=(bounce?this.bouncedReceivers:this.receivers).textures[0];
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,null);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);
    }
    bind(program,uniform) {
      const gl=this.gl;
      gl.uniform1f(uniform(program,'fireLightGain'),this.fireLightGain??1);
      for(const [name,texture,unit] of [['roomPowerTex',this.levels[4].textures[0],9],['roomMomentTex',this.levels[4].textures[1],10],['roomSmokeTex',this.illumination.textures[0],11],['roomReceiverTex',this.receiverTexture,12]]) {
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniform(program,name),unit);
      }
    }
    static setup(gl,options){return new FireRoom(gl,options);}
  }
  window.FireRoom=FireRoom;
};
window.createFireRoom();
