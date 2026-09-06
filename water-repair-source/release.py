"""Release only verified source and complete original browser captures."""
from pathlib import Path
import argparse,base64,hashlib,json,lzma,shutil,subprocess,zipfile
ROOT=Path('/tmp/water-repair');APP=ROOT/'CYBR-WATER-II';BASE=ROOT/'BASELINE'
def run(args):subprocess.run(args,check=True)
def apply():
    archive=Path('/tmp/water-baseline.zip').read_bytes()
    assert hashlib.sha1(b'blob '+str(len(archive)).encode()+b'\0'+archive).hexdigest()=='69011145ee9510276d12dfe873067cee1f9ba38e','Baseline archive differs from the delivered V2'
    ROOT.mkdir(exist_ok=True)
    with zipfile.ZipFile('/tmp/water-baseline.zip') as z:
        for name in z.namelist():assert (ROOT/name).resolve().is_relative_to(ROOT)
        z.extractall(ROOT)
    shutil.copytree(APP,BASE)
    manifest=json.loads(Path('water-repair-source/manifest.json').read_text())
    data=base64.b64decode(''.join(Path(f'water-repair-source/part{i}.b64').read_text() for i in range(manifest['parts'])),validate=True)
    assert hashlib.sha256(data).hexdigest()==manifest['sha256'],'Source transport checksum mismatch'
    patches=json.loads(lzma.decompress(data));assert len(patches)==manifest['files']
    for name,patch in patches.items():
        p=(APP/name).resolve();assert p.is_relative_to(APP);p.parent.mkdir(exist_ok=True,parents=True)
        if 'content' in patch:text=patch['content']
        else:
            text=p.read_text();assert hashlib.sha256(text.encode()).hexdigest()==patch['base'],('Preimage mismatch',name)
            lines=text.splitlines(keepends=True)
            for start,end,new in reversed(patch['edits']):lines[start:end]=[new]
            text=''.join(lines);assert hashlib.sha256(text.encode()).hexdigest()==patch['target'],('Postimage mismatch',name)
        p.write_text(text)
    # Do not accidentally present historical V2 results as current validation.
    for root in [APP,BASE]:
        shutil.rmtree(root/'docs',ignore_errors=True);(root/'docs').mkdir()
        shutil.rmtree(root/'renders',ignore_errors=True);(root/'renders').mkdir()
        for name in ['standalone.html','browser-bundle.html']:(root/'public'/name).unlink(missing_ok=True)
    # Capture machinery and camera paths are shared; baseline simulation stays unchanged.
    shutil.copyfile(APP/'capture/render.py',BASE/'capture/render.py')
    text=(BASE/'capture/render.py').read_text().replace('CYBR / WATER 2.1','PREVIOUS / WATER V2')
    (BASE/'capture/render.py').write_text(text)
    shots=json.loads((APP/'capture/shots.json').read_text())
    for s in shots:s['caption']='Previous V2 renderer / same camera, seed and simulation time'
    (BASE/'capture/shots.json').write_text(json.dumps(shots,indent=2))
    record={'transportSHA256':manifest['sha256'],'baselineGitBlob':'69011145ee9510276d12dfe873067cee1f9ba38e','verifiedChangedFiles':list(patches),'baselineCommit':manifest['baseSourceCommit']}
    (APP/'docs/source-provenance.json').write_text(json.dumps(record,indent=2))
    print('VERIFIED DELTA',len(patches),'files')
