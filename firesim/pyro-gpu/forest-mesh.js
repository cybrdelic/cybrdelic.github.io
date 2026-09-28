// The reviewed forest-surface asset is rasterized at its original topology.
// A separate 64³ fuel/collision proxy is used by the fluid solver.
import { SOURCE_SCALE, SOURCE_CENTER } from './objects/forest-tree/source-space.js?v=studio-rc-3';
export const forestMeshWGSL = `
struct View{eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,options:vec4f,ambient:vec4f,spotPos0:vec4f,spotDir0:vec4f,spotPower0:vec4f,spotPos1:vec4f,spotDir1:vec4f,spotPower1:vec4f};
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(2) var<uniform> cam:View;
@group(0) @binding(12) var skin:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(15) var damage:texture_3d<f32>;
@group(0) @binding(20) var bark:texture_2d<f32>;
@group(0) @binding(21) var repeatSampler:sampler;
@group(0) @binding(22) var micro:texture_2d<f32>;
@group(0) @binding(23) var clampSampler:sampler;
struct Out{@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) local:vec3f,@location(4) material:f32};
@vertex fn vertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,@location(3) material:f32)->Out{
 let at=clamp((p+1.5)/3.,vec3f(0),vec3f(1));let s=textureSampleLevel(skin,clampSampler,at,0);let d=textureSampleLevel(damage,clampSampler,at,0);
 let fissure=1.-smoothstep(.3,.58,textureSampleLevel(micro,repeatSampler,uv,0).r);
 // Char recession and opening of the existing bark fracture field. There is
 // no clock-driven damage mask: both require local heat and fuel consumption.
 let erosion=select(s.w*.004+d.z*fissure*.0025,0.,material>7.5);
 let local=p-n*erosion;
 let world=object.origin.xyz+local*object.origin.w;let relative=world-cam.eye.xyz;let z=dot(relative,cam.forward.xyz);
 var o:Out;o.clip=vec4f(dot(relative,cam.right.xyz)/(cam.eye.w*(16./9.)),dot(relative,cam.up.xyz)/cam.eye.w,z*100./99.95-.05*100./99.95,z);
 o.world=world;o.normal=n;o.uv=uv;o.local=p;o.material=material;return o;
}
struct GBuffer{@location(0) position:vec4f,@location(1) normal:vec4f,@location(2) color:vec4f};
@fragment fn fragment(v:Out,@builtin(front_facing) front:bool)->GBuffer{
 let at=clamp((v.local+1.5)/3.,vec3f(0),vec3f(1));let s=textureSampleLevel(skin,clampSampler,at,0);let d=textureSampleLevel(damage,clampSampler,at,0);
 var normal=normalize(v.normal)*select(-1.,1.,front);
 var uv=v.uv;var color=textureSample(bark,repeatSampler,uv).rgb;
 // Root texture coordinates match the source's three-direction projection.
 let source=v.local/${SOURCE_SCALE}+vec3f(${SOURCE_CENTER[0]},${SOURCE_CENTER[2]},${SOURCE_CENTER[1]});let rootMix=clamp(1.25-source.y,0.,1.);
 let weights=pow(abs(normal),vec3f(4));let w=weights/max(dot(weights,vec3f(1)),.0001);
 let planar=textureSample(bark,repeatSampler,source.zy*vec2f(1,.5)).rgb*w.x+textureSample(bark,repeatSampler,source.xz).rgb*w.y+textureSample(bark,repeatSampler,source.xy*vec2f(1,.5)).rgb*w.z;
 color=mix(color,planar,rootMix);
 let height=textureSample(micro,repeatSampler,uv).r;
 let px=dpdx(v.world);let py=dpdy(v.world);let r1=cross(py,normal);let r2=cross(normal,px);let det=dot(px,r1);
 normal=normalize(abs(det)*normal-sign(det)*.005*(dpdx(height)*r1+dpdy(height)*r2));
 var crack=(1.-smoothstep(.32,.58,height))*d.z;
 if(v.material>7.5){
  normal=normalize(v.normal)*select(-1.,1.,front);
  // Thin leaves dry to brown, then their edges recede as local fuel is lost.
  let edge=min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y));
  if(s.w>.82||edge<s.w*.16){discard;}
  color=mix(vec3f(.033,.11,.013),vec3f(.15,.07,.018),clamp(smoothstep(.18,.5,d.y)*(1.-d.x)+s.w,0.,1.));crack=0.;
 }
 color=mix(color,vec3f(.017,.013,.01),clamp(s.w*1.8,0.,1.));color*=1.-.75*crack;
 var o:GBuffer;o.position=vec4f(v.world,1);o.normal=vec4f(normal,clamp(s.y,0.,8.));o.color=vec4f(color,crack);return o;
}`;

