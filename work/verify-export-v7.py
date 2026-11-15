import pathlib,zipfile,hashlib,json,runpy,sys
base=pathlib.Path(__file__).resolve().parent.parent
for name in ['zip-test-0.7.0.zip','sample-export-0.7.0.zip']:
    with zipfile.ZipFile(base/'outputs'/name) as z:
        assert z.testzip() is None
        if name.startswith('zip-test'):
            assert z.read('đề/😀.txt')=='Xin chào\r\n'.encode('utf-8')
            assert len(z.read('large.bin'))==5000000
        else:
            manifest=json.loads(z.read('manifest.json'))
            for f in manifest['files']:
                b=z.read(f['path']);assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
            assert manifest['synthetic'] and manifest['integrity']['ok']
            assert manifest['schemaVersion']==2
            assert 'durationMs' not in manifest['session']
            summary=json.loads(z.read('summary.json'))
            assert manifest['session']['elapsedMs']==summary['elapsedMs']==summary['overall']['totalMs']
            assert manifest['session']['limitMs']==summary['limitMs']
            assert manifest['session']['endReason']=='manual'
            assert sum(p['totalMs'] for p in summary['problems'].values())+summary['unassigned']['totalMs']==summary['elapsedMs']
            for p in [summary['overall'],summary['unassigned'],*summary['problems'].values()]:
                assert sum(p['timeMs'].values())==p['totalMs']
                assert all(isinstance(ms,int) for ms in p['timeMs'].values())
            assert 'SCHEMA.md' in z.namelist()
            assert all(i.file_size>0 for i in z.infolist())
            for p in manifest['problems']:
                statement=json.loads(z.read(f"problems/{p['key']}/statement.json"))
                if statement['source']: assert statement['source'] in z.namelist()
                assert f"problems/{p['key']}/worklog.md" in z.namelist()
            runs=[json.loads(z.read(n)) for n in z.namelist() if '/runs/run-' in n and n.endswith('/meta.json')]
            assert runs and all('compile' in r for r in runs)
            assert runs[0]['refs']['stderr']['state']=='empty' and runs[0]['refs']['stderr']['path'] is None
root=base/'outputs/sample-export-0.7.0'
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}=={f['path'] for f in manifest['files']}|{'manifest.json'},'Stale/unindexed files in generated sample'
module=runpy.run_path(str(root/'tools/replay.py'))
assert not module['verify'](),module['verify']()
assert module['utf8'](module['replay']('A/A.cpp'))==(root/'problems/A/solution.cpp').read_bytes()
assert module['snapshots']('A/A.cpp')
import time
dest=base/'work'/('replay-submissions-python-'+str(time.time_ns()))
sources=module['submissions'](dest)
assert len(sources)==1 and (dest/'A-1000.cpp').read_bytes()==(root/sources[0]['source']).read_bytes()
for line in (root/'report.md').read_text(encoding='utf-8').splitlines():
    if not line.startswith('| A · '): continue
    c=[v.strip() for v in line.split('|')[1:-1]]
    def milliseconds(v):
        import re
        h,m,s,ms=map(int,re.fullmatch(r'(\d+):(\d+):(\d+)\.(\d{3})',v).groups())
        return ((h*60+m)*60+s)*1000+ms
    p=json.loads((root/'summary.json').read_text(encoding='utf-8'))['problems']['A']
    assert milliseconds(c[1])==p['totalMs']
    assert sum(milliseconds(c[i]) for i in [5,6,7,8,13,14,15])==p['totalMs']
print('Python independent ZIP + replay PASS')
legacy=max((base/'work').glob('unit-v7-*/legacy-export'),key=lambda p:p.stat().st_mtime)
legacy_manifest=json.loads((legacy/'manifest.json').read_text(encoding='utf-8'))
assert legacy_manifest['legacy'] and legacy_manifest['missingData']
assert legacy_manifest['session']['elapsedMs']==120000 and legacy_manifest['session']['limitMs']==180*60000
legacy_replay=runpy.run_path(str(legacy/'tools/replay.py'))
assert not legacy_replay['verify'](),legacy_replay['verify']()
assert not (legacy/'problems/A/solution.cpp').exists()
assert legacy_replay['snapshots']()==[]
try:
    legacy_replay['replay']('A/A.cpp')
    raise AssertionError('Legacy replay must not invent missing text')
except ValueError as e:
    assert 'No baseline' in str(e)
print('Python legacy archive VERIFY PASS')
