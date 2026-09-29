// Optional local validation: asynchronous GPU timers, never enabled in the demo.
export function legacyProbe(gl){
 const params=new URL(location.href).searchParams,name=params.get('qa');
 if(!name)return {begin(){},end(){},poll(){}};
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const renderer=gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
 const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),pending=[],samples=[];
 let current,finished=false,last,first;
 function poll(paused=false){
  while(pending.length&&gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
   const item=pending.shift();item.sample.gpuMs=gl.getParameter(ext.GPU_DISJOINT_EXT)?null:gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(item.query);
  }
  if(paused&&!pending.length&&samples.length&&!finished){
   finished=true;const timed=samples.filter(s=>s.drawn),gpu=timed.map(s=>s.gpuMs).filter(Number.isFinite).sort((a,b)=>a-b);
   const stat=a=>a.length?{median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],mean:a.reduce((x,y)=>x+y,0)/a.length}:null;
   fetch('/capture/'+name+'.json',{method:'POST',body:JSON.stringify({renderer,samples,frames:timed.length,gpuMs:stat(gpu),wallSeconds:(last-first)/1000,simulationTime:timed.at(-1)?.time,glError:gl.getError()})}).catch(console.error);
  }
 }
 return {
  begin(){if(finished)return;current=ext?gl.createQuery():null;if(current)gl.beginQuery(ext.TIME_ELAPSED_EXT,current);},
  end(sample){if(finished)return;const now=performance.now();first??=now;last=now;samples.push(sample);if(current){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query:current,sample});current=null;}},
  poll
 };
}
