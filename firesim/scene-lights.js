/* User lighting rig. Intensities are scene-relative, colors are converted from
 * sRGB to linear. Bounce is a ten-patch, one-bounce diffuse approximation. */
(() => {
  'use strict';
  const presets = {
    fire: {ambient:0, tint:'#a9c9ff', bounce:0, key:0, keyColor:'#fff0da', keyAz:-55, keyHeight:5, keyBeam:38, rim:0, rimColor:'#96bfff', rimAz:145, rimHeight:4, rimBeam:42, aimX:0, aimY:1.4},
    studio: {ambient:.35, tint:'#b4c8e6', bounce:1, key:110, keyColor:'#fff0da', keyAz:-55, keyHeight:5, keyBeam:38, rim:145, rimColor:'#96bfff', rimAz:145, rimHeight:4, rimBeam:42, aimX:0, aimY:1.4},
    moon: {ambient:.12, tint:'#6f9de8', bounce:.7, key:65, keyColor:'#97baff', keyAz:-70, keyHeight:6, keyBeam:48, rim:180, rimColor:'#b4d5ff', rimAz:150, rimHeight:5, rimBeam:30, aimX:0, aimY:1.8}
  };
  const names={fire:'Fire only',studio:'Studio',moon:'Moonlight',ember:'Ember chamber',warm:'Warm studio',cold:'Cold rim',noir:'Noir spotlight',sunset:'Sunset',dawn:'Blue hour',neon:'Neon cyan / magenta',red:'Red alert',green:'Industrial green',violet:'Violet haze',overhead:'Overhead pool',silhouette:'Silhouette',gallery:'Neutral gallery',transport:'Neutral transport',side:'Grazing side light',backlight:'White backlight',shadow:'Hard shadow study',cross:'Opposed white lights',flat:'Ambient density check'};
  const variants={
   ember:{ambient:.015,bounce:1.4,key:0,rim:0},
   warm:{ambient:.16,tint:'#ffd6a0',bounce:1.1,key:150,keyColor:'#ffcb83',rim:85,rimColor:'#ffe6c5'},
   cold:{ambient:.06,tint:'#6582ad',key:25,keyColor:'#b2ceff',rim:230,rimColor:'#9dcaff',rimAz:155,bounce:.5},
   noir:{ambient:0,key:240,keyColor:'#ffffff',keyBeam:18,rim:0,bounce:.2},
   sunset:{ambient:.12,tint:'#ffc18e',key:220,keyColor:'#ff8c45',keyAz:-85,keyHeight:2.1,keyBeam:65,rim:100,rimColor:'#a6b8ff',bounce:1.1},
   dawn:{ambient:.22,tint:'#638dcc',key:70,keyColor:'#b7ceff',keyBeam:70,rim:100,rimColor:'#ffab7c',bounce:.8},
   neon:{ambient:.04,key:200,keyColor:'#21e6ff',keyAz:-80,rim:230,rimColor:'#fc56cd',rimAz:105,bounce:1.3},
   red:{ambient:.035,tint:'#e75640',key:270,keyColor:'#ff3826',keyBeam:58,rim:65,rimColor:'#ffbd68',bounce:1.2},
   green:{ambient:.08,tint:'#82aa94',key:180,keyColor:'#b4ffd5',rim:120,rimColor:'#73b0b6',bounce:.8},
   violet:{ambient:.1,tint:'#a18fcf',key:160,keyColor:'#d397ff',rim:200,rimColor:'#769cff',bounce:1},
   overhead:{ambient:.02,key:320,keyColor:'#fff1d2',keyAz:0,keyHeight:7,keyBeam:26,rim:0,bounce:1.3},
   silhouette:{ambient:.025,key:0,rim:320,rimColor:'#d1e1ff',rimAz:180,rimHeight:3.5,rimBeam:60,bounce:.25},
   transport:{ambient:.3,tint:'#ffffff',key:180,keyColor:'#ffffff',keyAz:-45,keyHeight:5,keyBeam:85,rim:160,rimColor:'#ffffff',rimAz:150,rimHeight:5,rimBeam:85,bounce:0,aimY:2.4},
   side:{ambient:.04,tint:'#ffffff',key:210,keyColor:'#ffffff',keyAz:-90,keyHeight:3.8,keyBeam:70,rim:70,rimColor:'#ffffff',rimAz:95,rimHeight:4,rimBeam:70,bounce:0,aimY:2.2},
   backlight:{ambient:.025,tint:'#ffffff',key:0,rim:300,rimColor:'#ffffff',rimAz:180,rimHeight:4.5,rimBeam:85,bounce:0,aimY:2.5},
   shadow:{ambient:.025,tint:'#ffffff',key:300,keyColor:'#ffffff',keyAz:-65,keyHeight:6,keyBeam:32,rim:0,bounce:0,aimY:1.8},
   cross:{ambient:.07,tint:'#ffffff',key:190,keyColor:'#ffffff',keyAz:-90,keyHeight:4,keyBeam:85,rim:190,rimColor:'#ffffff',rimAz:90,rimHeight:4,rimBeam:85,bounce:0,aimY:2},
   flat:{ambient:1.2,tint:'#ffffff',key:0,rim:0,bounce:0},
   gallery:{ambient:.45,tint:'#ffffff',key:130,keyColor:'#ffffff',keyBeam:72,rim:100,rimColor:'#ffffff',rimBeam:70,bounce:1}
  };
  for(const [id,values] of Object.entries(variants))presets[id]={...presets.studio,...values};
  const diagnosticRigs={
   'material-white':{ambient:.18,tint:'#ffffff',bounce:0,key:190,keyColor:'#ffffff',keyAz:-35,keyHeight:4.5,keyBeam:85,rim:80,rimColor:'#ffffff',rimAz:135,rimHeight:4,rimBeam:85,aimY:1.4},
   'bark-rake':{ambient:.035,tint:'#ffffff',bounce:0,key:240,keyColor:'#ffffff',keyAz:-85,keyHeight:1.8,keyBeam:65,rim:0,aimY:1.1},
   'bark-rake-reverse':{ambient:.035,tint:'#ffffff',bounce:0,key:240,keyColor:'#ffffff',keyAz:85,keyHeight:1.8,keyBeam:65,rim:0,aimY:1.1},
   'canopy-back':{ambient:.06,tint:'#ffffff',bounce:0,key:35,keyColor:'#ffffff',keyAz:-30,keyHeight:4,keyBeam:85,rim:260,rimColor:'#ffffff',rimAz:180,rimHeight:3.5,rimBeam:85,aimY:2.1},
   'bounce-check':{...presets.fire,bounce:1},
   'overhead-white':{ambient:.02,tint:'#ffffff',bounce:0,key:300,keyColor:'#ffffff',keyAz:0,keyHeight:7,keyBeam:70,rim:0,aimY:1.5}
  };
  for(const [id,values] of Object.entries(diagnosticRigs))presets[id]={...presets.studio,...values};
  Object.assign(names,{'material-white':'Material · neutral white','bark-rake':'Relief · left grazing','bark-rake-reverse':'Relief · right grazing','canopy-back':'Canopy · backlit','bounce-check':'Fire · bounce comparison','overhead-white':'Occlusion · overhead white'});
  const descriptions={transport:'Broad white lights reveal soot without a colored wash or room bounce.',side:'Grazing illumination reveals folds, thin edges and plume depth.',backlight:'A broad white rim tests smoke silhouettes and light transmission.',shadow:'One narrow white spotlight exposes self-shadowing and floor shadows.',cross:'Opposing white spotlights reveal thin sheets from both sides.',flat:'Uniform white ambient light isolates density from directional shadows.'};
  Object.assign(descriptions,{'material-white':'Neutral key and restrained fill expose albedo, char and geometry without a colored wash.','bark-rake':'Low left light exposes raised bark, recesses and crack opening. No bounce.','bark-rake-reverse':'Exactly the same power and height as left grazing, with the direction reversed.','canopy-back':'White backlight separates individual leaves and smoke edges; a small neutral fill keeps the trunk readable.','bounce-check':'Same zero-external-light rig as Fire only, with one-bounce room illumination enabled.','overhead-white':'High white key tests branch overlap, cavities and cast shadows.',fire:'No external light or bounce. Check whether the fire alone illuminates the scene.'});
  const diagnostic=new Set(['fire','material-white','bark-rake','bark-rake-reverse','canopy-back','overhead-white','transport','backlight','shadow','cross','flat','bounce-check']);
  let state={...presets.fire};
  try {const saved=JSON.parse(localStorage.getItem('cybr-fire-lights-v1'));if(saved&&typeof saved==='object')for(const k of Object.keys(state))if(typeof saved[k]===typeof state[k])state[k]=saved[k];} catch {}
  const panel=document.querySelector('#lighting-controls');
  const slider=(key,label,min,max,step)=>`<label>${label}<input aria-label="${label}" data-light="${key}" type="range" min="${min}" max="${max}" step="${step}"><output data-value="${key}"></output></label>`;
  const color=(key,label)=>`<label>${label}<input aria-label="${label}" data-light="${key}" type="color"></label>`;
  panel.innerHTML=`<div class="lighting-heading"><label>Lighting <select id="lighting-preset">${[true,false].map(test=>`<optgroup label="${test?'Inspection rigs':'Creative looks'}">${Object.keys(presets).filter(id=>diagnostic.has(id)===test).map(id=>`<option value="${id}">${names[id]}</option>`).join('')}</optgroup>`).join('')}<option value="custom">Custom</option></select></label><span>Lights illuminate smoke with or without the room.</span></div><div class="lighting-grid"><fieldset><legend>Environment</legend>${slider('ambient','Ambient fill',0,2,.005)}${color('tint','Ambient color')}${slider('bounce','Room bounce',0,2,.1)}<small>Approximate single-bounce GI · room required</small></fieldset><fieldset><legend>Key spotlight</legend>${slider('key','Key intensity',0,350,5)}${color('keyColor','Key color')}${slider('keyAz','Key direction',-180,180,5)}${slider('keyHeight','Key height',1,7,.1)}${slider('keyBeam','Key beam width',10,85,1)}</fieldset><fieldset><legend>Rim spotlight</legend>${slider('rim','Rim intensity',0,350,5)}${color('rimColor','Rim color')}${slider('rimAz','Rim direction',-180,180,5)}${slider('rimHeight','Rim height',1,7,.1)}${slider('rimBeam','Rim beam width',10,85,1)}</fieldset></div><div class="light-aim">${slider('aimX','Light aim left / right',-5,5,.1)}${slider('aimY','Light aim height',0,6,.1)}</div>`;
  const controls=[...panel.querySelectorAll('[data-light]')];
  // Clamp stored values to the current UI schema before sending them to the GPU.
  for(const el of controls){const k=el.dataset.light;if(el.type==='range')state[k]=Number.isFinite(state[k])?Math.min(+el.max,Math.max(+el.min,state[k])):presets.fire[k];else if(!/^#[0-9a-f]{6}$/i.test(state[k]))state[k]=presets.fire[k];}
  let revision=0,transient=false;
  const sync=()=>{for(const el of controls){const k=el.dataset.light;el.value=state[k];const out=panel.querySelector(`[data-value="${k}"]`);if(out)out.value=Number(state[k]).toFixed(+el.step<.01?3:+el.step<.1?2:+el.step<1?1:0);}panel.querySelector('#lighting-preset').value=Object.keys(presets).find(p=>Object.keys(state).every(k=>state[k]===presets[p][k]))||'custom';};
  const changed=()=>{revision++;if(!transient)try{localStorage.setItem('cybr-fire-lights-v1',JSON.stringify(state));}catch{}sync();window.dispatchEvent(new Event('scene-light-change'));};
  for(const el of controls)el.addEventListener('input',()=>{state[el.dataset.light]=el.type==='color'?el.value:+el.value;changed();});
  panel.querySelector('#lighting-preset').onchange=e=>{if(presets[e.target.value]){state={...presets[e.target.value]};changed();}};
  const roomToggle=document.querySelector('#room');
  roomToggle.checked=new URL(location.href).searchParams.get('room')!=='0';
  const syncRoom=()=>{const bounce=panel.querySelector('[data-light="bounce"]');bounce.disabled=!roomToggle.checked;bounce.title=roomToggle.checked?'Diffuse light reflected from the room':'Enable Dark room to use bounce lighting';};
  roomToggle.addEventListener('change',syncRoom);
  sync();syncRoom();
  const linear=hex=>[1,3,5].map(i=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});
  window.SceneLights={
    setTransient(value){transient=!!value;},
    get catalog(){return Object.entries(presets).map(([id,values])=>({id,name:names[id],diagnostic:diagnostic.has(id),description:descriptions[id],values:{...values}}));},
    get snapshot(){return {...state};},
    apply(values){
      const input=typeof values==='string'?presets[values]:values;if(!input)return false;
      for(const el of controls){const k=el.dataset.light,v=input[k];if(el.type==='color'){if(typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v))state[k]=v;}else if(typeof v==='number'&&Number.isFinite(v))state[k]=Math.min(+el.max,Math.max(+el.min,v));}
      changed();return true;
    },
    get revision(){return revision;},
    get active(){return state.ambient>0||state.key>0||state.rim>0;},
    get bounce(){return state.bounce;},
    bind(gl,uniform,roomEnabled){
      gl.uniform3fv(uniform('ambientLight'),linear(state.tint).map(v=>v*state.ambient));
      gl.uniform1f(uniform('bounceGain'),roomEnabled?state.bounce:0);
      for(const [i,k] of ['key','rim'].entries()){
        const a=state[k+'Az']*Math.PI/180,p=[Math.sin(a)*5,state[k+'Height'],1.2+Math.cos(a)*3];
        const d=[state.aimX-p[0],state.aimY-p[1],-p[2]],length=Math.hypot(...d);
        gl.uniform3fv(uniform(`spotPosition[${i}]`),p);
        gl.uniform3fv(uniform(`spotDirection[${i}]`),d.map(v=>v/Math.max(length,.001)));
        gl.uniform3fv(uniform(`spotPower[${i}]`),linear(state[k+'Color']).map(v=>v*state[k]));
        const outer=state[k+'Beam']*.5*Math.PI/180;
        gl.uniform2f(uniform(`spotCone[${i}]`),Math.cos(outer),Math.cos(outer*.7));
      }
    }
  };
})();
