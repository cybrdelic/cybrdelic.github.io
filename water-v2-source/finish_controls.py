"""Make UI changes participate in fixed-tick replay; rendered film shaders are unchanged."""
from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'public/src/engine.js'
s=p.read_text()
a="this.sceneKey=key;this.journal.reset(key);this.preset={...PRESETS[key]};"
b="this.sceneKey=key;this.journal.reset(key);this.flags={foam:true,spray:true,rain:true,caustics:true,reflections:true,taa:true};this.debug=0;this.preset={...PRESETS[key]};"
assert a in s;s=s.replace(a,b,1);p.write_text(s)
p=root/'public/src/app.js';s=p.read_text()
a="function preset(k){engine.setPreset(k);clock=0;labels();$('#scene').value=k;}"
b="function preset(k){engine.setPreset(k);clock=0;labels();$('#scene').value=k;for(const box of document.querySelectorAll('[data-flag]'))box.checked=engine.flags[box.dataset.flag];}"
assert a in s;s=s.replace(a,b,1)
a="for(const box of document.querySelectorAll('[data-flag]'))box.onchange=()=>{engine.flags[box.dataset.flag]=box.checked;engine.post.reset();};"
b="for(const box of document.querySelectorAll('[data-flag]'))box.onchange=()=>{engine.command('flag',{name:box.dataset.flag,value:box.checked});engine.post.reset();};"
assert a in s;s=s.replace(a,b,1)
a="engine.shared.uAbsorption.value.fromArray(engine.preset.absorption).multiplyScalar(scale);engine.shared.uScattering.value.fromArray(engine.preset.scattering).multiplyScalar(scale);"
b="engine.command('extinction',{scale});"
assert a in s;s=s.replace(a,b,1)
a="loadReplay:doc=>engine.loadReplay(doc),"
b="loadReplay:doc=>{engine.loadReplay(doc);clock=0;labels();$('#scene').value=engine.sceneKey;for(const box of document.querySelectorAll('[data-flag]'))box.checked=engine.flags[box.dataset.flag];},"
assert a in s;s=s.replace(a,b,1);p.write_text(s)
p=root/'README.md';s=p.read_text();s+='\n## Input replay details\n\nFeature checkboxes and the extinction slider enqueue versioned events on the next physical tick, as do interactive impulses. These inputs are included in the exported journal. Paused inputs remain queued until simulation resumes. A preset/reset restores the baseline flags before loading any recorded events. Camera movement and pause durations are not recorded; the journal reproduces the simulation state, not the entire UI/video timeline.\n';p.write_text(s)
