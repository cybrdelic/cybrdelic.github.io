// Reduced two-temperature wood model. Material data are taken from the pine
// calibration in Jooma et al., Fuel 380 (2025), Appendix A.1–A.3:
// https://sam.ensam.eu/bitstream/handle/10985/26063/i2m-fuel-jooma-2025.pdf
// The three dry-component rates are collapsed into ONE virgin inventory;
// this is not the paper's multi-component model or an engineering fire solver.
// Char oxidation, surface penetration, retained heat and damage below are
// explicit reduced-model assumptions. Demo time scaling is separate from SI
// material coefficients; it advances wood while the gas clock stays realtime.
export const WOOD_THERMO = Object.freeze({
  ambientK: 293.15,
  heatScaleK: 500,
  gasAmbientK: 300,
  gasHeatScaleK: 1200,
  gasFuelDensityKgM3: 1,
  dryDensityKgM3: 495,
  dryMoistureFraction: 30 / 495,
  dampMoistureFraction: 0.45,
  gasConstant: 8.314462618,
  demoTimeScale: 12,
  starterFluxWm2: 280000,
  surfaceDepthM: 0.0015,
  foliageDepthM: 0.0002,
  transverseConductivityWmK: 0.15,
  longitudinalConductivityRatio: 1.9,
  convectionWm2K: 25,
  emissivity: 0.85,
  localRadiationViewFactor: 0.35,
  latentWaterJkg: 2270000,
  pyrolysisSinkJkg: 600000,
  waterA: 14800,
  waterEaJmol: 41300,
  // Intrinsic dry fractions .09/.13/.11, divided by their sum .33.
  dryComponents: Object.freeze([
    Object.freeze({ weight: 9 / 33, A: 1.17e7, EaJmol: 102521, charYield: 0.32 }),
    Object.freeze({ weight: 13 / 33, A: 9.56e17, EaJmol: 237194, charYield: 0.34 }),
    Object.freeze({ weight: 11 / 33, A: 1.802, EaJmol: 37118, charYield: 0.20 }),
  ]),
  // Oxygen-limited char oxidation surrogate, not fitted by the inert TGA.
  charOxidationA: 2000,
  charOxidationEaJmol: 85000,
  charOxidationHeatJkg: 28000000,
  retainedCharHeatFraction: 0.025,
  // Reduced strain/stiffness diagnostics, not a fracture criterion.
  expansionTransversePerK: 2.5e-5,
  shrinkTransverseFraction: 0.20,
  shrinkLongitudinalFraction: 0.10,
  crackElasticAllowance: 0.004,
  crackStrainRange: 0.08,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const gasHeatToWoodHeat = heat => Math.max(0, (300 + 1200 * heat - 293.15) / 500);
export const woodHeatToGasHeat = heat => Math.max(0, (293.15 + 500 * heat - 300) / 1200);
export function woodHeatCapacity(T, char = false) {
  return char
    ? 1000 * Math.max(0.5, 4.7256e-10 * T ** 3 - 1.3099e-6 * T ** 2 + 0.0016027 * T + 1.0629)
    : 1000 * (2.3 - 1.15 * Math.exp(-0.0055 * T));
}
export function woodConductivity(T, charFraction = 0) {
  const virgin = 0.15 + 0.00005 * Math.max(T - 293.15, 0);
  const char = clamp(0.09 + 0.000135 * Math.max(T - 293.15, 0), 0.09, 0.19);
  return virgin * (1 - clamp(charFraction, 0, 1)) + char * clamp(charFraction, 0, 1);
}
export function woodPyrolysisRate(T) {
  let rate = 0, retained = 0;
  for (const component of WOOD_THERMO.dryComponents) {
    const k = component.weight * component.A * Math.exp(-component.EaJmol / (WOOD_THERMO.gasConstant * Math.max(T, 1)));
    rate += k; retained += k * component.charYield;
  }
  return { rate, charYield: retained / Math.max(rate, 1e-30) };
}

// stock=[virgin fraction, normalized surface T, volatile fraction/s, char fraction]
// wear =[water/dry-mass fraction, normalized core T, irreversible crack, stiffness]
// Mass is relative to INITIAL dry wood. capacity=dry density/495kg/m³;
// cellSize is physical thickness in metres. ignite is W/m²; conduction is
// normalized-temperature/s from the exterior solid-grid diffusion operator.
// Released water/oxidation products are reported; neither is combustible fuel.
export function advanceWood({ stock, wear, incomingHeat = 0, dt = 0, ignite = 0,
  oxygen = 1, capacity = 1, cellSize = 3 / 64, material = 1,
  conduction = 0, timeScale = WOOD_THERMO.demoTimeScale }) {
  const values = [...stock, ...wear, incomingHeat, dt, ignite, oxygen, capacity, cellSize, material, conduction, timeScale];
  if (values.some(v => !Number.isFinite(v))) throw Error('Wood state must be finite');
  const s = [clamp(stock[0], 0, 1), Math.max(stock[1], 0), 0, clamp(stock[3], 0, 1)];
  const w = [Math.max(wear[0], 0), Math.max(wear[1], 0), clamp(wear[2], 0, 1), clamp(wear[3], 0, 1)];
  if (dt <= 0 || timeScale <= 0) return { stock: s, wear: w, volatileMass: 0, oxidizedMass: 0, evaporatedMass: 0 };
  const duration = dt * timeScale, h = Math.max(cellSize, 0.0001);
  const penetration = Math.min(material > 7.5 ? 0.0002 : 0.0015, h * 0.5), f = penetration / h;
  const rho = 495 * Math.max(capacity, 0.000001);
  let Ts = 293.15 + s[1] * 500, Tc = 293.15 + w[1] * 500;
  const cp = Math.max(s[0] * woodHeatCapacity((Ts + Tc) * 0.5) + s[3] * woodHeatCapacity((Ts + Tc) * 0.5, true) + w[0] * 4180, 40);
  const Cs = rho * h * cp * f, Cc = rho * h * cp * (1 - f);
  const gasT = 293.15 + Math.max(incomingHeat, 0) * 500;
  const hc = 25 + 0.85 * 0.35 * 5.670374419e-8 * (gasT + Ts) * (gasT * gasT + Ts * Ts);
  const k = woodConductivity((Ts + Tc) * 0.5, s[3]);
  // Char adds thermal resistance; a cold char layer cannot manufacture heat.
  const charDepth = Math.min(h * s[3] * 2.25, h * 0.8);
  const transfer = 1 / (1 / hc + charDepth / Math.max(k, 0.01));
  const equilibrium = gasT + Math.max(ignite, 0) / Math.max(transfer, 0.001);
  Ts += (equilibrium - Ts) * -Math.expm1(-transfer * duration / Cs);
  const g = k / Math.max(h * 0.5, 0.00005), reciprocal = 1 / Cs + 1 / Cc;
  const exchanged = (Ts - Tc) * -Math.expm1(-g * reciprocal * duration) / reciprocal;
  Ts -= exchanged / Cs; Tc += exchanged / Cc;
  // Same solid-grid diffusion increment in both thermal nodes. The caller
  // bounds its explicit stencil to avoid overshooting neighbour extrema.
  Ts = Math.max(293.15, Ts + conduction * duration * 500);
  Tc = Math.max(293.15, Tc + conduction * duration * 500);
  const meanT = Ts * f + Tc * (1 - f);
  const waterK = 14800 * Math.exp(-41300 / (8.314462618 * Math.max(meanT, 1)));
  const requestedWater = w[0] * -Math.expm1(-waterK * duration);
  const requestedEvaporation = Math.min(requestedWater, Math.max(meanT - 293.15, 0) * cp / 2270000);
  const nextWater = Math.max(0, Math.min(w[0], Math.fround(w[0] - requestedEvaporation)));
  const evaporatedMass = w[0] - nextWater;
  w[0] = nextWater;
  const thermalEnergy = Math.max(meanT - 293.15, 0) * cp;
  const retainedEnergy = Math.max(0, 1 - evaporatedMass * 2270000 / Math.max(thermalEnergy, 1e-20));
  Ts = 293.15 + (Ts - 293.15) * retainedEnergy;
  Tc = 293.15 + (Tc - 293.15) * retainedEnergy;
  const surfaceK = woodPyrolysisRate(Ts), coreK = woodPyrolysisRate(Tc);
  const surfaceLoss = Math.min(s[0] * f * -Math.expm1(-surfaceK.rate * duration), Math.max(Ts - 293.15, 0) * cp * f / 600000);
  const coreLoss = Math.min(s[0] * (1 - f) * -Math.expm1(-coreK.rate * duration), Math.max(Tc - 293.15, 0) * cp * (1 - f) / 600000);
  // Account the representable F32 stock change, not an unrepresentable
  // requested loss that could emit vapor while the stored virgin stayed1.
  const nextVirgin = Math.max(0, Math.min(s[0], Math.fround(s[0] - Math.min(s[0], surfaceLoss + coreLoss))));
  const consumed = s[0] - nextVirgin;
  const represented = consumed / Math.max(surfaceLoss + coreLoss, 1e-30);
  const candidateChar = Math.fround(s[3] + (surfaceLoss * surfaceK.charYield + coreLoss * coreK.charYield) * represented);
  const candidateGain = candidateChar - s[3];
  // Near the last F32 ulp a char increment can round above the entire loss.
  // Put that unrepresentable remainder into vapor rather than create mass.
  const madeChar = candidateGain >= 0 && candidateGain <= consumed ? candidateGain : 0;
  const nextChar = s[3] + madeChar;
  const volatileMass = consumed - madeChar;
  s[0] = nextVirgin; s[3] = nextChar;
  Ts = Math.max(293.15, Ts - surfaceLoss * represented * 600000 / (cp * f));
  Tc = Math.max(293.15, Tc - coreLoss * represented * 600000 / (cp * (1 - f)));
  const oxidationK = 2000 * Math.exp(-85000 / (8.314462618 * Math.max(Ts, 1))) * clamp(oxygen, 0, 1);
  const nextCarbon = Math.max(0, Math.min(s[3], Math.fround(s[3] * Math.exp(-oxidationK * duration))));
  const oxidizedMass = s[3] - nextCarbon;
  s[3] = nextCarbon;
  Ts += oxidizedMass * 28000000 * 0.025 / (cp * f);
  s[1] = Math.max(Ts - 293.15, 0) / 500; s[2] = volatileMass / dt;
  w[1] = Math.max(Tc - 293.15, 0) / 500;
  const strain = Math.abs(Ts - Tc) * 2.5e-5 + (1 - s[0]) * 0.20;
  w[2] = Math.max(w[2], clamp((strain - 0.004) / 0.08, 0, 1));
  const hotSoftening = clamp(1 - Math.max((Ts + Tc) * 0.5 - 373.15, 0) / 700, 0.04, 1);
  w[3] = Math.min(w[3], (s[0] + s[3] * 0.15) ** 2 * hotSoftening);
  return { stock: s, wear: w, volatileMass, oxidizedMass, evaporatedMass };
}

const shaderHelpers = `
fn gasHeatToWoodHeat(heat:f32)->f32{return max(0.,(300.+1200.*heat-293.15)/500.);}
fn woodHeatToGasHeat(heat:f32)->f32{return max(0.,(293.15+500.*heat-300.)/1200.);}
fn woodCp(T:f32,charred:f32)->f32{
 let virgin:f32=1000.*(2.3-1.15*exp(-.0055*T));
 let charcoal:f32=1000.*max(.5,4.7256e-10*T*T*T-1.3099e-6*T*T+.0016027*T+1.0629);
 return mix(virgin,charcoal,charred);
}
fn woodK(T:f32,charred:f32)->f32{
 let virgin:f32=.15+.00005*max(T-293.15,0.);
 let charcoal:f32=clamp(.09+.000135*max(T-293.15,0.),.09,.19);
 return mix(virgin,charcoal,clamp(charred,0.,1.));
}
fn woodPyro(T:f32)->vec2f{
 let inv:f32=1./(8.314462618*max(T,1.));
 let hemi:f32=(9./33.)*1.17e7*exp(-102521.*inv);
 let cell:f32=(13./33.)*9.56e17*exp(-237194.*inv);
 let lignin:f32=(11./33.)*1.802*exp(-37118.*inv);
 let rate:f32=hemi+cell+lignin;
 return vec2f(rate,(hemi*.32+cell*.34+lignin*.20)/max(rate,1e-30));
}
// Avoid loss of 1-exp(-x) at very small CFL partitions in f32.
fn woodFraction(x:f32)->f32{
 let a:f32=max(x,0.);
 if(a<.001){return a*(1.-a*(.5-a/6.));}
 return 1.-exp(-a);
}
`;
const stepBody = `
 var s:vec4f=vec4f(clamp(stock.x,0.,1.),max(stock.y,0.),0.,clamp(stock.w,0.,1.));
 var w:vec4f=vec4f(max(wear.x,0.),max(wear.y,0.),clamp(wear.z,0.,1.),clamp(wear.w,0.,1.));
 if(dt<=0.||timeScale<=0.){return WoodResult(s,w,0.,0.,0.);}
 let duration:f32=dt*timeScale;let h:f32=max(cellSize,.0001);
 var penetration:f32=.0015;if(material>7.5){penetration=.0002;}
 penetration=min(penetration,h*.5);let f:f32=penetration/h;
 let rho:f32=495.*max(capacity,.000001);
 var Ts:f32=293.15+s.y*500.;var Tc:f32=293.15+w.y*500.;
 let cp:f32=max(s.x*woodCp((Ts+Tc)*.5,0.)+s.w*woodCp((Ts+Tc)*.5,1.)+w.x*4180.,40.);
 let Cs:f32=rho*h*cp*f;let Cc:f32=rho*h*cp*(1.-f);
 let gasT:f32=293.15+max(incomingHeat,0.)*500.;
 let hc:f32=25.+.85*.35*5.670374419e-8*(gasT+Ts)*(gasT*gasT+Ts*Ts);
 let conductivity:f32=woodK((Ts+Tc)*.5,s.w);
 let charDepth:f32=min(h*s.w*2.25,h*.8);
 let transfer:f32=1./(1./hc+charDepth/max(conductivity,.01));
 let equilibrium:f32=gasT+max(ignite,0.)/max(transfer,.001);
 Ts+=(equilibrium-Ts)*woodFraction(transfer*duration/Cs);
 let g:f32=conductivity/max(h*.5,.00005);let reciprocal:f32=1./Cs+1./Cc;
 let exchanged:f32=(Ts-Tc)*woodFraction(g*reciprocal*duration)/reciprocal;
 Ts-=exchanged/Cs;Tc+=exchanged/Cc;
 Ts=max(293.15,Ts+conduction*duration*500.);Tc=max(293.15,Tc+conduction*duration*500.);
 let meanT:f32=Ts*f+Tc*(1.-f);
 let waterRate:f32=14800.*exp(-41300./(8.314462618*max(meanT,1.)));
 let requestedWater:f32=w.x*woodFraction(waterRate*duration);
 let requestedEvaporation:f32=min(requestedWater,max(meanT-293.15,0.)*cp/2270000.);
 let nextWater:f32=max(0.,w.x-requestedEvaporation);let evaporated:f32=w.x-nextWater;w.x=nextWater;
 let thermalEnergy:f32=max(meanT-293.15,0.)*cp;
 let retainedEnergy:f32=max(0.,1.-evaporated*2270000./max(thermalEnergy,1e-20));
 Ts=293.15+(Ts-293.15)*retainedEnergy;Tc=293.15+(Tc-293.15)*retainedEnergy;
 let surfaceK:vec2f=woodPyro(Ts);let coreK:vec2f=woodPyro(Tc);
 let surfaceLoss:f32=min(s.x*f*woodFraction(surfaceK.x*duration),max(Ts-293.15,0.)*cp*f/600000.);
 let coreLoss:f32=min(s.x*(1.-f)*woodFraction(coreK.x*duration),max(Tc-293.15,0.)*cp*(1.-f)/600000.);
 let nextVirgin:f32=max(0.,s.x-min(s.x,surfaceLoss+coreLoss));
 let consumed:f32=s.x-nextVirgin;
 let represented:f32=consumed/max(surfaceLoss+coreLoss,1e-30);
 let candidateChar:f32=s.w+(surfaceLoss*surfaceK.y+coreLoss*coreK.y)*represented;
 let candidateGain:f32=candidateChar-s.w;
 var madeChar:f32=0.;if(candidateGain>=0.&&candidateGain<=consumed){madeChar=candidateGain;}
 let nextChar:f32=s.w+madeChar;
 let volatileMass:f32=consumed-madeChar;s.x=nextVirgin;s.w=nextChar;
 Ts=max(293.15,Ts-surfaceLoss*represented*600000./(cp*f));
 Tc=max(293.15,Tc-coreLoss*represented*600000./(cp*(1.-f)));
 let oxidationRate:f32=2000.*exp(-85000./(8.314462618*max(Ts,1.)))*clamp(oxygen,0.,1.);
 let nextCarbon:f32=max(0.,s.w*exp(-oxidationRate*duration));
 let oxidized:f32=s.w-nextCarbon;s.w=nextCarbon;
 Ts+=oxidized*28000000.*.025/(cp*f);
 s.y=max(Ts-293.15,0.)/500.;s.z=volatileMass/dt;w.y=max(Tc-293.15,0.)/500.;
 let strain:f32=abs(Ts-Tc)*2.5e-5+(1.-s.x)*.20;
 w.z=max(w.z,clamp((strain-.004)/.08,0.,1.));
 let softening:f32=clamp(1.-max((Ts+Tc)*.5-373.15,0.)/700.,.04,1.);
 w.w=min(w.w,pow(s.x+s.w*.15,2.)*softening);
 return WoodResult(s,w,volatileMass,oxidized,evaporated);
`;
const argumentsWGSL = 'stock:vec4f,wear:vec4f,incomingHeat:f32,dt:f32,ignite:f32,oxygen:f32,capacity:f32,cellSize:f32,material:f32,conduction:f32,timeScale:f32';
export const woodThermoWGSL = `
struct WoodResult{stock:vec4f,wear:vec4f,volatileMass:f32,oxidizedMass:f32,evaporatedMass:f32};
${shaderHelpers}
fn woodThermoStep(${argumentsWGSL})->WoodResult{${stepBody}}
`;

// A small, deliberately closed syntax conversion keeps both shader dialects
// on the same arithmetic. No untyped declarations, pointers, arrays or select
// operations are admitted here; native compilation remains an acceptance gate.
const glType = type => ({f32: 'float', vec2f: 'vec2', vec4f: 'vec4', vec2: 'vec2', vec4: 'vec4'})[type];
function glBody(code) {
  return code.replace(/\b(?:let|var)\s+(\w+)\s*:\s*(f32|vec2f|vec4f)\s*=/g,
    (_, name, type) => `${glType(type)} ${name}=`)
    .replace(/\bvec2f\b/g, 'vec2').replace(/\bvec4f\b/g, 'vec4');
}
const helpersGLSL = glBody(shaderHelpers).replace(
  /fn\s+(\w+)\(([^)]*)\)->(f32|vec2f|vec2)\{/g,
  (_, name, args, type) => `${glType(type)} ${name}(${args.split(',').map(a => {
    const [n, t] = a.split(':'); return `${glType(t)} ${n}`;
  }).join(',')}){`);
const argumentsGLSL = argumentsWGSL.split(',').map(a => {
  const [n, t] = a.split(':'); return `${glType(t)} ${n}`;
}).join(',');
export const woodThermoGLSL = `
struct WoodResult{vec4 stock;vec4 wear;float volatileMass;float oxidizedMass;float evaporatedMass;};
${helpersGLSL}
WoodResult woodThermoResult(${argumentsGLSL}){${glBody(stepBody)}}
void woodThermoStep(${argumentsGLSL},out vec4 nextStock,out vec4 nextWear){
 WoodResult result=woodThermoResult(stock,wear,incomingHeat,dt,ignite,oxygen,capacity,cellSize,material,conduction,timeScale);
 nextStock=result.stock;nextWear=result.wear;
}
void woodThermoStep(${argumentsGLSL.replace(',float timeScale','')},out vec4 nextStock,out vec4 nextWear){
 woodThermoStep(stock,wear,incomingHeat,dt,ignite,oxygen,capacity,cellSize,material,conduction,12.,nextStock,nextWear);
}
`;
