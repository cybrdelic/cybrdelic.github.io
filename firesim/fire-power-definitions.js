// Shared gameplay timing and source identity. Distances are scene units and
// clocks are simulation seconds; none of these entries changes grid quality.
const rows = [
 ['radial-blast','Radial blast',false,true,.95,.18,2.4,12,'ground'],
 ['fireball','Fireball',false,false,1.8,.22,3.1,12,'projectile'],
 ['fire-rain','Fire rain',true,true,0,.25,2.5,8,'field'],
 ['fire-tornado','Fire tornado',true,true,0,.4,2.5,12,'field'],
 ['floor-trail','Fire floor trail',true,true,0,0,3,8,'trail'],
 ['combustion-bomb','Combustion bomb',false,true,1.85,1.2,2,12,'ground'],
 ['flame-dash','Flame dash',false,true,1.8,.18,3.6,14,'ground'],
 ['flame-whip','Flame whip',false,false,2.25,.3,2.8,24,'aim'],
 ['ember-orbit','Ember orbit',false,false,3.2,.35,2.7,12,'aim'],
 ['heat-seeker','Heat seeker',false,false,2.45,.28,3.1,12,'projectile'],
 ['phoenix-dive','Phoenix dive',false,true,3.1,.35,2.7,14,'ground'],
 ['dragon-breath','Dragon breath',true,false,0,.4,3.2,12,'aim'],
 ['solar-lance','Solar lance',false,false,1.65,.5,3.4,24,'projectile'],
 ['flame-wall','Flame wall',false,true,4.2,.45,2.4,10,'ground'],
 ['inferno-ring','Inferno ring',false,true,4.5,.35,2,12,'ground'],
 ['meteor-strike','Meteor strike',false,true,2.7,.25,2.4,16,'ground'],
 ['meteor-barrage','Meteor barrage',false,true,3.9,.3,2.6,16,'ground'],
 ['eruption-chain','Eruption chain',false,true,3.15,.28,3.2,14,'ground'],
 ['combustion-mine','Combustion mine',false,true,3.2,1.8,2.2,12,'ground'],
 ['vortex-burst','Vortex burst',false,true,2.8,.3,2.3,14,'ground'],
 ['flame-serpent','Flame serpent',false,false,3.05,.3,3.4,18,'projectile'],
 ['cinder-scatter','Cinder scatter',false,false,2.25,.32,3,14,'projectile'],
 ['fire-cross','Fire cross',false,true,2.5,.3,2.8,12,'ground'],
 ['flame-crescent','Flame crescent',false,false,2.7,.25,3,12,'aim'],
];
// Boundaries match the authored source trajectories. Late impacts are covered
// before delayed GPU velocity telemetry arrives, including staggered attacks.
const phases = [
 [[.18,'Wind-up'],[.63,'Rolling blast'],[.95,'Follow-through']],
 [[.22,'Wind-up'],[.87,'Travel'],[1.29,'Impact'],[1.8,'Follow-through']],
 [[.25,'Wind-up']],[[.4,'Wind-up']],[],
 [[1.2,'Fuse'],[1.49,'Detonation'],[1.85,'Follow-through']],
 [[.18,'Wind-up'],[1.13,'Dash'],[1.55,'Impact'],[1.8,'Follow-through']],
 [[.3,'Wind-up'],[1.05,'Sweep'],[1.47,'Crack'],[2.25,'Recovery']],
 [[.35,'Wind-up'],[1.55,'Orbit'],[2.45,'Volley'],[2.87,'Impact'],[3.2,'Follow-through']],
 [[.28,'Wind-up'],[1.38,'Seeking'],[1.8,'Impact'],[2.45,'Follow-through']],
 [[.35,'Wind-up'],[1.25,'Ascent'],[1.95,'Dive'],[2.6,'Impact'],[3.1,'Follow-through']],
 [[.4,'Inhale']],
 [[.5,'Wind-up'],[.72,'Lance'],[1.14,'Impact'],[1.65,'Follow-through']],
 [[.45,'Floor seam'],[1.21,'Rise'],[2.55,'Barricade'],[3.7,'Collapse'],[4.2,'Follow-through']],
 [[.35,'Wind-up'],[.8,'Rise'],[2.65,'Inward pulses'],[3.65,'Collapse'],[4.5,'Follow-through']],
 [[.25,'Wind-up'],[1.15,'Descent'],[1.75,'Impact'],[2.7,'Follow-through']],
 [[.3,'Wind-up'],[2.15,'Staggered meteors'],[2.57,'Impacts'],[3.9,'Follow-through']],
 [[.28,'Wind-up'],[1.52,'Chained eruptions'],[1.97,'Impact'],[3.15,'Follow-through']],
 [[1.8,'Armed'],[2.3,'Detonation'],[3.2,'Follow-through']],
 [[.3,'Wind-up'],[1.4,'Gathering vortex'],[2.,'Release'],[2.8,'Follow-through']],
 [[.3,'Wind-up'],[1.8,'Serpent'],[2.22,'Impact'],[3.05,'Follow-through']],
 [[.32,'Wind-up'],[1.33,'Scatter'],[1.75,'Impacts'],[2.25,'Follow-through']],
 [[.3,'Wind-up'],[1.05,'Crossing sweeps'],[1.47,'Convergence'],[2.5,'Follow-through']],
 [[.25,'Wind-up'],[.95,'Outbound'],[1.65,'Hooked return'],[2.7,'Follow-through']],
];
const impacts = [[.18], [.22,.87], [], [], [], [1.2], [.18,1.13], [.3,1.05], [1.55,2.25,2.35,2.45], [.28,1.38], [.35,1.25,1.95], [], [.5,.72], [.45], [.35], [.25,1.15], [.3,.8,1.05,1.3,1.6,2.15], [.28,.58,.7,1.05,1.12,1.52], [1.8], [.3,1.4], [.3,1.8], [.32,.97,1.06,1.15,1.24,1.33], [.3,.5,1.05], [.25]];
const blastWindows = [[[.18,.63]],[[.87,1.29]],[],[],[],[[1.2,1.49]],[[1.13,1.55]],[[1.05,1.47]],[[2.25,2.87]],[[1.38,1.8]],[[1.95,2.6]],[],[[.72,1.14]],[],[],[[1.15,1.75]],[[1.05,2.57]],[[.58,1.97]],[[1.8,2.3]],[[1.4,2]],[[1.8,2.22]],[[.97,1.75]],[[1.05,1.47]],[]];
export const POWER_DEFINITIONS = Object.freeze(rows.map((r,i)=>Object.freeze({
 id:r[0],kind:i+1,name:r[1],continuous:r[2],floor:r[3],duration:r[4],windup:r[5],range:r[6],maxSpeed:r[7],targetMode:r[8],
 defaultHeading:['flame-wall','phoenix-dive'].includes(r[0])?90:0,
 movable:r[2],floorFuel:r[8]==='trail',hold:['fireball','solar-lance','cinder-scatter','heat-seeker'].includes(r[0]),
 impactMargin:['fireball','flame-dash','ember-orbit','heat-seeker','phoenix-dive','dragon-breath','solar-lance','meteor-strike','meteor-barrage','eruption-chain','flame-serpent','cinder-scatter'].includes(r[0])?2.2:r[0]==='flame-crescent'?1.2:0,
 phases:Object.freeze(phases[i].map(p=>Object.freeze({until:p[0],name:p[1]}))),
 blastWindows:Object.freeze(blastWindows[i].map(w=>Object.freeze({from:w[0],until:w[1]}))),
 impulses:Object.freeze(impacts[i].map(at=>Object.freeze({at,span:.45,speed:r[7]}))),
 hint:r[2]?'Drag to move the active power. Stop power ends fresh fuel; its wake keeps evolving.':
  ['fireball','solar-lance','cinder-scatter','heat-seeker'].includes(r[0])?'Hold to charge, drag to aim, release to cast. Cast or B runs the complete sequence.':
  'Click to cast the complete sequence. Repeat casts overlap; Cast or B repeats at the current origin.',
})));
export const POWER_CAST_CAPACITY=4;
export function powerExpansion(definition,age){return definition?.blastWindows.some(w=>age>=w.from&&age<=w.until)?18:4;}
const shaderNumber=v=>Number.isInteger(v)?v+'.':String(v);
export const powerExpansionWGSL = 'fn powerCastExpansion(kind:f32,age:f32)->f32{'+POWER_DEFINITIONS.flatMap(d=>d.blastWindows.map(w=>`if(kind>${d.kind-.5}&&kind<${d.kind+.5}&&age>=${shaderNumber(w.from)}&&age<=${shaderNumber(w.until)}){return 18.;}`)).join('')+'return 4.;}';
export function powerPhase(definition,age,held=false){
 if(!definition||age<0)return {name:'Ready',progress:0};
 if(age<definition.windup||held)return {name:held?'Charging':definition.phases[0]?.name||'Wind-up',progress:definition.windup?Math.min(age/definition.windup,1):1};
 if(definition.continuous)return {name:definition.floorFuel?'Painting':'Sustaining',progress:1};
 let previous=0;for(const phase of definition.phases){if(age<phase.until)return {name:phase.name,progress:Math.max(0,Math.min((age-previous)/Math.max(.01,phase.until-previous),1))};previous=phase.until;}
 return {name:'Follow-through',progress:1};
}
export function powerSpeedFloor(definition,age,dt=0){
 if(!definition)return 0;
 // A late impact needs protection before delayed velocity telemetry arrives.
 if(definition.continuous)return definition.maxSpeed;
 if(age<0||age>definition.duration)return 0;
 return age+dt>=definition.windup?definition.maxSpeed:Math.min(definition.maxSpeed,8);
}
