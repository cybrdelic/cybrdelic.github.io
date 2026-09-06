"""Targeted bubble-source/framing and resolved-rain visibility corrections.
Other 27 scene settings and rendered effects remain unchanged.
"""
from pathlib import Path
import json,sys
root=Path(sys.argv[1])
def patch(name,old,new):
 p=root/name;s=p.read_text();assert old in s,(name,old[:100]);p.write_text(s.replace(old,new,1))
patch('public/src/particles.js','''      this.emitBubble([
        -10 + (this.rng() - 0.5) * 2,
        -3.6,
        -8 + (this.rng() - 0.5) * 2,
      ]);''','''      const origin = preset.bubbleEmitter || [-10, -3.6, -8];
      this.emitBubble([
        origin[0] + (this.rng() - 0.5) * 2,
        origin[1],
        origin[2] + (this.rng() - 0.5) * 2,
      ]);''')
p=root/'public/src/particles.js';s=p.read_text();assert s.count('* 92')==4;s=s.replace('* 92','* 46');p.write_text(s)
p=root/'public/src/config.js';s=p.read_text();s+='''\n// A deliberate secondary-effects source positioned in open water, not inside a rock.\nPRESETS.bubbles = { ...PRESETS.clear, name: "Bubble field", description: "Secondary bubble particles • buoyant rise • underwater extinction", bubbleEmitter: [-4, -3.6, -4] };\n''';p.write_text(s)
patch('public/src/app.js','''    if (viewMode === "under") {''','''    if (viewMode === "film" && p.bubbleEmitter) {
      engine.setCamera({eye: [0 + Math.sin(t * .08), -2.5, 1], target: [-4, -2, -4], fov: 58});
      return;
    }
    if (viewMode === "under") {''')
patch('public/src/rain-ripples.js','size = 48, max = 1024','size = 48, max = 4096')
patch('public/src/rain-ripples.js','A=.0017*','A=.0034*')
patch('public/src/water-shaders.js',''' if(uRainEnable>.5){vec2 ruv=vWorld.xz/uRainRingSize+.5;if(inScreen(ruv)){vec4 rings=texture(uRainRing,ruv);tx.y+=rings.x;tz.y+=rings.y;}}''',''' float rainReactive=0.;
 if(uRainEnable>.5){vec2 ruv=vWorld.xz/uRainRingSize+.5;if(inScreen(ruv)){vec4 rings=texture(uRainRing,ruv);tx.y+=rings.x;tz.y+=rings.y;rainReactive=length(rings.xy);}}''')
patch('public/src/water-shaders.js','''fragColor=vec4(max(color,vec3(0.)),1.);motion''','''fragColor=vec4(max(color,vec3(0.)),rainReactive>.002?.5:1.);motion''')
p=root/'capture/shots.json';shots=json.loads(p.read_text())
shots[17].update(eye=[-1,.85,1.6],eyeEnd=[-1.3,.8,1.2],target=[-4.5,0,-2.8],targetEnd=[-4.5,0,-2.8])
shots[19].update(scene='bubbles',eye=[0,-2.6,1],eyeEnd=[-1.5,-2.3,-.4],target=[-4,-2,-4],targetEnd=[-4,-2,-4])
p.write_text(json.dumps(shots,indent=2))
(root/'docs/final-visual-corrections.md').write_text('''# Final visual review\n\nThe original bubble close-up was occluded by a scene rock and its deliberate emitter lay inside that rock. A dedicated bubble preset now places the source in open water and uses a clear sight line. Bubble births remain an explicit secondary-effects source, not resolved air entrainment.\n\nRain birth and respawn positions now cover a 46 m footprint. Dispersive optical ring packets have 3.4 mm base amplitude, a 4096-event budget and a reactive temporal mask so fast-changing fine slopes do not inherit stale ocean history. These packets are a sub-grid visual model, not validated droplet-impact physics.\n\nOnly rain shots 16/17 and bubble shot 19 are reshot. All other 27 recordings are retained. No movie is upscaled or frame-interpolated.\n''')
