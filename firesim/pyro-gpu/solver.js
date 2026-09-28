import {
  surfaceWGSL,
  basicSurfaceWGSL,
  damageResetWGSL,
  FIRE_COLORS,
} from './objects.js?v=studio-rc-3';
import { ForestMesh } from './forest-mesh.js?v=studio-rc-3';
import { emberComputeWGSL, emberRenderWGSL } from './embers.js?v=studio-rc-3';
import { probeGPU } from './gpu-session.js?v=studio-rc-3';
import { simulationShaders, pressureShaders } from './shaders.js?v=studio-rc-3';
import { rendererShaders, dilateWGSL } from './renderer.js?v=studio-rc-3';
export class PyroSolver {
  static async create(canvas, options = {}) {
    const { adapter, context, format } = await probeGPU(canvas);
    const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({ requiredFeatures: features });
    let s;
    try {
      s = new PyroSolver(device, canvas, { ...options, context, format });
    } catch (e) {
      device.destroy();
      throw e;
    }
    s.adapter = {
      ...adapter.info.toJSON?.(),
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    };
    try {
      await s.init();
      return s;
    } catch (e) {
      s.destroy();
      throw e;
    }
  }
  constructor(device, canvas, { N = 128, D = 256, context, format } = {}) {
    this.device = device;
    this.canvas = canvas;
    this.N = N;
    this.D = D;
    this.time = 0;
    this.burstAge = 0;
    this.maxSpeed = 12;
    this.source = [0, 0.58, 0];
    this.smoke = true;
    this.seed = 2;
    this.active = true;
    this.fuel = 0;
    this.effect = [0, 1, 0.085, 0];
    this.dynamics = [1, 1, 1, 1];
    this.chemistry = [1, 1, 1, 1];
    this.objectId = null;
    this.color = 'natural';
    this.embers = true;
    this.si = 0;
    this.errors = [];
    device.addEventListener('uncapturederror', (e) => {
      this.errors.push(e.error.message);
      console.error(e.error.message);
    });
    device.lost.then((info) => {
      this.lost = info.message || info.reason;
    });
    this.context = context;
    this.format = format;
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.resources = [];
    this.pipelines = {};
    this.cache = new Map();
    this.ids = new WeakMap();
    this.nextId = 0;
    this.textureId = 0;
  }
  texture(n, format = 'rgba16float') {
    const t = this.device.createTexture({
      size: [n, n, n],
      dimension: '3d',
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
    const out = { t, view: t.createView(), n, id: ++this.textureId };
    this.resources.push(t);
    return out;
  }
  async pipeline(code, label, entryPoint = 'main') {
    const module = this.device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length)
      throw Error(label + ': ' + errors.map((m) => m.lineNum + ': ' + m.message).join('\n'));
    return this.device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint },
      label,
    });
  }
  async init() {
    const d = this.device;
    this.sampler = d.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });
    this.params = Array.from({ length: 12 }, () =>
      d.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    );
    this.view = d.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.stats = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.groupStats = d.createBuffer({
      size: Math.ceil((this.N + 1) / 4) ** 3 * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.readback = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.masks = [0, 1].map(() =>
      d.createBuffer({
        size: (this.D / 8) ** 3 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );
    this.bricks = d.createBuffer({ size: (this.D / 8) ** 3 * 16, usage: GPUBufferUsage.STORAGE });
    this.indirect = d.createBuffer({
      size: 12,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.indirect, 0, new Uint32Array([0, 2, 4]));
    this.v = Array.from({ length: 3 }, () => this.texture(this.N + 1));
    this.c = Array.from({ length: 3 }, () => this.texture(this.D));
    this.vort = this.texture(this.N);
    this.levels = [];
    for (let n = this.N; n >= 4; n /= 2)
      this.levels.push({
        n,
        p: [this.texture(n, 'r32float'), this.texture(n, 'r32float')],
        b: this.texture(n, 'r32float'),
        current: 0,
      });
    // Static approved fuel artwork, never temporal fire frames.
    const response = await fetch(new URL('../source/source-native.rgba8.bin', import.meta.url));
    if (!response.ok) throw Error('CYBR fuel artwork could not be loaded.');
    const sourceBytes = new Uint8Array(await response.arrayBuffer());
    if (sourceBytes.length !== 896 * 504 * 4) throw Error('CYBR fuel artwork has an invalid size.');
    const source = d.createTexture({
      size: [896, 504],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    d.queue.writeTexture({ texture: source }, sourceBytes, { bytesPerRow: 896 * 4 }, [896, 504]);
    this.sigilSource = { view: source.createView() };
    this.resources.push(source);
    this.objectSettings = d.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.objectModels = {};
    this.emptyObject = this.texture(1);
    this.surface = [this.texture(64), this.texture(64)];
    this.damage = null;
    this.forestMesh = null;
    this.rendererFamilies = new Map();
    this.usingTree = false;
    this.surfacePipeline = await this.pipeline(basicSurfaceWGSL, 'surface-fuel');
    this.surfaceResetPipeline = await this.pipeline(basicSurfaceWGSL, 'surface-reset', 'reset');
    this.emberBuffer = d.createBuffer({
      size: 2048 * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.emberPipeline = await this.pipeline(emberComputeWGSL, 'embers');
    const emberModule = d.createShaderModule({ code: emberRenderWGSL });
    this.emberRender = await d.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: emberModule, entryPoint: 'vertex' },
      fragment: {
        module: emberModule,
        entryPoint: 'fragment',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
    });
    const shaders = simulationShaders(this.N, this.D);
    for (const [name, code] of Object.entries(shaders))
      this.pipelines[name] = await this.pipeline(code, name);
    for (const level of this.levels) {
      level.kernels = {};
      for (const [name, code] of Object.entries(pressureShaders(level.n)))
        level.kernels[name] = await this.pipeline(code, 'pressure-' + name + '-' + level.n);
    }
    await this.prepareRenderer(false);
    this.output = d.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.outputView = this.output.createView();
    this.resources.push(this.output);
    const present = d.createShaderModule({
      code: `@group(0) @binding(0) var image:texture_2d<f32>;@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let q=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(q*2.-1.,0,1);}@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(p.xy),0);}`,
    });
    this.present = await d.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: present, entryPoint: 'vs' },
      fragment: { module: present, entryPoint: 'fs', targets: [{ format: this.format }] },
    });
    if (d.features.has('timestamp-query')) {
      this.query = d.createQuerySet({ type: 'timestamp', count: 80 });
      this.queryResolve = d.createBuffer({
        size: 640,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.queryRead = d.createBuffer({
        size: 640,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    this.visibleBricks = d.createBuffer({ size: 32 ** 3 * 4, usage: GPUBufferUsage.STORAGE });
    this.dilatePipeline = await this.pipeline(dilateWGSL, 'visible-bricks');
    this.light = this.texture(64);
    this.fireLights = d.createBuffer({ size: 8 * 64, usage: GPUBufferUsage.STORAGE });
    this.lightSeeds = d.createBuffer({ size: 8 * 64, usage: GPUBufferUsage.STORAGE });
    this.roomTargets = [0, 1].map(() => {
      const t = d.createTexture({
        size: [640, 128],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      this.resources.push(t);
      return { t, view: t.createView() };
    });
    this.clearPipeline = await this.pipeline(
      `
@group(0) @binding(0) var a:texture_storage_3d<rgba16float,write>;
@group(0) @binding(1) var b:texture_storage_3d<rgba16float,write>;
@group(0) @binding(2) var c:texture_storage_3d<rgba16float,write>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=textureDimensions(a))){return;}textureStore(a,vec3i(id),vec4f(0));textureStore(b,vec3i(id),vec4f(0));textureStore(c,vec3i(id),vec4f(0));
}`,
      'clear-state',
    );
    this.vi = 0;
    this.ci = 0;
    const setup = d.createCommandEncoder();
    this.resetSurface(setup);
    d.queue.submit([setup.finish()]);
  }
  async prepareRenderer(tree) {
    if (!this.rendererFamilies.has(tree)) {
      const code = rendererShaders(tree),
        module = this.device.createShaderModule({ code: code.render });
      const info = await module.getCompilationInfo();
      if (info.messages.some((m) => m.type === 'error'))
        throw Error(info.messages.map((m) => m.message).join('\n'));
      const renderPipeline = await this.device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'vertex' },
        fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      const family = { renderPipeline };
      for (const [key, shader, entry] of [
        ['lightPipeline', 'light', 'main'],
        ['roomPipeline', 'room', 'main'],
        ['bouncePipeline', 'room', 'bounce'],
        ['gatherPipeline', 'gather', 'main'],
        ['gatherAdaptivePipeline', 'gatherAdaptive', 'main'],
      ])
        family[key] = await this.pipeline(code[shader], (tree ? 'tree-' : '') + key, entry);
      this.rendererFamilies.set(tree, family);
    }
    Object.assign(this, this.rendererFamilies.get(tree));
  }
  async prepareSource() {
    const requested = this.objectId,
      tree = requested === 'cybr-tree';
    if (requested && !this.objectModels[requested]) {
      const response = await fetch(
        new URL('./objects/' + requested + '.rgba16.bin', import.meta.url),
      );
      if (!response.ok) throw Error('Object geometry unavailable: ' + requested);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== 64 ** 3 * 8) throw Error('Invalid object geometry');
      const model = this.texture(64);
      this.device.queue.writeTexture(
        { texture: model.t },
        bytes,
        { bytesPerRow: 64 * 8, rowsPerImage: 64 },
        [64, 64, 64],
      );
      this.objectModels[requested] = model;
    }
    if (requested !== this.objectId) return this.prepareSource();
    if (tree && !this.forestMesh) {
      this.treeSurfacePipeline ||= await this.pipeline(surfaceWGSL, 'tree-surface-fuel');
      this.damageResetPipeline ||= await this.pipeline(damageResetWGSL, 'tree-damage-reset');
      this.damage = [this.texture(64), this.texture(64)];
      this.updateObject();
      const init = this.device.createCommandEncoder();
      for (const damage of this.damage)
        this.dispatch(
          init,
          this.damageResetPipeline,
          [
            [13, { buffer: this.objectSettings }],
            [16, damage],
          ],
          64,
        );
      this.device.queue.submit([init.finish()]);
      this.forestMesh = new ForestMesh(this);
    }
    if (tree) await this.forestMesh.load();
    if (!tree && this.forestMesh) {
      this.forestMesh.destroy();
      this.forestMesh = null;
      const owned = new Set(this.damage.map((x) => x.t));
      for (const r of owned) r.destroy();
      this.resources = this.resources.filter((r) => !owned.has(r));
      this.damage = null;
      this.cache.clear();
    }
    if (tree !== this.usingTree) {
      await this.prepareRenderer(tree);
      this.usingTree = tree;
      this.lightReady = false;
    }
    if (requested !== this.objectId) return this.prepareSource();
  }
  meshBindings() {
    return this.usingTree ? this.forestMesh.bindings() : [];
  }
  meshShadowBindings() {
    return this.usingTree ? this.forestMesh.shadowBindings() : [];
  }
  group(pipeline, items) {
    // Entries are explicit because dead-code elimination removes unused slots.
    const id = (o) => {
      if (!this.ids.has(o)) this.ids.set(o, ++this.nextId);
      return this.ids.get(o);
    };
    const key =
      id(pipeline) + ':' + items.map(([b, r]) => b + '-' + id(r.view || r.buffer || r)).join(',');
    if (!this.cache.has(key))
      this.cache.set(
        key,
        this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: items.map(([binding, resource]) => ({
            binding,
            resource: resource.view || resource,
          })),
        }),
      );
    return this.cache.get(key);
  }
  dispatch(encoder, pipeline, items, n) {
    const pass = this.pressurePass || encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.group(pipeline, items));
    const xy = pipeline.label.startsWith('pressure-') ? 8 : 4;
    pass.dispatchWorkgroups(Math.ceil(n / xy), Math.ceil(n / xy), Math.ceil(n / 4));
    if (!this.pressurePass) pass.end();
  }
  sparse(encoder, pipeline, items) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.group(pipeline, items));
    pass.dispatchWorkgroupsIndirect(this.indirect, 0);
    pass.end();
  }
  vcycle(encoder, l = 0) {
    const level = this.levels[l];
    const smooth = (count) => {
      for (let i = 0; i < count; i++) {
        this.dispatch(
          encoder,
          level.kernels.smooth,
          [
            [0, level.p[level.current]],
            [1, level.b],
            [2, level.p[1 - level.current]],
          ],
          level.n,
        );
        level.current = 1 - level.current;
      }
    };
    if (l === this.levels.length - 1) {
      smooth(24);
      return;
    }
    smooth(3);
    const coarse = this.levels[l + 1];
    coarse.current = 0;
    this.dispatch(
      encoder,
      level.kernels.restrict,
      [
        [0, level.p[level.current]],
        [1, level.b],
        [2, coarse.b],
        [3, coarse.p[0]],
      ],
      coarse.n,
    );
    this.vcycle(encoder, l + 1);
    this.dispatch(
      encoder,
      level.kernels.prolong,
      [
        [0, level.p[level.current]],
        [1, coarse.p[coarse.current]],
        [2, level.p[1 - level.current]],
      ],
      level.n,
    );
    level.current = 1 - level.current;
    smooth(3);
  }
  stamp(encoder, index) {
    if (this.query) {
      const pass = encoder.beginComputePass({
        timestampWrites: { querySet: this.query, beginningOfPassWriteIndex: index },
      });
      pass.end();
    }
  }
  step(encoder, dt, index) {
    this.stamp(encoder, index * 6);
    // Reuse pressure only for a settled continuous source. A new burst or
    // source movement keeps the original two cycles and zero initial guess.
    const stationary =
      this.lastPressureSource &&
      this.source.every((v, i) => Math.abs(v - this.lastPressureSource[i]) < (0.25 * 6) / this.N);
    const warmPressure =
      this.effect[3] > 0.5 && this.burstAge > 0.12 && this.previousDt && stationary;
    const p = this.params[index];
    this.device.queue.writeBuffer(
      p,
      0,
      new Float32Array([
        dt,
        this.time,
        this.burstAge,
        this.smoke ? 1 : 0,
        ...this.source,
        this.active ? 1 : 0,
        this.seed,
        6,
        this.fuel,
        warmPressure ? dt / this.previousDt : 0,
        ...this.effect,
        ...this.dynamics,
        ...this.chemistry,
      ]),
    );
    this.previousDt = dt;
    this.lastPressureSource = [...this.source];
    const base = [
        [0, { buffer: p }],
        [1, this.sampler],
      ],
      k = this.pipelines;
    const vi = this.vi,
      ci = this.ci;
    if (this.objectId) {
      this.dispatch(
        encoder,
        this.usingTree ? this.treeSurfacePipeline : this.surfacePipeline,
        [
          ...base,
          [2, this.c[ci]],
          ...this.objectBindings(true),
          [14, this.surface[1 - this.si]],
          ...(this.usingTree
            ? [
                [15, this.damage[this.si]],
                [16, this.damage[1 - this.si]],
              ]
            : []),
        ],
        64,
      );
      this.si = 1 - this.si;
    }
    this.dispatch(
      encoder,
      k.advectVelocity,
      [...base, [2, this.v[vi]], [3, this.v[2]]],
      this.N + 1,
    );
    this.dispatch(
      encoder,
      k.curl,
      [
        [1, this.sampler],
        [2, this.v[vi]],
        [3, this.vort],
      ],
      this.N,
    );
    this.dispatch(
      encoder,
      k.correctVelocity,
      [
        ...base,
        [2, this.v[vi]],
        [3, this.v[2]],
        [4, this.c[ci]],
        [5, this.vort],
        [6, this.v[1 - vi]],
        [8, this.sigilSource],
        ...this.objectBindings(true),
      ],
      this.N + 1,
    );
    this.stamp(encoder, index * 6 + 1);
    this.stamp(encoder, index * 6 + 2);
    const fine = this.levels[0];
    const previous = fine.p[fine.current];
    fine.current = 1 - fine.current;
    this.dispatch(
      encoder,
      k.rhs,
      [
        [0, { buffer: p }],
        [2, this.v[1 - vi]],
        [3, fine.b],
        [4, fine.p[fine.current]],
        [5, previous],
      ],
      this.N,
    );
    this.pressurePass = encoder.beginComputePass();
    this.vcycle(encoder);
    if (!warmPressure) this.vcycle(encoder);
    this.pressurePass.end();
    this.pressurePass = null;
    this.dispatch(
      encoder,
      k.project,
      [
        [2, this.v[1 - vi]],
        [3, fine.p[fine.current]],
        [4, fine.b],
        [5, this.v[vi]],
        [6, { buffer: this.groupStats }],
      ],
      this.N + 1,
    );
    const reduce = encoder.beginComputePass();
    reduce.setPipeline(k.reduceStats);
    reduce.setBindGroup(
      0,
      this.group(k.reduceStats, [
        [0, { buffer: this.groupStats }],
        [1, { buffer: this.stats }],
      ]),
    );
    reduce.dispatchWorkgroups(1);
    reduce.end();
    this.stamp(encoder, index * 6 + 3);
    this.stamp(encoder, index * 6 + 4);
    encoder.clearBuffer(this.indirect, 0, 4);
    this.dispatch(
      encoder,
      k.buildBricks,
      [
        [0, { buffer: p }],
        [2, { buffer: this.masks[ci] }],
        [3, { buffer: this.masks[1 - ci] }],
        [4, { buffer: this.bricks }],
        [5, { buffer: this.indirect }],
        [1, this.sampler],
        ...this.objectBindings(),
      ],
      this.D / 8,
    );
    encoder.clearBuffer(this.masks[1 - ci]);
    this.sparse(encoder, k.advectScalar, [
      ...base,
      [2, this.v[vi]],
      [3, this.c[ci]],
      [4, this.c[2]],
      [6, { buffer: this.bricks }],
    ]);
    this.sparse(encoder, k.correctScalar, [
      ...base,
      [2, this.v[vi]],
      [3, this.c[ci]],
      [4, this.c[2]],
      [5, this.c[1 - ci]],
      [6, { buffer: this.bricks }],
      [7, { buffer: this.masks[1 - ci] }],
      [8, this.sigilSource],
      ...this.objectBindings(true),
    ]);
    this.ci = 1 - ci;
    if (this.embers && !this.smoke) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.emberPipeline);
      pass.setBindGroup(
        0,
        this.group(this.emberPipeline, [
          ...base,
          [2, this.v[vi]],
          [3, this.c[this.ci]],
          [4, { buffer: this.emberBuffer }],
        ]),
      );
      pass.dispatchWorkgroups(32);
      pass.end();
    }
    this.stamp(encoder, index * 6 + 5);
    this.time += dt;
    this.burstAge += dt;
  }
  resetSurface(encoder) {
    this.updateObject();
    for (const skin of this.surface)
      this.dispatch(encoder, this.surfaceResetPipeline, [[14, skin]], 64);
    for (const damage of this.damage || [])
      this.dispatch(
        encoder,
        this.damageResetPipeline,
        [
          [13, { buffer: this.objectSettings }],
          [16, damage],
        ],
        64,
      );
  }
  objectBindings(state = false) {
    return [
      [11, this.objectModels[this.objectId] || this.emptyObject],
      ...(state ? [[12, this.surface[this.si]]] : []),
      [13, { buffer: this.objectSettings }],
    ];
  }
  updateObject() {
    const tint = FIRE_COLORS.find((c) => c.id === this.color) || FIRE_COLORS[0];
    this.device.queue.writeBuffer(
      this.objectSettings,
      0,
      new Float32Array([
        ...this.source,
        this.effect[1],
        this.objectId ? 1 : 0,
        tint.id === 'natural' ? 0 : 1,
        this.embers ? 1 : 0,
        this.ignition || 0,
        ...tint.rgb,
        this.objectId === 'cybr-tree' ? (this.treeMoisture === 'damp' ? 2 : 1) : 0,
      ]),
    );
  }
  camera(data) {
    this.cameraValues = data;
    const key = data.slice(16).join(',');
    if (key !== this.lightKey) {
      this.lightKey = key;
      this.lightReady = false;
    }
    this.inspectSmoke = data[17] > 0.5;
    this.roomVisible = data[16] > 0.5;
    this.device.queue.writeBuffer(this.view, 0, new Float32Array(data));
  }
  render(encoder) {
    this.stamp(encoder, 78);
    if (this.usingTree) this.forestMesh.render(encoder);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: this.outputView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(
      0,
      this.group(this.renderPipeline, [
        [0, this.c[this.ci]],
        [1, this.sampler],
        [2, { buffer: this.view }],
        [3, this.light],
        [5, { buffer: this.fireLights }],
        [6, this.roomTargets[0]],
        [7, this.roomTargets[1]],
        [9, { buffer: this.visibleBricks }],
        ...this.objectBindings(true),
        ...this.meshBindings(),
        ...this.meshShadowBindings(),
      ]),
    );
    pass.draw(3);
    if (this.embers && !this.smoke && !this.inspectSmoke) {
      pass.setPipeline(this.emberRender);
      pass.setBindGroup(
        0,
        this.group(this.emberRender, [
          [0, { buffer: this.emberBuffer }],
          [1, { buffer: this.view }],
          [2, this.sampler],
          [3, this.c[this.ci]],
          [4, this.objectModels[this.objectId] || this.emptyObject],
          [5, { buffer: this.objectSettings }],
        ]),
      );
      pass.draw(6, 2048);
    }
    pass.end();
    const present = encoder.beginRenderPass({
      colorAttachments: [
        { view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
      ],
      ...(this.query ? { timestampWrites: { querySet: this.query, endOfPassWriteIndex: 79 } } : {}),
    });
    present.setPipeline(this.present);
    present.setBindGroup(0, this.group(this.present, [[0, this.outputView]]));
    present.draw(3);
    present.end();
  }
  async frame(dt = 1 / 60) {
    if (this.lost) throw Error('GPU device lost: ' + this.lost);
    if (this.errors.length) throw Error(this.errors.at(-1));
    await this.prepareSource();
    this.updateObject();
    const wall = performance.now(),
      encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.stats);
    const substeps =
      dt > 0
        ? Math.max(
            1,
            Math.ceil(
              (dt * Math.max(this.maxSpeed, this.burstAge < 0.12 ? 12 : 0)) / ((1.5 * 6) / this.N),
            ),
          )
        : 0;
    if (substeps > 12)
      throw Error('CFL requires more than 12 steps; frame budget cannot safely be met.');
    // Empty timestamped passes bracket all simulation compute on the GPU timeline.
    for (let i = 0; i < substeps; i++) this.step(encoder, dt / substeps, i);
    this.stamp(encoder, 76);
    const relit = dt > 0 || !this.lightReady;
    if (relit) {
      if (this.usingTree) this.forestMesh.shadows(encoder);
      this.dispatch(
        encoder,
        this.dilatePipeline,
        [
          [0, { buffer: this.masks[this.ci] }],
          [1, { buffer: this.visibleBricks }],
        ],
        32,
      );
      const gather = encoder.beginComputePass();
      gather.setPipeline(this.gatherPipeline);
      gather.setBindGroup(
        0,
        this.group(this.gatherPipeline, [
          [0, this.c[this.ci]],
          [1, this.sampler],
          [2, { buffer: this.view }],
          [5, { buffer: this.lightSeeds }],
        ]),
      );
      gather.dispatchWorkgroups(8);
      gather.end();
      const refine = encoder.beginComputePass();
      refine.setPipeline(this.gatherAdaptivePipeline);
      refine.setBindGroup(
        0,
        this.group(this.gatherAdaptivePipeline, [
          [0, this.c[this.ci]],
          [1, this.sampler],
          [2, { buffer: this.view }],
          [5, { buffer: this.fireLights }],
          [10, { buffer: this.lightSeeds }],
          [13, { buffer: this.objectSettings }],
        ]),
      );
      refine.dispatchWorkgroups(8);
      refine.end();
      if (this.roomVisible) {
        const direct = encoder.beginComputePass();
        direct.setPipeline(this.roomPipeline);
        direct.setBindGroup(
          0,
          this.group(this.roomPipeline, [
            [0, this.c[this.ci]],
            [1, this.sampler],
            [2, { buffer: this.view }],
            [5, { buffer: this.fireLights }],
            [8, this.roomTargets[0]],
            ...this.objectBindings(),
            ...this.meshShadowBindings(),
          ]),
        );
        direct.dispatchWorkgroups(80, 16);
        direct.end();
        const bounce = encoder.beginComputePass();
        bounce.setPipeline(this.bouncePipeline);
        bounce.setBindGroup(
          0,
          this.group(this.bouncePipeline, [
            [0, this.c[this.ci]],
            [1, this.sampler],
            [2, { buffer: this.view }],
            [6, this.roomTargets[0]],
            [8, this.roomTargets[1]],
            ...this.objectBindings(),
          ]),
        );
        bounce.dispatchWorkgroups(80, 16);
        bounce.end();
      }
      this.dispatch(
        encoder,
        this.lightPipeline,
        [
          [0, this.c[this.ci]],
          [1, this.sampler],
          [2, { buffer: this.view }],
          [4, this.light],
          [5, { buffer: this.fireLights }],
          [6, this.roomTargets[0]],
          [9, { buffer: this.visibleBricks }],
          ...this.objectBindings(),
          ...this.meshShadowBindings(),
        ],
        64,
      );
      this.lightReady = true;
    }
    this.stamp(encoder, 77);
    this.render(encoder);
    encoder.copyBufferToBuffer(this.stats, 0, this.readback, 0, 16);
    if (this.query) {
      encoder.resolveQuerySet(this.query, 0, 80, this.queryResolve, 0);
      encoder.copyBufferToBuffer(this.queryResolve, 0, this.queryRead, 0, 640);
    }
    this.device.queue.submit([encoder.finish()]);
    // Mapping waits for the copy itself; request both maps together instead of three serial fences.
    await Promise.all([
      this.readback.mapAsync(GPUMapMode.READ),
      ...(this.query ? [this.queryRead.mapAsync(GPUMapMode.READ)] : []),
    ]);
    const mapped = this.readback.getMappedRange();
    const u = new Uint32Array(mapped);
    const f = new Float32Array(mapped);
    const diagnostic = {
      maxSpeed: f[0],
      preDivergence: f[1] / Math.max(f[3], 1),
      postDivergence: f[2] / Math.max(f[3], 1),
    };
    this.readback.unmap();
    if (dt > 0) this.maxSpeed = Math.max(diagnostic.maxSpeed, 0.1);
    let gpu = null;
    if (this.query) {
      const t = new BigUint64Array(this.queryRead.getMappedRange());
      gpu = {
        velocity: 0,
        pressure: 0,
        transport: 0,
        lighting: Number(t[77] - t[76]) / 1e6,
        render: Number(t[79] - t[78]) / 1e6,
      };
      for (let i = 0; i < substeps; i++) {
        gpu.velocity += Number(t[i * 6 + 1] - t[i * 6]) / 1e6;
        gpu.pressure += Number(t[i * 6 + 3] - t[i * 6 + 2]) / 1e6;
        gpu.transport += Number(t[i * 6 + 5] - t[i * 6 + 4]) / 1e6;
      }
      gpu.simulation = gpu.velocity + gpu.pressure + gpu.transport;
      this.queryRead.unmap();
    }
    if (!Number.isFinite(this.maxSpeed) || this.maxSpeed > 1000)
      throw Error('Invalid velocity state: ' + JSON.stringify({ time: this.time, diagnostic }));
    const completedAt = performance.now();
    return {
      wall: completedAt - wall,
      startedAt: wall,
      completedAt,
      gpu,
      relit,
      substeps,
      time: this.time,
      ...diagnostic,
    };
  }
  burst(at = this.source) {
    this.source = [...at];
    this.burstAge = 0;
    this.seed += 3.17;
    this.active = true;
  }
  async pixels() {
    const row = this.canvas.width * 4;
    const buffer = this.device.createBuffer({
      size: row * this.canvas.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: this.output }, { buffer, bytesPerRow: row }, [
      this.canvas.width,
      this.canvas.height,
    ]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8ClampedArray(buffer.getMappedRange()).slice();
    buffer.unmap();
    buffer.destroy();
    return bytes;
  }
  async reset() {
    await this.device.queue.onSubmittedWorkDone();
    this.lightReady = false;
    this.previousDt = 0;
    this.time = 0;
    this.burstAge = 0;
    this.maxSpeed = 12;
    // Reset in place; no full-volume CPU uploads or transient half-GB buffers.
    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.emberBuffer);
    this.resetSurface(encoder);
    for (const mask of this.masks) encoder.clearBuffer(mask);
    for (const fields of [this.v, this.c])
      this.dispatch(
        encoder,
        this.clearPipeline,
        fields.map((f, i) => [i, f]),
        fields[0].n,
      );
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }
  destroy() {
    this.forestMesh?.destroy();
    for (const r of this.resources) r.destroy();
    this.device.destroy();
  }
}
