"""Ground static rocks on the exact height field and synchronize visibility data."""
from pathlib import Path
import sys,json
root=Path(sys.argv[1])
def patch(name,old,new):
 p=root/name;s=p.read_text();assert old in s,(name,old[:100]);p.write_text(s.replace(old,new,1))
patch('public/src/world.js','      m.position.set(x, y, z);','      m.position.set(x, y, z);\n      m.userData.designedY = y;')
method='''  groundRocks(p) {
    if (!p.terrain) return;
    const key = p.bed.join(",");
    if (key === this.rockPlacementKey) return;
    let corrected = 0, maximumOriginalGap = 0, maximumRemainingGap = -Infinity;
    const point = new THREE.Vector3();
    for (const mesh of this.rocks) {
      // Always start from the authored placement, not a previous preset's result.
      mesh.position.y = mesh.userData.designedY;
      mesh.updateWorldMatrix(true, false);
      const a = mesh.geometry.attributes.position;
      let gap = Infinity;
      for (let i = 0; i < a.count; i++) {
        point.fromBufferAttribute(a, i).applyMatrix4(mesh.matrixWorld);
        gap = Math.min(gap, point.y - bedHeightJS(point.x, point.z, p.bed));
      }
      maximumOriginalGap = Math.max(maximumOriginalGap, gap);
      const embed = Math.min(.22, Math.max(.04, mesh.scale.y * .06));
      if (gap > -embed) {
        mesh.position.y -= gap + embed;
        mesh.updateWorldMatrix(true, false);
        corrected++;
        gap = -embed;
      }
      maximumRemainingGap = Math.max(maximumRemainingGap, gap);
    }
    this.rockPlacementKey = key;
    this.groundingReport = {rocks: this.rocks.length, corrected, maximumOriginalGap, maximumRemainingGap, bed: p.bed.slice(), scope: "Deterministic downward placement against the analytic bed, with shallow embedding. Not a granular-contact solver."};
  }
'''
patch('public/src/world.js','  configure(p) {',method+'  configure(p) {\n    this.groundRocks(p);')
patch('public/src/ray-scene.js','    world.scene.updateMatrixWorld(true);','    world.scene.updateMatrixWorld(true);\n    this.rockPlacementKey = world.rockPlacementKey;')
method='''  syncStaticWorld(world) {
    if (this.rockPlacementKey === world.rockPlacementKey) return;
    // Configuration-time rebuild only. Uniform objects retain their identity:
    // all existing render passes must immediately see the new triangle tables.
    const fresh = new RayScene(world);
    for (const [name, uniform] of Object.entries(this.uniforms)) {
      uniform.value = fresh.uniforms[name].value;
    }
    this.nodeTexture.dispose();
    this.triangleTexture.dispose();
    for (const name of ["instances", "roots", "bvhs", "nodeTexture", "triangleTexture", "stats", "rockPlacementKey"]) this[name] = fresh[name];
  }
'''
patch('public/src/ray-scene.js','  update(preset) {',method+'  update(preset) {')
patch('public/src/engine.js','    this.world.configure(p);','    this.world.configure(p);\n    this.rayScene.syncStaticWorld(this.world);')
p=root/'tests/repair.test.mjs';s=p.read_text();s+='''
import { World } from '../public/src/world.js';
import { PRESETS } from '../public/src/config.js';
import { bedHeightJS } from '../public/src/environment.js';
import { RayScene } from '../public/src/ray-scene.js';
function allRockClearances(world,preset){
 const out=[],point=new THREE.Vector3();world.scene.updateMatrixWorld(true);
 for(const mesh of world.rocks){let gap=Infinity;const a=mesh.geometry.attributes.position;
  for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);gap=Math.min(gap,point.y-bedHeightJS(point.x,point.z,preset.bed));}
  out.push(gap);
 }return out;
}
for(const name of ['clear','harbor','glass'])test(`No statically placed rock floats above the ${name} bed`,()=>{
 const w=new World({});w.configure(PRESETS[name]);const gaps=allRockClearances(w,PRESETS[name]);
 assert.equal(gaps.length,93);assert.ok(gaps.every(g=>g<=-.03999),Math.max(...gaps));assert.ok(w.groundingReport.corrected>0);
});
test('Static grounding is idempotent and independent of preset history',()=>{
 const w=new World({});w.configure(PRESETS.clear);const first=w.rocks.map(m=>m.position.y);
 w.configure(PRESETS.clear);assert.deepEqual(first,w.rocks.map(m=>m.position.y));
 w.configure(PRESETS.harbor);w.configure(PRESETS.glass);w.configure(PRESETS.clear);assert.deepEqual(first,w.rocks.map(m=>m.position.y));
});
test('Grounding rebuild preserves shared uniform identities and replaces stale triangles',()=>{
 const w=new World({}),scene=new RayScene(w),u=scene.uniforms.uRayTriangles,old=u.value;
 w.configure(PRESETS.harbor);scene.syncStaticWorld(w);assert.equal(scene.uniforms.uRayTriangles,u);assert.notEqual(u.value,old);
 const stable=u.value;scene.syncStaticWorld(w);assert.equal(stable,u.value);
 assert.equal(scene.rockPlacementKey,w.rockPlacementKey);assert.equal(scene.uniforms.uRayNodes.value,scene.nodeTexture);
 scene.nodeTexture.dispose();scene.triangleTexture.dispose();
});
''';p.write_text(s)
p=root/'public/src/repair-validation.js';s=p.read_text();needle="engine.setPreset('harbor');" if "engine.setPreset('harbor');" in s else 'engine.setPreset("harbor");';assert needle in s
s=s.replace(needle,needle+'''\n const grounding={...engine.world.groundingReport};ensure(grounding.rocks===93&&grounding.maximumRemainingGap<=-.03999,'Static scene contains unsupported rocks');report.checks.staticRockGrounding=grounding;\n ensure(engine.rayScene.rockPlacementKey===engine.world.rockPlacementKey,'Static ray scene is stale after grounding');\n''',1);p.write_text(s)
p=root/'BUGFIXES.md';s=p.read_text();row='| Off-screen geometry missing from refraction; unrelated depth-buffer fallbacks |';assert row in s;s=s.replace(row,'| Some decorative rocks floated above the seabed | Deterministic downward placement against the actual analytic bed, with shallow embedding | All 93 rocks checked across three depths; not a granular-contact solver |\n| Static visibility could become stale after terrain-aware placement | Rebuild object-space visibility tables at preset changes while preserving shared uniform objects | Shared-uniform regression plus independent GPU ray tests and fresh bathymetry/endurance checks |\n'+row,1);p.write_text(s)
p=root/'README.md';s=p.read_text().replace('66 numerical','71 numerical').replace('32 documented','34 documented');s+='\n## Static scene grounding\n\nAll 93 scene rocks are placed against the actual seabed for each terrain preset instead of retaining unrelated authored heights. Only unsupported placements move downward, with shallow embedding to avoid numerical gaps. Ray-tracing tables are rebuilt at configuration time and preserve their shared uniform identities; bathymetry and shadows are generated after grounding. This is static scene placement, not a rock-motion/contact simulation.\n';p.write_text(s)
(root/'docs/static-grounding-repair.json').write_text(json.dumps({'rocks':93,'reason':'The authored decorative-rock heights were unrelated to preset bathymetry; measured unsupported gaps were visible underwater.','placement':'Downward-only against exact analytic bed, reset to authored height before each distinct terrain preset','synchronization':'Ray tables rebuilt; shared uniform identities preserved; collision-top and shadows regenerate afterward','requiresNewBoundaryTests':True},indent=2))
print('Static grounding and visibility synchronization applied')
