// The reviewed forest-surface asset is rasterized at its original topology.
// A separate 64³ fuel/collision proxy is used by the fluid solver.
import { SOURCE_SCALE, SOURCE_CENTER } from './objects/forest-tree/source-space.js?v=7dfac6909b1f2622';
import { woodStateWGSL } from './objects.js?v=7dfac6909b1f2622';
import { woodMaterialWGSL } from '../wood-material.js?v=7dfac6909b1f2622';
import {woodPoseWGSL} from '../wood-structure.js?v=7dfac6909b1f2622';
export const forestMeshWGSL = `
${woodStateWGSL}
${woodMaterialWGSL}
${woodPoseWGSL()}
struct View{eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,options:vec4f,ambient:vec4f,spotPos0:vec4f,spotDir0:vec4f,spotPower0:vec4f,spotPos1:vec4f,spotDir1:vec4f,spotPower1:vec4f};
struct ObjectSettings{origin:vec4f,options:vec4f,tint:vec4f};
@group(0) @binding(2) var<uniform> cam:View;
@group(0) @binding(11) var solid:texture_3d<f32>;
@group(0) @binding(12) var skin:texture_3d<f32>;
@group(0) @binding(13) var<uniform> object:ObjectSettings;
@group(0) @binding(15) var damage:texture_3d<f32>;
@group(0) @binding(20) var bark:texture_2d<f32>;
@group(0) @binding(21) var repeatSampler:sampler;
@group(0) @binding(22) var micro:texture_2d<f32>;
@group(0) @binding(23) var clampSampler:sampler;
@group(0) @binding(26) var roughnessMap:texture_2d<f32>;
struct Out{@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) local:vec3f,@location(4) material:f32,@location(5) @interpolate(flat) owner:u32,@location(6) @interpolate(flat) other:u32};
@vertex fn vertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,@location(3) material:f32,@location(4) owner:u32,@location(5) other:u32)->Out{
 let at=clamp((p+1.5)/3.,vec3f(0),vec3f(1));let s=woodTrilinear(skin,solid,at,vec4f(1,0,0,0));let d=woodTrilinear(damage,solid,at,woodFreshWear(object.tint.w>1.5));
 let fissure=1.-smoothstep(.3,.58,textureSampleLevel(micro,repeatSampler,uv,0).r);
 // Char recession and opening of the existing bark fracture field. There is
 // no clock-driven damage mask: both require local heat and fuel consumption.
 let erosion=select((1.-s.x)*.004+d.z*fissure*.0025,0.,material>7.5&&material<8.5);
 let local=p-n*erosion;
 let world=object.origin.xyz+woodTransformRest(owner,local)*object.origin.w;let relative=world-cam.eye.xyz;let z=dot(relative,cam.forward.xyz);
 var o:Out;o.clip=vec4f(dot(relative,cam.right.xyz)/(cam.eye.w*(16./9.)),dot(relative,cam.up.xyz)/cam.eye.w,z*100./99.95-.05*100./99.95,z);
 o.world=world;o.normal=woodTransformNormal(owner,n);o.uv=uv;o.local=p;o.material=material;o.owner=owner;o.other=other;return o;
}
struct GBuffer{@location(0) position:vec4f,@location(1) normal:vec4f,@location(2) color:vec4f};
@fragment fn fragment(v:Out,@builtin(front_facing) front:bool)->GBuffer{
 // All quad operations and implicit samples precede any varying discard or
 // material branch. Closed caps and spent leaves still use the same coverage.
 let at=clamp((v.local+1.5)/3.,vec3f(0),vec3f(1));let s=woodTrilinear(skin,solid,at,vec4f(1,0,0,0));let d=woodTrilinear(damage,solid,at,woodFreshWear(object.tint.w>1.5));
 var normal=normalize(v.normal)*select(-1.,1.,front);
 var uv=v.uv;var color=textureSample(bark,repeatSampler,uv).rgb;
 // Root texture coordinates match the source's three-direction projection.
 let source=v.local/${SOURCE_SCALE}+vec3f(${SOURCE_CENTER[0]},${SOURCE_CENTER[2]},${SOURCE_CENTER[1]});let rootMix=clamp(1.25-source.y,0.,1.);
 let weights=pow(abs(normal),vec3f(4));let w=weights/max(dot(weights,vec3f(1)),.0001);
 let planar=textureSample(bark,repeatSampler,source.zy*vec2f(1,.5)).rgb*w.x+textureSample(bark,repeatSampler,source.xz).rgb*w.y+textureSample(bark,repeatSampler,source.xy*vec2f(1,.5)).rgb*w.z;
 color=mix(color,planar,rootMix);
 let axis=woodNodes[v.owner].axisRadius.xyz;let side=normalize(cross(axis,select(vec3f(0,0,1),vec3f(1,0,0),abs(axis.z)>.9)));let across=cross(axis,side);
 let delta=v.local-woodNodes[v.owner].restParent.xyz;
 // Axial phase belongs to the whole rest-space beam, not its fracture slice.
 let grainPoint=vec3f(dot(delta,side),dot(v.local,axis),dot(delta,across));
 let treeBark=v.material>.5&&v.material<1.5&&object.tint.w>.5;
 let logBark=v.material<2.5&&object.tint.w< -1.5&&object.tint.w> -2.5&&abs(dot(normal,woodTransformNormal(v.owner,axis)))<.75;
 let barkFlag=select(0.,1.,treeBark||logBark);
 let phases=woodPhases(grainPoint);
 let footprint=max(length(dpdx(grainPoint)),length(dpdy(grainPoint)));
 let phaseWidth=max(abs(dpdx(phases)),abs(dpdy(phases)));
 let features=woodFeaturesFiltered(grainPoint,phases,footprint,phaseWidth);
 let material=woodMaterialFiltered(grainPoint,features,s.y,s.x,s.w,d.z,barkFlag);
 var roughness=clamp(textureSample(roughnessMap,repeatSampler,uv).r,.5,.98);
 let height=textureSample(micro,repeatSampler,uv).r;
 let px=dpdx(v.world);let py=dpdy(v.world);
 let photoDx=dpdx(height);let photoDy=dpdy(height);
 let woodHeight=woodHeightFiltered(grainPoint,features,footprint,d.z,barkFlag);
 let woodDx=dpdx(woodHeight);let woodDy=dpdy(woodHeight);
 if(v.material>8.5&&!woodCapVisible(v.owner,v.other)){discard;}
 normal=woodSurfaceNormal(normal,px,py,.005*photoDx,.005*photoDy);
 var crack=select(0.,(1.-smoothstep(.32,.58,height))*d.z,treeBark);
 if(v.material>7.5&&v.material<8.5){
  normal=normalize(v.normal)*select(-1.,1.,front);
  // Thin leaves dry to brown, then their edges recede as local fuel is lost.
  let edge=min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y));
  let conversion=1.-s.x;if(conversion>.92||edge<conversion*.16){discard;}
  color=mix(vec3f(.033,.11,.013),vec3f(.15,.07,.018),clamp(smoothstep(.18,.5,d.y)*(1.-d.x)+conversion,0.,1.));crack=0.;roughness=.88;
 }else{
  let carbon=smoothstep(.008,.13,s.w);let ash=smoothstep(.9,1.,1.-s.x)*(1.-smoothstep(.002,.035,s.w));
  if(treeBark){
   color=mix(color,color*vec3f(.4,.21,.11),smoothstep(.03,.24,1.-s.x));
   color=mix(color,material.rgb,clamp(carbon+ash,0.,1.));
   roughness=mix(roughness,material.w,carbon);
  }else{color=material.rgb;roughness=material.w;}
  normal=woodSurfaceNormal(normal,px,py,woodDx,woodDy);
 }
 color*=1.-.75*crack;
 var o:GBuffer;o.position=vec4f(v.world,1);o.normal=vec4f(normal,clamp(s.y,0.,8.));o.color=vec4f(color,roughness);return o;
}`;

