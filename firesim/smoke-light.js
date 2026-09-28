/* Realtime soot optical depth toward an overhead light. The small light grid
 * never transports simulation state: fuel, heat and soot retain full resolution.
 * A parallel prefix sum integrates all cells above each point in seven passes. */
(() => {
  'use strict';
  class SmokeLight {
    constructor(gl, {nx, nz, depth, tilesX}) {
      this.gl=gl;
      const width=128, height=72, aw=width*tilesX, ah=height*Math.ceil(depth/tilesX);
      this.size=[aw,ah];
      const vertex=`#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
      const common=`#version 300 es
      precision highp float;
      precision highp sampler2D;
      uniform sampler2D source;
      layout(location=0) out float opticalDepth;
      `;
      const compile=fragment=>{
        const p=gl.createProgram();
        for(const [type,code] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
          const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(p,s);gl.deleteShader(s);
        }
        gl.linkProgram(p);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        return {p,source:gl.getUniformLocation(p,'source'),stride:gl.getUniformLocation(p,'stride')};
      };
      this.gather=compile(common+window.FireOptics+`
      void main(){
        ivec2 ip=ivec2(gl_FragCoord.xy),tile=ip/ivec2(128,72);
        vec2 p=(vec2(ip%ivec2(128,72))+.5)/vec2(128.,72.);
        vec2 sourceSize=vec2(${nx}.0,${nz}.0);
        vec2 base=vec2(tile)*sourceSize;
        vec2 atlas=sourceSize*vec2(${tilesX}.0,${Math.ceil(depth/tilesX)}.0);
        // Four quadrature samples preserve thin wisps in the illumination grid.
        float density=0.;
        for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
          vec2 q=clamp(p+(vec2(x,y)-.5)*.5/vec2(128.,72.),.5/sourceSize,1.-.5/sourceSize);
          density+=texture(source,(base+q*sourceSize)/atlas).a;
        }
        opticalDepth=sootExtinction(density*.25)*(fireExtent.y/72.);
      }`);
      this.sum=compile(common+`
      uniform int stride;
      void main(){
        ivec2 ip=ivec2(gl_FragCoord.xy);
        float tau=texelFetch(source,ip,0).r;
        if(ip.y%72+stride<72) tau+=texelFetch(source,ip+ivec2(0,stride),0).r;
        opticalDepth=tau;
      }`);
      this.targets=[0,1].map(()=>{
        const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,aw,ah,0,gl.RED,gl.HALF_FLOAT,null);
        const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw Error('Smoke light framebuffer incomplete');
        return {tex,fbo};
      });
      this.texture=this.targets[1].tex;
    }
    update(chem) {
      const gl=this.gl;
      const pass=(program,source,target,stride)=>{
        gl.useProgram(program.p);gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);
        gl.viewport(0,0,...this.size);gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(program.source,8);
        if(program.stride!==null) gl.uniform1i(program.stride,stride);
        gl.drawArrays(gl.TRIANGLES,0,3);
      };
      pass(this.gather,chem,this.targets[0],0);
      let current=0;
      for(let stride=1;stride<72;stride*=2) {
        pass(this.sum,this.targets[current].tex,this.targets[1-current],stride);
        current=1-current;
      }
      this.texture=this.targets[current].tex;
      gl.bindTexture(gl.TEXTURE_2D,null);
    }
    static setup(gl,options) {return new SmokeLight(gl,options);}
  }
  window.SmokeLight=SmokeLight;
})();
