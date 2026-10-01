/* MacCormack scalar transport for live Fire.
 *
 * Loaded by index.html. It adds one RGBA16F atlas
 * and one predictor draw per simulation step. The corrector and eight-corner
 * local extrema limiter run inside the existing fire simulation draw. The
 * source, chemistry, velocity forces, pressure solve, and renderer stay live.
 *
 * See corrected-advection.md for the algorithm and benchmark. No animation
 * frames or precomputed motion are read by this module.
 */
(() => {
  'use strict';

  const VERTEX = `#version 300 es
  precision highp float;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  class MacCormackAdvection {
    constructor(gl, options) {
      if (!gl || typeof gl.createFramebuffer !== 'function') throw new Error('WebGL 2 required');
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float required');
      // These predictor/scalar targets are RGBA16F. Linear half-float sampling
      // is core WebGL2; the optional OES_texture_float_linear extension only
      // controls 32-bit float formats, which this transport never samples.
      const { nx, nz, depth, tilesX, tilesY, pressureSamplingGLSL } = options || {};
      for (const [name, value] of Object.entries({ nx, nz, depth, tilesX, tilesY })) {
        if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
      }
      if (depth > tilesX * tilesY || typeof pressureSamplingGLSL !== 'string') {
        throw new Error('Invalid volume atlas or pressure shader');
      }
      this.gl = gl;
      this.nx = nx;
      this.nz = nz;
      this.depth = depth;
      this.tilesX = tilesX;
      this.tilesY = tilesY;
      this.width = nx * tilesX;
      this.height = nz * tilesY;
      if (this.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || this.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        throw new Error('MacCormack atlas exceeds MAX_TEXTURE_SIZE');
      }
      this.vao = null;
      this.predictor = null;
      this.fbo = null;
      this.program = null;
      this.correctionGLSL = this.makeCorrectionGLSL();
      try {
        this.init(pressureSamplingGLSL);
      } catch (error) {
        this.dispose();
        throw error;
      }
    }

    static setup(gl, options) { return new MacCormackAdvection(gl, options); }

    makeCommonGLSL() {
      const { nx, nz, depth, tilesX, width, height } = this;
      return `
      precision highp float;
      precision highp int;
      precision highp sampler2D;
      const int MC_NX=${nx}, MC_NZ=${nz}, MC_DEPTH=${depth}, MC_TILES_X=${tilesX};
      const float MC_NXf=${nx}.0, MC_NZf=${nz}.0, MC_DEPTHf=${depth}.0;
      const vec2 MC_ATLAS_SIZE=vec2(${width}.0,${height}.0);
      vec2 mcAtlasUV(vec2 p,float z) {
        p=clamp(p,vec2(.5/MC_NXf,.5/MC_NZf),vec2(1.0-.5/MC_NXf,1.0-.5/MC_NZf));
        return (vec2(mod(z,float(MC_TILES_X))*MC_NXf,floor(z/float(MC_TILES_X))*MC_NZf)
                +p*vec2(MC_NXf,MC_NZf))/MC_ATLAS_SIZE;
      }
      vec4 mcField(sampler2D tex,vec3 p) {
        p=clamp(p,vec3(0.0),vec3(1.0));
        float z=p.z*(MC_DEPTHf-1.0),lo=floor(z),hi=min(MC_DEPTHf-1.0,lo+1.0);
        return mix(texture(tex,mcAtlasUV(p.xy,lo)),
                   texture(tex,mcAtlasUV(p.xy,hi)),fract(z));
      }
      `;
    }

    makePredictorFragment(pressureSamplingGLSL) {
      const { nx, nz, depth, tilesX } = this;
      return `#version 300 es
      ${this.makeCommonGLSL()}
      ${pressureSamplingGLSL}
      uniform sampler2D vfTex;
      uniform sampler2D chemTex;
      uniform float delta;
      layout(location=0) out vec4 outScalars;
      void main() {
        ivec2 ip=ivec2(gl_FragCoord.xy);
        int slice=ip.x/${nx}+${tilesX}*(ip.y/${nz});
        vec2 xy=(vec2(ip.x%${nx},ip.y%${nz})+.5)/vec2(MC_NXf,MC_NZf);
        vec3 at=vec3(xy,float(slice)/float(${depth - 1}));
        vec3 velocity=texelFetch(vfTex,ip,0).xyz+samplePressureCorrection(at);
        vec3 back=at-velocity*delta;
        // Fuel, oxygen, temperature and soot are co-located. Velocity is only
        // needed at the arrival cell to construct the backtrace.
        outScalars=mcField(chemTex,back);
      }`;
    }

    makeCorrectionGLSL() {
      // This snippet expects shared vfTex, chemTex, and delta uniforms in fire.js.
      // The limiter uses exactly the 2x2x2 source cells around the departure point.
      const { nx, nz, depth, tilesX } = this;
      return `
      uniform sampler2D mcPredictorTex;
      const int MC_NX=${nx}, MC_NZ=${nz}, MC_DEPTH=${depth}, MC_TILES_X=${tilesX};
      const float MC_NXf=${nx}.0, MC_NZf=${nz}.0, MC_DEPTHf=${depth}.0;
      const vec2 MC_ATLAS_SIZE=vec2(${this.width}.0,${this.height}.0);
      vec2 mcAtlasUV(vec2 p,float z) {
        p=clamp(p,vec2(.5/MC_NXf,.5/MC_NZf),vec2(1.0-.5/MC_NXf,1.0-.5/MC_NZf));
        return (vec2(mod(z,float(MC_TILES_X))*MC_NXf,floor(z/float(MC_TILES_X))*MC_NZf)
                +p*vec2(MC_NXf,MC_NZf))/MC_ATLAS_SIZE;
      }
      vec4 mcField(sampler2D tex,vec3 p) {
        p=clamp(p,vec3(0.0),vec3(1.0));
        float z=p.z*(MC_DEPTHf-1.0),lo=floor(z),hi=min(MC_DEPTHf-1.0,lo+1.0);
        return mix(texture(tex,mcAtlasUV(p.xy,lo)),
                   texture(tex,mcAtlasUV(p.xy,hi)),fract(z));
      }
      ivec2 mcAtlasCell(ivec3 c) {
        return ivec2((c.z%MC_TILES_X)*MC_NX+c.x,(c.z/MC_TILES_X)*MC_NZ+c.y);
      }
      vec4 mcOldScalars(ivec3 c) {
        ivec2 cell=mcAtlasCell(c);
        return texelFetch(chemTex,cell,0);
      }
      vec4 maccormackScalars(vec3 at,vec3 back,vec3 correctedVelocity,bool revertOvershoot) {
        ivec2 ip=ivec2(gl_FragCoord.xy);
        vec4 predicted=texelFetch(mcPredictorTex,ip,0);
        vec4 old=texelFetch(chemTex,ip,0);
        // Ambient cells need no reverse sample or eight-corner limiter.
        if (predicted.r<=0.0 && predicted.b<=0.0 && predicted.a<=0.0 && predicted.g>=1.0 &&
            old.r<=0.0 && old.b<=0.0 && old.a<=0.0 && old.g>=1.0) {
          return vec4(0.0,1.0,0.0,0.0);
        }
        vec4 reverse=mcField(mcPredictorTex,at+correctedVelocity*delta);
        vec4 corrected=predicted+.5*(old-reverse);

        vec3 q=clamp(back,vec3(0.0),vec3(1.0));
        ivec3 lo=ivec3(floor(vec3(q.xy*vec2(MC_NXf,MC_NZf)-.5,q.z*(MC_DEPTHf-1.0))));
        lo=clamp(lo,ivec3(0),ivec3(MC_NX-1,MC_NZ-1,MC_DEPTH-1));
        ivec3 hi=min(lo+ivec3(1),ivec3(MC_NX-1,MC_NZ-1,MC_DEPTH-1));
        vec4 lower=vec4(1e20),upper=vec4(-1e20);
        for(int z=0;z<2;z++) for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
          ivec3 c=ivec3(x==0?lo.x:hi.x,y==0?lo.y:hi.y,z==0?lo.z:hi.z);
          vec4 v=mcOldScalars(c);
          lower=min(lower,v); upper=max(upper,v);
        }
        // Clamping a corrected overshoot to the donor maximum can preserve
        // bright stair-step trails. At the new presets' thin fronts use the stable
        // predictor for that step; smooth regions retain the corrected result.
        if(revertOvershoot){
          // One overshooting scalar must not discard the valid correction of
          // the other fields: that needlessly diffuses thin reaction fronts.
          corrected=mix(corrected,predicted,notEqual(clamp(corrected,lower,upper),corrected));
        }else corrected=clamp(corrected,lower,upper);
        // Fuel, O2, temperature, and soot are physical nonnegative scalars.
        return clamp(corrected,vec4(0.0),vec4(1.0,1.0,3.0,8.0));
      }
      vec4 maccormackScalars(vec3 at,vec3 back,vec3 correctedVelocity){
        return maccormackScalars(at,back,correctedVelocity,false);
      }
      `;
    }

    compile(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader) || 'shader compilation failed';
        gl.deleteShader(shader);
        throw new Error(`MacCormack: ${error}`);
      }
      return shader;
    }

    init(pressureSamplingGLSL) {
      const gl = this.gl;
      const vertex = this.compile(gl.VERTEX_SHADER, VERTEX);
      const fragment = this.compile(gl.FRAGMENT_SHADER, this.makePredictorFragment(pressureSamplingGLSL));
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program) || 'program link failed';
        gl.deleteProgram(program);
        throw new Error(`MacCormack: ${error}`);
      }
      this.program = program;
      this.uniforms = {
        vf: gl.getUniformLocation(program, 'vfTex'),
        chem: gl.getUniformLocation(program, 'chemTex'),
        pressure: gl.getUniformLocation(program, 'pressureCorrectionTex'),
        delta: gl.getUniformLocation(program, 'delta')
      };
      this.predictor = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.predictor);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.predictor, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('MacCormack predictor framebuffer incomplete');
      }
      this.vao = gl.createVertexArray();
    }

    step(vfTexture, chemTexture, pressureCorrectionTexture, delta) {
      const gl = this.gl;
      if (!vfTexture || !chemTexture || !pressureCorrectionTexture || !(delta > 0)) {
        throw new Error('MacCormack step requires state textures, pressure correction, and positive delta');
      }
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.width, this.height);
      const values = [vfTexture, chemTexture, pressureCorrectionTexture];
      const locations = [this.uniforms.vf, this.uniforms.chem, this.uniforms.pressure];
      for (let i = 0; i < values.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, values[i]);
        gl.uniform1i(locations[i], i);
      }
      gl.uniform1f(this.uniforms.delta, delta);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.predictor;
    }

    dispose() {
      const gl = this.gl;
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.predictor) gl.deleteTexture(this.predictor);
      if (this.program) gl.deleteProgram(this.program);
      this.vao = this.fbo = this.predictor = this.program = null;
    }
  }

  window.MacCormackAdvection = MacCormackAdvection;
})();