export const forestShadowWGSL =
  forestMeshWGSL.split('struct GBuffer')[0].replace('cam.eye.w*(16./9.)', 'cam.eye.w') +
  `
@fragment fn shadowFragment(v:Out){
 if(v.material>7.5){let s=textureSampleLevel(skin,clampSampler,clamp((v.local+1.5)/3.,vec3f(0),vec3f(1)),0);let edge=min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y));if(s.w>.82||edge<s.w*.16){discard;}}
}`;

export class ForestMesh {
  constructor(solver) {
    this.s = solver;
    this.resources = [];
    const d = solver.device;
    this.targets = ['rgba16float', 'rgba16float', 'rgba8unorm'].map((format) => {
      const t = d.createTexture({
        size: [solver.canvas.width, solver.canvas.height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.resources.push(t);
      return { view: t.createView() };
    });
    const depth = d.createTexture({
      size: [solver.canvas.width, solver.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.resources.push(depth);
    this.depth = depth.createView();
    const shadow = d.createTexture({
      size: [1024, 1024, 2],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.resources.push(shadow);
    this.shadow = { view: shadow.createView({ dimension: '2d-array' }) };
    this.shadowViews = [0, 1].map((baseArrayLayer) =>
      shadow.createView({ dimension: '2d', baseArrayLayer, arrayLayerCount: 1 }),
    );
    this.compare = d.createSampler({
      compare: 'less-equal',
      minFilter: 'linear',
      magFilter: 'linear',
    });
    this.shadowCameras = [0, 1].map(() =>
      d.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    );
    this.resources.push(...this.shadowCameras);
  }
  async load() {
    if (this.ready) return;
    if (this.loading) return this.loading;
    this.loading = this.build();
    return this.loading;
  }
  async build() {
    const s = this.s,
      d = s.device,
      base = new URL('./objects/forest-tree/', import.meta.url);
    const get = async (name) => {
      const r = await fetch(new URL(name, base));
      if (!r.ok) throw Error('Reviewed tree asset unavailable: ' + name);
      return r;
    };
    this.manifest = await (await get('manifest.json')).json();
    const buffer = async (name, usage) => {
      const bytes = await (await get(name)).arrayBuffer();
      if (bytes.byteLength !== this.manifest.files[name].bytes)
        throw Error('Incomplete tree asset: ' + name);
      const b = d.createBuffer({ size: bytes.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, bytes);
      this.resources.push(b);
      return b;
    };
    this.vertices = await buffer('vertices.bin', GPUBufferUsage.VERTEX);
    this.indices = await buffer('indices.bin', GPUBufferUsage.INDEX);
    const texture = async (name, format) => {
      const bitmap = await createImageBitmap(await (await get(name)).blob(), {
        colorSpaceConversion: 'none',
        imageOrientation: 'flipY',
      });
      const t = d.createTexture({
        size: [bitmap.width, bitmap.height],
        format,
        usage:
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      d.queue.copyExternalImageToTexture({ source: bitmap }, { texture: t }, [
        bitmap.width,
        bitmap.height,
      ]);
      bitmap.close();
      this.resources.push(t);
      return { view: t.createView() };
    };
    this.bark = await texture('bark-color.png', 'rgba8unorm-srgb');
    this.micro = await texture('bark-micro.png', 'rgba8unorm');
    this.repeat = d.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });
    const module = d.createShaderModule({ code: forestMeshWGSL, label: 'reviewed-forest-mesh' });
    this.pipeline = await d.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vertex',
        buffers: [
          {
            arrayStride: 36,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fragment',
        targets: ['rgba16float', 'rgba16float', 'rgba8unorm'].map((format) => ({ format })),
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const shadowModule = d.createShaderModule({ code: forestShadowWGSL });
    this.shadowPipeline = await d.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module: shadowModule,
        entryPoint: 'vertex',
        buffers: [
          {
            arrayStride: 36,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
              { shaderLocation: 3, offset: 32, format: 'float32' },
            ],
          },
        ],
      },
      fragment: { module: shadowModule, entryPoint: 'shadowFragment', targets: [] },
      primitive: { cullMode: 'none' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 1,
        depthBiasSlopeScale: 1,
      },
    });
    this.ready = true;
  }
  shadows(encoder) {
    const s = this.s,
      d = s.device;
    for (let i = 0; i < 2; i++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowViews[i],
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      if (
        s.objectId === 'cybr-tree' &&
        this.ready &&
        s.cameraValues.slice(32 + i * 12, 35 + i * 12).some((x) => x > 0)
      ) {
        const v = s.cameraValues,
          base = 24 + i * 12,
          forward = Array.from(v.slice(base + 4, base + 7)),
          normalize = (a) => {
            const l = Math.hypot(...a);
            return a.map((x) => x / l);
          },
          cross = (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ];
        const right = normalize(cross(forward, [0, 1, 0])),
          up = cross(right, forward),
          tan = Math.tan(Math.acos(v[base + 7]));
        d.queue.writeBuffer(
          this.shadowCameras[i],
          0,
          new Float32Array([...v.slice(base, base + 3), tan, ...right, 0, ...up, 0, ...forward, 0]),
        );
        pass.setPipeline(this.shadowPipeline);
        pass.setBindGroup(
          0,
          s.group(this.shadowPipeline, [
            [2, { buffer: this.shadowCameras[i] }],
            [12, s.surface[s.si]],
            [13, { buffer: s.objectSettings }],
            [15, s.damage[s.si]],
            [21, this.repeat],
            [22, this.micro],
            [23, s.sampler],
          ]),
        );
        pass.setVertexBuffer(0, this.vertices);
        pass.setIndexBuffer(this.indices, 'uint32');
        pass.drawIndexed(this.manifest.triangles * 3);
      }
      pass.end();
    }
  }
  render(encoder) {
    const s = this.s;
    const pass = encoder.beginRenderPass({
      colorAttachments: this.targets.map((t) => ({
        view: t.view,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      })),
      depthStencilAttachment: {
        view: this.depth,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    if (s.objectId === 'cybr-tree' && this.ready) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(
        0,
        s.group(this.pipeline, [
          [2, { buffer: s.view }],
          [12, s.surface[s.si]],
          [13, { buffer: s.objectSettings }],
          [15, s.damage[s.si]],
          [20, this.bark],
          [21, this.repeat],
          [22, this.micro],
          [23, s.sampler],
        ]),
      );
      pass.setVertexBuffer(0, this.vertices);
      pass.setIndexBuffer(this.indices, 'uint32');
      pass.drawIndexed(this.manifest.triangles * 3);
    }
    pass.end();
  }
  destroy() {
    for (const resource of this.resources) resource.destroy();
    this.resources = [];
    this.ready = false;
  }
  bindings() {
    return this.targets.map((t, i) => [18 + i, t]);
  }
  shadowBindings() {
    return [
      [23, this.shadow],
      [24, this.compare],
    ];
  }
}
