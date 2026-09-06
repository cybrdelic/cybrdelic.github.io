"""Exercise actual UI events, preset reset and replay in the running HTTP app."""
from pathlib import Path
import json,sys,threading,http.server,functools,shutil,os
from playwright.sync_api import sync_playwright
root=Path(sys.argv[1]);out=root/'docs/controls-browser.json';errors=[];warnings=[]
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(root/'public')))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
    exe=next((shutil.which(n) for n in ['chromium','google-chrome','google-chrome-stable'] if shutil.which(n)),None)
    kw=dict(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-dev-shm-usage'])
    if exe:kw['executable_path']=exe
    browser=pw.chromium.launch(**kw);page=browser.new_page(viewport={'width':960,'height':540})
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else (warnings.append(m.text) if m.type=='warning' else None))
    page.goto(f'http://127.0.0.1:{server.server_port}/?capture=1&scene=rain&width=960&height=540',wait_until='domcontentloaded')
    page.wait_for_function('window.__READY__||window.__ERROR__',timeout=240000)
    assert not page.evaluate('window.__ERROR__'),page.evaluate('window.__ERROR__')
    result=page.evaluate('''()=>{app.setPreset('rain');const checkbox=document.querySelector('[data-flag="rain"]');checkbox.checked=false;checkbox.dispatchEvent(new Event('change'));const slider=document.querySelector('#extinction');slider.value='2';slider.dispatchEvent(new Event('input'));app.frame(1/60);const journal=app.exportReplay(),first={rain:app.engine.flags.rain,absorption:app.engine.shared.uAbsorption.value.toArray(),tick:app.engine.tick};app.setPreset('blue');const resetFlags={...app.engine.flags};app.loadReplay(journal);app.frame(1/60);const second={rain:app.engine.flags.rain,absorption:app.engine.shared.uAbsorption.value.toArray(),tick:app.engine.tick};return {journal,first,second,resetFlags,replayedScene:app.engine.sceneKey};}''')
    assert len(result['journal']['events'])==2,result
    assert [e['type'] for e in result['journal']['events']]==['flag','extinction'],result
    assert result['first']==result['second'],result
    assert not result['first']['rain'] and all(result['resetFlags'].values()),result
    assert result['replayedScene']=='rain',result
    assert not errors,errors
    result.update(browserErrors=errors,browserWarnings=warnings,passed=True)
    out.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
    requests=[];page.on('request',lambda r:requests.append(r.url))
    page.goto(f'http://127.0.0.1:{server.server_port}/standalone.html?capture=1&scene=lagoon&width=960&height=540',wait_until='domcontentloaded',timeout=240000)
    page.wait_for_function('window.__READY__||window.__ERROR__',timeout=240000)
    assert not page.evaluate('window.__ERROR__'),page.evaluate('window.__ERROR__')
    page.evaluate('app.frame(1/24)');assert not errors,errors
    assert not [u for u in requests if '/assets/' in u or '/src/' in u or '/vendor/' in u],requests
    (root/'docs/standalone-browser.json').write_text(json.dumps({'passed':True,'requests':requests,'errors':errors,'diagnostics':page.evaluate('app.diagnostics()')},indent=2))
    browser.close()
server.shutdown()
