from pathlib import Path
import numpy as np,json,struct,hashlib
root=Path(__file__).resolve().parent
base=root/'assets/inmoov-v2'
out=base/'derived'
out.mkdir(exist_ok=True)
manifest=[]
for name in ['TopskullV5','TopskullFrontV1','TopBackskullV4','LowBackV5','i2_FingersX5V2','i2_FingersTipX5V2','i2_CoverFingerV3','i2_LeftCoverFingerV3','i2_LeftCoverThumbV3','Eye-R-AllPartsV2','Eye-L-AllPartsV2','Eye-R-BaseV5','Eye-L-BaseV5']:
 p=next(base.rglob(name+'.stl'));data=p.read_bytes();tri=np.frombuffer(data,dtype=np.dtype([('normal','<f4',(3,)),('v','<f4',(3,3)),('attr','<u2')]),offset=84)
 vertices,indices=np.unique(tri['v'].reshape(-1,3).round(4),axis=0,return_inverse=True)
 parent=list(range(len(vertices)))
 def find(a):
  while parent[a]!=a: parent[a]=parent[parent[a]];a=parent[a]
  return a
 def union(a,b):
  a=find(a);b=find(b)
  if a!=b:parent[b]=a
 for a,b,c in indices.reshape(-1,3):union(a,b);union(a,c)
 roots=np.array([find(a) for a in indices.reshape(-1,3)[:,0]])
 comps=[tri[roots==key] for key in np.unique(roots)]
 comps=[c for c in comps if len(c)>50]
 comps.sort(key=lambda c:tuple(c['v'].reshape(-1,3).min(0)))
 for i,c in enumerate(comps):
  v=c['v'].reshape(-1,3);lo=v.min(0);hi=v.max(0);file=out/(name+'-'+str(i)+'.stl')
  file.write_bytes(b'InMoov source connected component'.ljust(80,b' ')+struct.pack('<I',len(c))+c.tobytes())
  record=dict(name=file.stem,url=file.relative_to(root).as_posix(),source=p.relative_to(root).as_posix(),min=lo.tolist(),max=hi.tolist(),size=(hi-lo).tolist(),triangles=len(c))
  manifest.append(record);print(file.stem,len(c),np.round(hi-lo,1),np.round((hi+lo)/2,1),flush=True)
(root/'v2-components.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