def assemble():
    public=APP/'public';films=public/'films';docs=APP/'docs';docs.mkdir(exist_ok=True)
    for name in ['harbor','storm','rain','glass']:
        p=docs/('endurance-'+name+'.json');d=json.loads(p.read_text());assert d['passed'] and not d['errors'],name
    for name in ['controls-browser.json','standalone-browser.json']:
        d=json.loads((docs/name).read_text());assert d['passed'],name
    run(['python',str(APP/'capture/compose.py')])
    checks=json.loads((docs/'repair-verification.json').read_text());assert checks['passed']
    shots=json.loads((APP/'capture/shots.json').read_text());comparisons=[];comparisonDir=ROOT/'comparisons';comparisonDir.mkdir(exist_ok=True)
    labels={0:'Dawn / highlights and fine-wave stability',6:'Rocky inlet / geometry-faithful optics',8:'Clear water / depth-dependent transmission',9:'Turbid water / absorption and scattering',10:'Underwater / secondary visibility',20:'Looking upward / dielectric interface'}
    font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    for i in [0,6,8,9,10,20]:
        s=shots[i];key=f"{i:02d}-{s['scene']}";old=ROOT/'baseline-renders'/(key+'.mp4');new=APP/'renders'/(key+'.mp4')
        originalReport=json.loads((ROOT/'baseline-renders'/(key+'.json')).read_text());assert not originalReport['errors']
        for p in [old,new]:
            d=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,nb_frames,r_frame_rate','-of','json',str(p)]))['streams'][0]
            assert (d['width'],d['height'],int(d['nb_frames']),d['r_frame_rate'])==(1920,1080,144,'24/1')
        output=comparisonDir/(key+'.mp4')
        graph=f"[0:v]scale=960:540:flags=lanczos[a];[1:v]scale=960:540:flags=lanczos[b];[a][b]hstack=inputs=2,pad=1920:680:0:92:color=0x08151d,drawtext=fontfile={font}:text='PREVIOUS V2':x=32:y=30:fontsize=25:fontcolor=white,drawtext=fontfile={font}:text='REPAIRED 2.1':x=992:y=30:fontsize=25:fontcolor=white,drawtext=fontfile={font}:text='{labels[i]}':x=32:y=642:fontsize=20:fontcolor=white[v]"
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(old),'-i',str(new),'-filter_complex',graph,'-map','[v]','-c:v','libx264','-preset','medium','-crf','18','-threads','3','-an','-pix_fmt','yuv420p',str(output)])
        comparisons.append(output)
    listing=comparisonDir/'list.txt';listing.write_text(''.join(f"file '{p}'\n" for p in comparisons))
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(films/'00-Before-and-After.mp4')])
    (docs/'comparison-validation.json').write_text(json.dumps({'pairs':list(labels),'seconds':36,'resolution':[1920,680],'perPaneResolution':[960,540],'sourceResolution':[1920,1080],'sameSeed':True,'sameCameraAndTime':True,'note':'Each native source is downsampled to half resolution for simultaneous comparison. No frame interpolation.'},indent=2))
    encodings=[]
    for p in films.glob('*.mp4'):
        if p.stat().st_size<94*1024**2:continue
        complete=p.name=='CYBR-WATER-2.1-Complete.mp4';tmp=p.with_name('encoded-'+p.name)
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(p),'-c:v','libx264','-preset','medium','-crf','20','-maxrate','4000k' if complete else '18000k','-bufsize','8000k' if complete else '36000k','-threads','3','-an','-pix_fmt','yuv420p','-movflags','+faststart',str(tmp)])
        tmp.replace(p);encodings.append({'file':p.name,'reason':'Individual GitHub object limit','maximumKbps':4000 if complete else 18000,'resolutionAndFrameCountUnchanged':True})
    (docs/'hosting-encodings.json').write_text(json.dumps(encodings,indent=2))
    gallery=films/'index.html';text=gallery.read_text().replace('<h2>Feature reels</h2>','<h2>Previous V2 versus repair</h2><video controls preload="none" poster="06-lagoon.jpg" src="00-Before-and-After.mp4"></video><p>Six matched camera/time comparisons. Each original 1080p frame is downsampled to 960 × 540 for the side-by-side view. <a download href="00-Before-and-After.mp4">Save comparison</a>.</p><h2>Feature reels</h2>');gallery.write_text(text)
    # Re-probe every final public encoding, not just pre-transcode masters.
    media={}
    for p in films.glob('*.mp4'):
        d=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,nb_frames,r_frame_rate','-show_entries','format=duration','-of','json',str(p)]))
        assert d['streams'][0]['r_frame_rate']=='24/1';assert p.stat().st_size<99*1024**2
        media[p.name]={'probe':d,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    (docs/'final-media.json').write_text(json.dumps(media,indent=2))
    for name in ['README.md','BUGFIXES.md','LIMITATIONS.md','ATTRIBUTION.md','LICENSE']:shutil.copyfile(APP/name,public/name)
    shutil.copytree(docs,public/'docs',dirs_exist_ok=True)
    (public/'VALIDATION.json').write_text(json.dumps({'revision':'2.1-repair','CPU':'59 numerical implementation tests','GPU':checks,'capture':'30 new shots / 4320 native 1080p frames / 24 fps playback / offline rendering','comparison':'6 matched old/new views, separately labeled downsampled panes','endurance':'harbor 120 s, storm 60 s, rain 30 s, glass 60 s; see individual reports','scope':'Spectral ocean + local linear depth-averaged perturbations. Not full volumetric CFD, not a proof of zero remaining defects, not an established real-time performance claim.'},indent=2))
    with zipfile.ZipFile(public/'SOURCE.zip','w',zipfile.ZIP_DEFLATED,compresslevel=7) as z:
        for folder in ['public/src','public/assets','public/vendor','capture','tools','tests','docs']:
            for f in (APP/folder).rglob('*'):
                if f.is_file():z.write(f,'CYBR-WATER-2.1/'+f.relative_to(APP).as_posix())
        for name in ['public/index.html','README.md','BUGFIXES.md','LIMITATIONS.md','ATTRIBUTION.md','LICENSE','package.json']:z.write(APP/name,'CYBR-WATER-2.1/'+name)
    hashes={f.relative_to(public).as_posix():hashlib.sha256(f.read_bytes()).hexdigest() for f in public.rglob('*') if f.is_file()}
    (public/'RELEASE-HASHES.json').write_text(json.dumps(hashes,indent=2))
    size=sum(f.stat().st_size for f in public.rglob('*') if f.is_file());assert size<850*1024**2,('Release too large',size)
    print('RELEASE MIB',size/1024**2)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['apply','assemble']);a=p.parse_args();apply() if a.mode=='apply' else assemble()