export const forestShadowWGSL =
  forestMeshWGSL.split('struct GBuffer')[0].replace('cam.eye.w*(16./9.)', 'cam.eye.w') +
  `
@fragment fn shadowFragment(v:Out){
 if(v.material>8.5&&!woodCapVisible(v.owner,v.other)){discard;}
 if(v.material>7.5&&v.material<8.5){let s=woodTrilinear(skin,solid,clamp((v.local+1.5)/3.,vec3f(0),vec3f(1)),vec4f(1,0,0,0));let edge=min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y));if(1.-s.x>.92||edge<(1.-s.x)*.16){discard;}}
}`;

export class ForestMesh {
  constructor(solver) {
    this.s = solver;
    this.resources = [];
    const d = solver.device;
    this.resizeOutput(solver.canvas.width, solver.canvas.height);
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
  resizeOutput(width, height) {
    if (this.width === width && this.height === height) return false;
    const d = this.s.device;
    const old = new Set(this.outputResources || []);
    const next = [];
    this.targets = ['rgba16float', 'rgba16float', 'rgba8unorm'].map((format) => {
      const t = d.createTexture({
        size: [width, height], format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      next.push(t);
      return { view: t.createView() };
    });
    const depth = d.createTexture({
      size: [width, height], format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    next.push(depth);
    this.depth = depth.createView();
    this.width = width;
    this.height = height;
    this.outputResources = next;
    this.resources = this.resources.filter((resource) => !old.has(resource));
    this.resources.push(...next);
    // Shadow maps, vertex/index buffers and material textures are independent
    // of the viewport and remain resident during fullscreen/window resizing.
    for (const resource of old) resource.destroy();
    return true;
  }
  async load() {
    if (this.ready) return;
    if (this.loading) return this.loading;
    const resident=[...this.resources];
    this.loading = this.build().catch(error=>{for(const r of this.resources)if(!resident.includes(r))r.destroy();this.resources=resident;this.loading=null;this.ready=false;throw error;});
    return this.loading;
  }
  async build() {
    const s = this.s,
      d = s.device,
      base = new URL('./objects/'+(s.objectId==='cybr-tree'?'forest-tree/structure':s.objectId)+'/', import.meta.url);
    const get = async (name) => {
      const r = await fetch(new URL(name + '?v=7dfac6909b1f2622', base));
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
    this.draws=[{vertices:await buffer('vertices.bin',GPUBufferUsage.VERTEX),indices:await buffer('indices.bin',GPUBufferUsage.INDEX),owners:await buffer('owners.bin',GPUBufferUsage.VERTEX),count:this.manifest.partitionTriangles*3}];
    if(this.manifest.caps.triangles>0)this.draws.push({vertices:await buffer('cap-vertices.bin',GPUBufferUsage.VERTEX),indices:await buffer('cap-indices.bin',GPUBufferUsage.INDEX),owners:await buffer('cap-owner-pairs.bin',GPUBufferUsage.VERTEX),count:this.manifest.caps.triangles*3});
    const texture = async (name, format) => {
      const bitmap = await createImageBitmap(await (await fetch(new URL('./objects/forest-tree/'+name + "?v=7dfac6909b1f2622",import.meta.url))).blob(), {
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
    this.roughness = await texture('bark-roughness.png', 'rgba8unorm');
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
          {arrayStride:8,attributes:[{shaderLocation:4,offset:0,format:'uint32'},{shaderLocation:5,offset:4,format:'uint32'}]},
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
          {arrayStride:8,attributes:[{shaderLocation:4,offset:0,format:'uint32'},{shaderLocation:5,offset:4,format:'uint32'}]},
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
        s.woodStructure?.ready &&
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
            [11, s.objectModels[s.objectId] || s.emptyObject],
            [12, s.surface[s.si]],
            [13, { buffer: s.objectSettings }],
            [15, s.damage[s.si]],
            [21, this.repeat],
            [22, this.micro],

            ...s.woodPoseBindings(),
          ]),
        );
        this.draw(pass);
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
    if (s.woodStructure?.ready && this.ready) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(
        0,
        s.group(this.pipeline, [
          [2, { buffer: s.view }],
          [11, s.objectModels[s.objectId] || s.emptyObject],
          [12, s.surface[s.si]],
          [13, { buffer: s.objectSettings }],
          [15, s.damage[s.si]],
          [20, this.bark],
          [21, this.repeat],
          [22, this.micro],

          [26, this.roughness],
          ...s.woodPoseBindings(),
        ]),
      );
      this.draw(pass);
    }
    pass.end();
  }
  draw(pass){for(const mesh of this.draws){pass.setVertexBuffer(0,mesh.vertices);pass.setVertexBuffer(1,mesh.owners);pass.setIndexBuffer(mesh.indices,'uint32');pass.drawIndexed(mesh.count);}}
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
