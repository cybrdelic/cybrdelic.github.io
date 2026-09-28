/* Preserve resolved rolls in the live velocity field. The two passes measure
 * curl and its magnitude gradient; neither pass adds image-space texture.
 * Velocities are converted to world units before spatial derivatives.
 */
(() => {
  'use strict';
  window.FireVorticity = {
    setup(gl, {nx, nz, depth, tilesX}) {
      // Follow the source and rising wake at finer spatial spacing instead of
      // evaluating an almost empty full-domain volume every step.
      const vx = 192, vy = 144, vz = window.FireDomain?.blast?32:16, tx = 4;
      const width = vx * tx, height = vy * Math.ceil(vz / tx);
      const vertex = `#version 300 es
        void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;
      const grid = `
        precision highp float;
        precision highp sampler2D;
        const vec3 extent=${window.FireDomain?.extentGLSL||"vec3(14.,7.875,1.8)"};
        uniform vec3 span;
        #define h (extent*span/vec3(${vx}.,${vy}.,${vz-1}.))
        const vec3 cell=vec3(1./${vx}.,1./${vy}.,1./${vz-1}.);
        vec3 position(){
          ivec2 ip=ivec2(gl_FragCoord.xy);
          return vec3((vec2(ip.x%${vx},ip.y%${vy})+.5)/vec2(${vx}.,${vy}.),
                      float(ip.x/${vx}+${tx}*(ip.y/${vy}))/float(${vz-1}));
        }
        vec2 smallUV(vec2 p,float z){
          p=clamp(p,vec2(.5/${vx}.,.5/${vy}.),vec2(1.-.5/${vx}.,1.-.5/${vy}.));
          return (vec2(mod(z,${tx}.)*${vx}.,floor(z/${tx}.)*${vy}.)+p*vec2(${vx}.,${vy}.))/vec2(${width}.,${height}.);
        }
        vec4 sampleSmall(sampler2D t,vec3 p){
          float z=clamp(p.z,0.,1.)*${vz-1}.,lo=floor(z);
          return mix(texture(t,smallUV(p.xy,lo)),texture(t,smallUV(p.xy,min(lo+1.,${vz-1}.))),fract(z));
        }`;
      const curlSource = `#version 300 es
        ${grid}
        uniform sampler2D velocity;
        uniform sampler2D chemistry;
        uniform vec3 sourceOrigin;
        out vec4 result;
        vec2 sourceUV(vec2 p,float z){
          p=clamp(p,vec2(.5/${nx}.,.5/${nz}.),vec2(1.-.5/${nx}.,1.-.5/${nz}.));
          return (vec2(mod(z,${tilesX}.)*${nx}.,floor(z/${tilesX}.)*${nz}.)+p*vec2(${nx}.,${nz}.))/vec2(${nx*tilesX}.,${nz*Math.ceil(depth/tilesX)}.);
        }
        vec3 velocityAt(vec3 p){
          float z=clamp(p.z,0.,1.)*${depth-1}.,lo=floor(z);
          return mix(texture(velocity,sourceUV(p.xy,lo)).xyz,
                     texture(velocity,sourceUV(p.xy,min(lo+1.,${depth-1}.))).xyz,fract(z))*extent;
        }
        void main(){
          vec3 p=sourceOrigin+position()*span;
          // Cold, empty space needs no confinement. Keep all warm gas and its
          // soot wake; derivatives still sample the surrounding velocity.
          float slice=p.z*${depth-1}.,lo=floor(slice);
          vec4 chem=mix(texture(chemistry,sourceUV(p.xy,lo)),
                        texture(chemistry,sourceUV(p.xy,min(lo+1.,${depth-1}.))),fract(slice));
          if(chem.b+chem.a<.002){result=vec4(0);return;}
          vec3 dx=(velocityAt(p+vec3(cell.x*span.x,0,0))-velocityAt(p-vec3(cell.x*span.x,0,0)))/(2.*h.x);
          vec3 dy=(velocityAt(p+vec3(0,cell.y*span.y,0))-velocityAt(p-vec3(0,cell.y*span.y,0)))/(2.*h.y);
          vec3 dz=(velocityAt(p+vec3(0,0,cell.z))-velocityAt(p-vec3(0,0,cell.z)))/(2.*h.z);
          vec3 omega=vec3(dy.z-dz.y,dz.x-dx.z,dx.y-dy.x);
          result=vec4(omega,length(omega));
        }`;
      const forceSource = `#version 300 es
        ${grid}
        uniform sampler2D curlField;
        out vec4 result;
        vec4 curlAt(ivec3 q){
          q=clamp(q,ivec3(0),ivec3(${vx-1},${vy-1},${vz-1}));
          return texelFetch(curlField,ivec2((q.z%${tx})*${vx}+q.x,(q.z/${tx})*${vy}+q.y),0);
        }
        void main(){
          vec3 p=position();
          ivec2 pixel=ivec2(gl_FragCoord.xy);
          ivec3 q=ivec3(pixel.x%${vx},pixel.y%${vy},pixel.x/${vx}+${tx}*(pixel.y/${vy}));
          vec4 curl=curlAt(q);
          if(curl.a<.00001){result=vec4(0);return;}
          vec3 grad=vec3(
            curlAt(q+ivec3(1,0,0)).a-curlAt(q-ivec3(1,0,0)).a,
            curlAt(q+ivec3(0,1,0)).a-curlAt(q-ivec3(0,1,0)).a,
            curlAt(q+ivec3(0,0,1)).a-curlAt(q-ivec3(0,0,1)).a)/(2.*h);
          vec3 normal=grad/max(length(grad),.00001);
          vec3 force=.17*cross(normal,curl.xyz);
          force*=min(1.,12./max(length(force),.00001));
          float edge=smoothstep(0.,.06,p.x)*smoothstep(0.,.06,1.-p.x)
                    *smoothstep(0.,.06,p.y)*smoothstep(0.,.06,1.-p.y)
                    *smoothstep(0.,.08,p.z)*smoothstep(0.,.08,1.-p.z);
          result=vec4(force/extent*edge,1.);
        }`;
      function program(fragment) {
        const p=gl.createProgram();
        for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
          const s=gl.createShader(kind); gl.shaderSource(s,source); gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error('Vorticity: '+gl.getShaderInfoLog(s));
          gl.attachShader(p,s); gl.deleteShader(s);
        }
        gl.linkProgram(p);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error('Vorticity: '+gl.getProgramInfoLog(p));
        return p;
      }
      function target() {
        const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.HALF_FLOAT,null);
        const fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Vorticity framebuffer incomplete');
        return {texture,fbo};
      }
      const curlProgram=program(curlSource), forceProgram=program(forceSource);
      const curl=target(), force=target();
      const velocityLocation=gl.getUniformLocation(curlProgram,'velocity');
      const chemistryLocation=gl.getUniformLocation(curlProgram,'chemistry');
      const originLocation=gl.getUniformLocation(curlProgram,'sourceOrigin');
      const curlSpanLocation=gl.getUniformLocation(curlProgram,'span');
      const forceSpanLocation=gl.getUniformLocation(forceProgram,'span');
      const curlLocation=gl.getUniformLocation(forceProgram,'curlField');
      const origin=new Float32Array(3),span=new Float32Array(3);
      return {
        samplingGLSL: `
          uniform sampler2D vortexTex;
          uniform vec3 vortexOrigin;
          uniform vec3 vortexSpan;
          vec2 vortexUV(vec2 p,float z){
            p=clamp(p,vec2(.5/${vx}.,.5/${vy}.),vec2(1.-.5/${vx}.,1.-.5/${vy}.));
            return (vec2(mod(z,${tx}.)*${vx}.,floor(z/${tx}.)*${vy}.)+p*vec2(${vx}.,${vy}.))/vec2(${width}.,${height}.);
          }
          vec3 vortexForce(vec3 p){
            p=(p-vortexOrigin)/vortexSpan;
            if(any(lessThan(p,vec3(0)))||any(greaterThan(p,vec3(1))))return vec3(0);
            float z=clamp(p.z,0.,1.)*${vz-1}.,lo=floor(z);
            return mix(texture(vortexTex,vortexUV(p.xy,lo)).xyz,
                       texture(vortexTex,vortexUV(p.xy,min(lo+1.,${vz-1}.))).xyz,fract(z));
          }`,
        texture:force.texture,
        origin,span,
        update(velocity,chemistry,source,freeMode,burst=false) {
          origin[0]=freeMode?source.x-2./14:0; origin[1]=freeMode?source.y-.45/7.875:0; origin[2]=0;
          span.set(freeMode?[4./14,5.6/7.875,1]:[1,1,1]);
          if(burst){const e=window.FireDomain.extent;origin[0]=source.x-3./e[0];origin[1]=source.y-1.4/e[1];span.set([6./e[0],6.5/e[1],1]);}
          gl.viewport(0,0,width,height);
          gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D,null);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,chemistry);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,velocity);
          gl.useProgram(curlProgram); gl.uniform1i(velocityLocation,0);
          gl.uniform3fv(curlSpanLocation,span);
          gl.uniform1i(chemistryLocation,1);
          gl.uniform3fv(originLocation,origin);
          gl.bindFramebuffer(gl.FRAMEBUFFER,curl.fbo); gl.drawArrays(gl.TRIANGLES,0,3);
          gl.bindTexture(gl.TEXTURE_2D,curl.texture);
          gl.useProgram(forceProgram); gl.uniform1i(curlLocation,0);
          gl.uniform3fv(forceSpanLocation,span);
          gl.bindFramebuffer(gl.FRAMEBUFFER,force.fbo); gl.drawArrays(gl.TRIANGLES,0,3);
        }
      };
    }
  };
})();
