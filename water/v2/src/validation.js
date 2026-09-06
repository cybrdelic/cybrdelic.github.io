/** Executable GPU checks, invoked before recording. These are numerical
 * implementation checks, not experimental validation of a complete ocean. */
export function validateGPU(engine){
 const reports={};const old=engine.sceneKey;
 engine.setPreset('storm');reports.spectral=engine.ocean.verify(13.27);
 engine.patch.reset();engine.patch.impulse(0,0,.4,1,0,[100,0]);engine.patch.step(1/60);reports.zeroAlphaImpulse=engine.patch.diagnostics();
 if(reports.zeroAlphaImpulse.maxHeight<.1)throw new Error('Numerical impulses were suppressed by visual alpha blending');
 const data=new Float32Array(engine.patch.n*engine.patch.n*4);engine.renderer.readRenderTargetPixels(engine.patch.a,0,0,engine.patch.n,engine.patch.n,data);let px=0;for(let i=0;i<data.length;i+=4)px+=data[i+1]*engine.patch.dx**2*1025*engine.patch.depth;reports.returnedHorizontalMomentum=px;if(!(px>80&&px<120))throw new Error('Horizontal impulse normalization failed: '+px);
 const doc={format:'cybr-water-replay',version:1,seed:91317,scene:'glass',step:1/60,events:[{tick:10,type:'impulse',payload:{x:0,z:-5,height:.4,radius:1,foam:.2}},{tick:35,type:'impulse',payload:{x:2,z:-6,height:.3,radius:.8,foam:.1}}]};
 const checksum=()=>{const d=new Float32Array(engine.patch.n*engine.patch.n*4);engine.renderer.readRenderTargetPixels(engine.patch.a,0,0,engine.patch.n,engine.patch.n,d);let h=2166136261;for(const b of new Uint32Array(d.buffer))h=Math.imul(h^b,16777619);return (h>>>0).toString(16);};
 const hashes=[];for(let trial=0;trial<2;trial++){engine.loadReplay(doc);for(let i=0;i<90;i++)engine.fixedStep();hashes.push(checksum());}reports.replay={ticks:90,stateHashes:hashes,equal:hashes[0]===hashes[1],scope:'same browser/backend and settings'};if(!reports.replay.equal)throw new Error('Fixed-tick replay mismatch');engine.setPreset(old);return reports;
}
