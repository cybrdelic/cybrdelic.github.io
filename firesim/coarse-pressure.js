/* Coarse, GPU-resident pressure projection for the live fire volume.
 *
 * The full-resolution velocity field is sampled only to form divergence.
 * Jacobi iterations run on a 128 x 72 x 8 atlas; no volume is read back to JS.
 * The correction texture stores normalized velocity (domain fractions/second),
 * ready to add to vf.xyz at the start of the next fire simulation step.
 *
 * Usage:
 *   const pressure = CoarsePressure.setup(gl, {
 *     nx: 896, nz: 504, depth: 32, tilesX: 8, tilesY: 4
 *   });
 *   // Append pressure.samplingGLSL to the fire simulation fragment shader.
 *   // It declares pressureCorrectionTex and samplePressureCorrection(vec3 p).
 *   pressure.update(currentVelocityTexture);
 *   bind(pressure.getCorrection(), textureUnit, pressureUniform);
 *   oldVF.xyz += samplePressureCorrection(at);
 *   vf.xyz += samplePressureCorrection(back);
 *
 * update() changes WebGL program, VAO, framebuffer, viewport and texture-unit
 * bindings. The caller should bind its own state again before the next draw.
 */
(() => {
  'use strict';

  const VERTEX = `#version 300 es
  precision highp float;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const finitePositive = (n, name) => {
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}`);
    return n;
  };

  class Projector {
    constructor(gl, options = {}) {
      if (!gl || typeof gl.createFramebuffer !== 'function') throw new Error('WebGL 2 context required');
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float required');
      this.gl = gl;
      this.nx = options.nx ?? 512;
      this.nz = options.nz ?? 288;
      this.depth = options.depth ?? 24;
      this.tilesX = options.tilesX ?? 6;
      this.tilesY = options.tilesY ?? 4;
      this.cx = options.coarseX ?? 128;
      this.cz = options.coarseZ ?? 72;
      this.cy = options.coarseDepth ?? 8;
      this.coarseTilesX = options.coarseTilesX ?? 4;
      this.coarseTilesY = Math.ceil(this.cy / this.coarseTilesX);
      this.iterations = options.iterations ?? 18;
      this.worldX = finitePositive(options.worldX ?? 14, 'worldX');
      this.worldZ = finitePositive(options.worldZ ?? 7.875, 'worldZ');
      this.worldY = finitePositive(options.worldY ?? 1.2, 'worldY');
      for (const [name, value] of Object.entries({
        nx: this.nx, nz: this.nz, depth: this.depth, tilesX: this.tilesX,
        tilesY: this.tilesY, coarseX: this.cx, coarseZ: this.cz,
        coarseDepth: this.cy, coarseTilesX: this.coarseTilesX,
        iterations: this.iterations
      })) {
        if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
      }
      if (this.depth > this.tilesX * this.tilesY || this.cy < 3 || this.cx < 3 || this.cz < 3) {
        throw new Error('Invalid volume atlas dimensions');
      }
      this.atlasWidth = this.cx * this.coarseTilesX;
      this.atlasHeight = this.cz * this.coarseTilesY;
      if (this.atlasWidth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || this.atlasHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        throw new Error('Coarse pressure atlas exceeds MAX_TEXTURE_SIZE');
      }
      // Only the RGBA16F correction is linearly sampled. Half-float filtering
      // is core WebGL2; R32F pressure/divergence remain NEAREST/texelFetch.
      this.linearFloat = true;
      this.packedCorrection = false;
      this.vao = gl.createVertexArray();
      this.targets = [];
      this.programs = [];
      this.samplingGLSL = this.makeSamplingGLSL();
      try {
        this.init();
        this.reset();
      } catch (error) {
        this.dispose();
        throw error;
      }
    }

    static setup(gl, options) { return new Projector(gl, options); }

    shader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader) || 'shader compilation failed';
        gl.deleteShader(shader);
        throw new Error(`Coarse pressure: ${error}`);
      }
      return shader;
    }

    program(fragment) {
      const gl = this.gl;
      const vertex = this.shader(gl.VERTEX_SHADER, VERTEX);
      const frag = this.shader(gl.FRAGMENT_SHADER, fragment);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, frag);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(frag);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program) || 'program link failed';
        gl.deleteProgram(program);
        throw new Error(`Coarse pressure: ${error}`);
      }
      this.programs.push(program);
      return program;
    }

    target(internal, format, type, filter) {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.atlasWidth, this.atlasHeight, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(texture);
        throw new Error('Coarse pressure framebuffer incomplete');
      }
      const result = { texture, fbo };
      this.targets.push(result);
      return result;
    }

    init() {
      const gl = this.gl;
      const common = `
      precision highp float;
      precision highp int;
      precision highp sampler2D;
      const int CX=${this.cx}, CZ=${this.cz}, CY=${this.cy};
      const int CTX=${this.coarseTilesX};
      const int FNX=${this.nx}, FNZ=${this.nz}, FD=${this.depth};
      const int FTX=${this.tilesX};
      const float HX=${(this.worldX / (this.cx - 1)).toPrecision(12)};
      const float HZ=${(this.worldZ / (this.cz - 1)).toPrecision(12)};
      const float HY=${(this.worldY / (this.cy - 1)).toPrecision(12)};
      const vec3 WORLD=vec3(${this.worldX.toPrecision(12)},${this.worldZ.toPrecision(12)},${this.worldY.toPrecision(12)});
      ivec3 cell() {
        ivec2 a=ivec2(gl_FragCoord.xy);
        return ivec3(a.x%CX,a.y%CZ,a.x/CX+CTX*(a.y/CZ));
      }
      ivec2 atlasCell(ivec3 c) {
        return ivec2((c.z%CTX)*CX+c.x,(c.z/CTX)*CZ+c.y);
      }
      bool inside(ivec3 c) {
        return all(greaterThanEqual(c,ivec3(0))) && all(lessThan(c,ivec3(CX,CZ,CY)));
      }
      bool edge(ivec3 c) {
        return c.x==0 || c.x==CX-1 || c.y==0 || c.y==CZ-1 || c.z==0 || c.z==CY-1;
      }
      `;
      const fullSample = `
      uniform sampler2D uVf;
      vec2 fullAtlasUV(vec2 p,float layer) {
        p=clamp(p,vec2(0),vec2(1));
        vec2 pixel=vec2(.5)+p*vec2(float(FNX-1),float(FNZ-1));
        float tileX=mod(layer,float(FTX)),tileY=floor(layer/float(FTX));
        return (vec2(tileX*float(FNX),tileY*float(FNZ))+pixel)/vec2(float(FNX*${this.tilesX}),float(FNZ*${this.tilesY}));
      }
      vec3 fullVelocity(vec3 p) {
        p=clamp(p,vec3(0),vec3(1));
        float z=p.z*float(FD-1),low=floor(z),high=min(float(FD-1),low+1.0);
        vec3 v=mix(texture(uVf,fullAtlasUV(p.xy,low)).xyz,
                   texture(uVf,fullAtlasUV(p.xy,high)).xyz,fract(z));
        return v*WORLD;
      }
      `;
      const divergence = `#version 300 es
      ${common}${fullSample}
      uniform float uExpansion;
      layout(location=0) out vec4 outValue;
      void main() {
        ivec3 c=cell();
        if(edge(c)){outValue=vec4(0);return;}
        vec3 p=vec3(c)/vec3(float(CX-1),float(CZ-1),float(CY-1));
        vec3 stepP=1.0/vec3(float(CX-1),float(CZ-1),float(CY-1));
        float div=(fullVelocity(p+vec3(stepP.x,0,0)).x-fullVelocity(p-vec3(stepP.x,0,0)).x)/(2.0*HX)
                 +(fullVelocity(p+vec3(0,stepP.y,0)).y-fullVelocity(p-vec3(0,stepP.y,0)).y)/(2.0*HZ)
                 +(fullVelocity(p+vec3(0,0,stepP.z)).z-fullVelocity(p-vec3(0,0,stepP.z)).z)/(2.0*HY);
        // Combustion can prescribe positive divergence. Project toward that
        // expanding flow instead of cancelling a blast back to zero divergence.
        float expansion=0.;
        if(uExpansion>0.){
          float z=p.z*float(FD-1),lo=floor(z),hi=min(lo+1.,float(FD-1));
          float reaction=mix(texture(uVf,fullAtlasUV(p.xy,lo)).a,texture(uVf,fullAtlasUV(p.xy,hi)).a,fract(z));
          expansion=min(max(reaction,0.)*uExpansion,64.);
        }
        outValue=vec4(div-expansion,0,0,1);
      }`;
      const jacobi = `#version 300 es
      ${common}
      uniform sampler2D uP;
      uniform sampler2D uDiv;
      layout(location=0) out vec4 outValue;
      float pressure(ivec3 c){return inside(c)?texelFetch(uP,atlasCell(c),0).r:0.0;}
      void main(){
        ivec3 c=cell();
        if(edge(c)){outValue=vec4(0);return;}
        float wx=1.0/(HX*HX),wz=1.0/(HZ*HZ),wy=1.0/(HY*HY);
        float div=texelFetch(uDiv,atlasCell(c),0).r;
        float sum=wx*(pressure(c+ivec3(1,0,0))+pressure(c-ivec3(1,0,0)))
                 +wz*(pressure(c+ivec3(0,1,0))+pressure(c-ivec3(0,1,0)))
                 +wy*(pressure(c+ivec3(0,0,1))+pressure(c-ivec3(0,0,1)));
        outValue=vec4((sum-div)/(2.0*(wx+wz+wy)),0,0,1);
      }`;
      const packed = this.packedCorrection;
      const correction = `#version 300 es
      ${common}
      uniform sampler2D uP;
      layout(location=0) out vec4 outValue;
      float pressure(ivec3 c){return inside(c)?texelFetch(uP,atlasCell(c),0).r:0.0;}
      void main(){
        ivec3 c=cell();
        if(edge(c)){outValue=${packed ? 'vec4(vec3(128.0/255.0),1.0)' : 'vec4(0)'};return;}
        vec3 grad=vec3((pressure(c+ivec3(1,0,0))-pressure(c-ivec3(1,0,0)))/(2.0*HX),
                       (pressure(c+ivec3(0,1,0))-pressure(c-ivec3(0,1,0)))/(2.0*HZ),
                       (pressure(c+ivec3(0,0,1))-pressure(c-ivec3(0,0,1)))/(2.0*HY));
        vec3 value=clamp(-grad/WORLD,vec3(-1),vec3(1));
        outValue=${packed ? 'vec4((value*127.0+128.0)/255.0,1.0)' : 'vec4(value,0.0)'};
      }`;
      this.divergenceProgram = this.program(divergence);
      this.jacobiProgram = this.program(jacobi);
      this.correctionProgram = this.program(correction);
      this.divergenceUniform = gl.getUniformLocation(this.divergenceProgram, 'uVf');
      this.expansionUniform = gl.getUniformLocation(this.divergenceProgram, 'uExpansion');
      this.jacobiUniforms = {
        pressure: gl.getUniformLocation(this.jacobiProgram, 'uP'),
        divergence: gl.getUniformLocation(this.jacobiProgram, 'uDiv')
      };
      this.correctionUniform = gl.getUniformLocation(this.correctionProgram, 'uP');
      this.divergence = this.target(gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST);
      this.pressures = [
        this.target(gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST),
        this.target(gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST)
      ];
      this.correction = packed
        ? this.target(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR)
        : this.target(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
      this.zero = new Float32Array([0,0,0,0]);
      this.neutral = new Float32Array(packed ? [128/255,128/255,128/255,1] : [0,0,0,0]);
    }

    makeSamplingGLSL() {
      return `
      uniform sampler2D pressureCorrectionTex;
      vec2 coarseCorrectionUV(vec2 p,float layer){
        p=clamp(p,vec2(0),vec2(1));
        vec2 pixel=vec2(.5)+p*vec2(${this.cx - 1}.0,${this.cz - 1}.0);
        float tx=mod(layer,${this.coarseTilesX}.0),ty=floor(layer/${this.coarseTilesX}.0);
        return (vec2(tx*${this.cx}.0,ty*${this.cz}.0)+pixel)/vec2(${this.atlasWidth}.0,${this.atlasHeight}.0);
      }
      vec3 samplePressureCorrection(vec3 p){
        p=clamp(p,vec3(0),vec3(1));
        float z=p.z*${this.cy - 1}.0,lo=floor(z),hi=min(${this.cy - 1}.0,lo+1.0);
        vec3 value=mix(texture(pressureCorrectionTex,coarseCorrectionUV(p.xy,lo)).xyz,
                       texture(pressureCorrectionTex,coarseCorrectionUV(p.xy,hi)).xyz,fract(z));
        return ${this.packedCorrection ? '((value*255.0-128.0)/127.0)' : 'value'};
      }
      `;
    }

    bind(texture, unit, location) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(location, unit);
    }

    reset() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.correction.fbo);
      gl.clearBufferfv(gl.COLOR, 0, this.neutral);
    }

    update(velocityTexture, expansion=0) {
      const gl = this.gl;
      if (!velocityTexture) throw new Error('Coarse pressure update needs a velocity texture');
      gl.bindVertexArray(this.vao);
      gl.viewport(0, 0, this.atlasWidth, this.atlasHeight);

      gl.useProgram(this.divergenceProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
      this.bind(velocityTexture, 0, this.divergenceUniform);
      gl.uniform1f(this.expansionUniform,expansion);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressures[0].fbo);
      gl.clearBufferfv(gl.COLOR, 0, this.zero);
      let read = 0;
      gl.useProgram(this.jacobiProgram);
      this.bind(this.divergence.texture, 1, this.jacobiUniforms.divergence);
      for (let i=0; i<this.iterations; i++) {
        const write = 1-read;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressures[write].fbo);
        this.bind(this.pressures[read].texture, 0, this.jacobiUniforms.pressure);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        read = write;
      }

      gl.useProgram(this.correctionProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.correction.fbo);
      this.bind(this.pressures[read].texture, 0, this.correctionUniform);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.correction.texture;
    }

    getCorrection() { return this.correction.texture; }

    getInfo() {
      return {
        dimensions: [this.cx,this.cz,this.cy],
        atlas: [this.atlasWidth,this.atlasHeight],
        iterations: this.iterations,
        packedCorrection: this.packedCorrection,
        projection: 'one-level Jacobi; coarse-scale divergence removal'
      };
    }

    dispose() {
      const gl = this.gl;
      for (const item of this.targets) {
        gl.deleteFramebuffer(item.fbo);
        gl.deleteTexture(item.texture);
      }
      for (const program of this.programs) gl.deleteProgram(program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      this.targets = [];
      this.programs = [];
    }
  }

  window.CoarsePressure = { setup: (gl, options) => new Projector(gl, options) };
})();
