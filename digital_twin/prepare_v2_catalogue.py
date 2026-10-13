from pathlib import Path
import json, urllib.request, re, concurrent.futures, hashlib, struct
root=Path(__file__).resolve().parent
base=root/'assets/inmoov-v2'
def download(category):
 url='https://www.inmoov.fr/inmoov-stl-parts-viewer/?bodyparts='+category
 html=urllib.request.urlopen(url,timeout=40).read().decode('utf-8')
 names=sorted(set(re.findall(r'value="([^"]+\.stl)"',html)))
 folder=base/category
 folder.mkdir(exist_ok=True)
 def one(name):
  if any(x in name for x in ['Mold','mold']): return
  target=folder/name
  if not target.exists():
   data=urllib.request.urlopen('https://www.inmoov.fr/wp-content/uploads/stl/'+category+'/'+name,timeout=45).read()
   if len(data)<84:raise ValueError(name)
   target.write_bytes(data)
  return name
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for name in pool.map(one,names):
   if name: print(category,name,flush=True)
for category in ([] if '--catalogue-only' in __import__('sys').argv else ['i2Head','i2Eyes']):
 try: download(category)
 except Exception as e: print('Download issue:',str(e),flush=True)
parts=[]
seen=set()
for p in sorted(base.rglob('*.stl')):
 if 'derived' in p.parts:continue
 if p.name in seen:continue
 seen.add(p.name)
 data=p.read_bytes()
 count=struct.unpack_from('<I',data,80)[0]
 if len(data)!=84+50*count:continue
 import numpy as np
 v=np.frombuffer(data,dtype=np.dtype([('n','<f4',(3,)),('v','<f4',(3,3)),('a','<u2')]),offset=84)['v'].reshape(-1,3)
 group='Neck' if 'Neck' in p.parts else 'Head' if 'Hand' not in str(p) and 'i2Eyes' not in str(p) else 'Eyes' if 'i2Eyes' in str(p) else 'Left hand' if 'Left' in str(p) else 'Right hand'
 parts.append(dict(name=p.stem,group=group,url=p.relative_to(root).as_posix(),dimensions=[round(float(x),2) for x in v.max(0)-v.min(0)],triangles=count,sha256=hashlib.sha256(data).hexdigest()))
(root/'v2-parts.json').write_text(json.dumps(parts,indent=2),encoding='utf-8')
print('Catalogue:',len(parts),'official parts')
