// Shared preflight for the volume runtime; no silent renderer substitution.
const recovery='Hard reload this tab. If it persists, reopen the in-app browser or restart the browser app. Original remains available in the Simulation menu.';
export async function gpuSessionTimeout(promise, stage, milliseconds=60000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error(`WebGPU ${stage} did not finish within ${milliseconds/1000} seconds. ${recovery}`)),milliseconds);
 })]);}
 finally{clearTimeout(timer);}
}
export async function probeGPU(canvas){
 if(!navigator.gpu)throw Error('WebGPU is unavailable in this browser. '+recovery);
 let adapter;try{adapter=await gpuSessionTimeout(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),'adapter request');}catch(e){throw Error(e.message.includes('did not finish')?e.message:'The browser could not request a WebGPU adapter. '+recovery);}
 if(!adapter)throw Error('The browser exposes WebGPU but has no available adapter in this session. '+recovery);
 let context,format;
 try{context=canvas.getContext('webgpu');format=navigator.gpu.getPreferredCanvasFormat();}catch(e){throw Error('The WebGPU canvas provider is unavailable in this session. '+recovery);}
 if(!context)throw Error('The WebGPU canvas provider is unavailable in this session. '+recovery);
 return {adapter,context,format};
}
