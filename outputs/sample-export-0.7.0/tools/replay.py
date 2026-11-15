#!/usr/bin/env python3
"""Dependency-free OLP evidence replay. Offsets use UTF-16 code units, not Python code points."""
import json, pathlib, hashlib, sys, functools
ROOT=pathlib.Path(__file__).resolve().parent.parent
@functools.lru_cache(None)
def rows(name):
    file=ROOT/'timeline'/f'{name}.jsonl'
    return [json.loads(line) for line in file.read_text(encoding='utf-8').splitlines() if line] if file.exists() else []

def blob(value):
    import re
    if not re.fullmatch(r'[a-f0-9]{64}',value): raise ValueError('Invalid snapshot hash')
    return '' if value==hashlib.sha256(b'').hexdigest() else (ROOT/'timeline/blobs'/value).read_bytes().decode('utf-8')
def utf8(text):
    return text.encode('utf-16-le','surrogatepass').decode('utf-16-le','replace').encode('utf-8')
def apply(text, changes):
    data=text.encode('utf-16-le','surrogatepass')
    for c in sorted(changes,key=lambda c:c['offset'],reverse=True):
        a,b=c['offset']*2,(c['offset']+c['removed'])*2
        if data[a:b]!=c['removedText'].encode('utf-16-le','surrogatepass'): raise ValueError('removedText mismatch')
        data=data[:a]+c['text'].encode('utf-16-le','surrogatepass')+data[b:]
    return data.decode('utf-16-le','surrogatepass')
def replay(file,t=float('inf'),seq=float('inf')):
    base=next((s for s in rows('snapshots') if s['file']==file),None)
    if not base or t<base['t']: raise ValueError('No baseline at requested time: '+file)
    text=blob(base['hash'])
    for e in sorted(rows('edits'),key=lambda e:e['seq']):
        if e['file']==file and e['type']=='edit' and base['seq']<e['seq']<seq and e['t']<=t: text=apply(text,e['changes'])
    return text
def verify():
    failures=[]
    snapshots,edits=rows('snapshots'),rows('edits')
    for file in dict.fromkeys(s['file'] for s in snapshots):
        selected=[s for s in snapshots if s['file']==file]
        base=selected[0]
        try:
            text=blob(base['hash'])
            if hashlib.sha256(utf8(text)).hexdigest()!=base['hash']: failures.append(dict(file=file,t=base['t'],error='initial snapshot hash mismatch'))
        except Exception as e: failures.append(dict(file=file,error=str(e))); continue
        stream=selected[1:]+[e for e in edits if e['file']==file and e['seq']>base['seq']]
        for event in sorted(stream,key=lambda e:e['seq']):
            try:
                if event['type']=='edit': text=apply(text,event['changes'])
                elif event['type']=='snapshot' and hashlib.sha256(utf8(text)).hexdigest()!=event['hash']: failures.append(dict(file=file,t=event['t'],error='snapshot hash mismatch'))
            except Exception as e: failures.append(dict(file=file,t=event['t'],error=str(e)))
    for f in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['files']:
        try:
            target=(ROOT/f['path']).resolve()
            if ROOT not in target.parents: raise ValueError('Outside archive')
            data=target.read_bytes()
            if len(data)!=f['bytes'] or hashlib.sha256(data).hexdigest()!=f['sha256']: failures.append(dict(file=f['path'],error='manifest hash/size mismatch'))
        except Exception as e: failures.append(dict(file=f['path'],error=str(e)))
    return failures

def snapshots(file=None):
    return [s for s in rows('snapshots') if file is None or s['file']==file]

def submissions(out_dir=None):
    import re
    result=[]
    for f in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['files']:
        match=re.fullmatch(r'problems/([A-Z])/submissions/(\d+)/(source\.[^/]+)',f['path'])
        if not match: continue
        problem,id,name=match.groups()
        metadata=json.loads((ROOT/'problems'/problem/'submissions'/id/'meta.json').read_text(encoding='utf-8'))
        result.append(dict(problem=problem,id=id,source=f['path'],metadata=metadata))
        if out_dir:
            folder=pathlib.Path(out_dir);folder.mkdir(parents=True,exist_ok=True)
            (folder/(problem+'-'+id+pathlib.Path(name).suffix)).write_bytes((ROOT/f['path']).read_bytes())
            (folder/(problem+'-'+id+'.json')).write_text(json.dumps(metadata,ensure_ascii=True,indent=2),encoding='utf-8')
    return result
if __name__=='__main__':
    try:
        action=sys.argv[1]
        if action=='verify':
            failures=verify()
            if failures: print(json.dumps(failures,ensure_ascii=True,indent=2)); sys.exit(1)
            print('replay.py VERIFY PASS')
        elif action=='timeline': sys.stdout.buffer.write((ROOT/'timeline/timeline.md').read_bytes())
        elif action=='snapshots': print(json.dumps(snapshots(sys.argv[2] if len(sys.argv)>2 else None),ensure_ascii=True,indent=2))
        elif action=='submissions': print(json.dumps(submissions(sys.argv[2] if len(sys.argv)>2 else 'reconstructed-submissions'),ensure_ascii=True,indent=2))
        elif action=='file':
            data=utf8(replay(sys.argv[2],float(sys.argv[3]) if len(sys.argv)>3 else float('inf')))
            if len(sys.argv)>4: pathlib.Path(sys.argv[4]).write_bytes(data)
            else: sys.stdout.buffer.write(data)
        else: raise ValueError('Usage: replay.py verify | timeline | snapshots [file] | submissions [folder] | file A/A.cpp [milliseconds] [output]')
    except Exception as e: print(str(e),file=sys.stderr); sys.exit(1)
