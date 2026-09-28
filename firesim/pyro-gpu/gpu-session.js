// Shared preflight for the volume runtime; no silent renderer substitution.
const recovery='Hard reload this tab. If it persists, reopen the in-app browser or restart the browser app. Original remains available in the Simulation menu.';
export async function probeGPU(canvas){
 if(!navigator.gpu)throw Error('WebGPU is unavailable in this browser. '+recovery);
 let adapter;try{adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});}catch(e){throw Error('The browser could not request a WebGPU adapter. '+recovery);}
 if(!adapter)throw Error('The browser exposes WebGPU but has no available adapter in this session. '+recovery);
 let context,format;
 try{context=canvas.getContext('webgpu');format=navigator.gpu.getPreferredCanvasFormat();}catch(e){throw Error('The WebGPU canvas provider is unavailable in this session. '+recovery);}
 if(!context)throw Error('The WebGPU canvas provider is unavailable in this session. '+recovery);
 return {adapter,context,format};
}
