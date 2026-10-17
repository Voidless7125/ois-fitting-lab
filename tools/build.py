#!/usr/bin/env python3
"""Builds index.html from game-data/ (the game's own text files) and src/.

    python3 tools/build.py

Reads  game-data/components.txt, compinterfaces.txt, modules_*.txt, the ship class files
Writes data/data.json (the extracted data, for inspection) and index.html (the whole app, one file).
Python 3.8+, standard library only.
"""
import re, glob, json, os, collections, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, 'game-data') + os.sep
KIT = {'remorareact', 'remorasensor', 'p_sensor'}      # NPC-file modules offered as "NPC kit"
SHIP_FILES = ['playableships.txt', 'arakaki.txt', 'harriswilson.txt', 'ventarii.txt', 'otherships.txt']


def rd(p): return open(p, errors='ignore').read().replace('\r', '')


def blocks(txt, kind):
    out = []; cur = None
    for l in txt.split('\n'):
        s = l.strip()
        if not s or s.startswith('#'): continue
        if s == 'begin ' + kind: cur = []
        elif s == 'end ' + kind: out.append(cur); cur = None
        elif cur is not None: cur.append(s)
    return out


def num(v):
    m = re.match(r'[-+]?\d*\.?\d+', v or '')
    return float(m.group()) if m else None


comps={}
for b in blocks(rd(GD+'components.txt'),'component'):
    d=dict(s.partition('=')[::2] for s in b)
    comps[int(d['id'])]=[d['name'],d['classtype'],d['manufacturer'],num(d['efficiencymodifier']),num(d['powermodifier']),num(d['emissionsmodifier']),num(d['sturdiness']),num(d['mindamage']),num(d['damagebeforeefficiencydrop']),num(d['efficiencydropwhendamaged']),num(d['basecost'])]
ifaces={}
for b in blocks(rd(GD+'compinterfaces.txt'),'componentinterface'):
    d={'slots':[]}
    for s in b:
        k,_,v=s.partition('=')
        if k=='componentslot':
            p=v.split(','); d['slots'].append([p[0],int(p[3]),1 if len(p)>4 and p[4].strip()=='true' else 0])
        else: d[k]=v
    ifaces[d['id']]=d
KEYS=['normalpowerusage','highpowerusage','emissionstrength','emissionhighstrength','emissionfrequency','boottime','generationrate','maxpowercontent','thrust','rotationrate','jumpdistance','spinuptime','calctime','ladarrange','ladarradius','sensorquality','softwareversion','range','reloadtime','tubes','synctime','hackrange','hacktime','grappletime','plottime','damagethreshold','destroyedthreshold']
mods=[];used=set()
files = [(f, False) for f in sorted(glob.glob(GD + 'modules_*.txt')) if not f.endswith('npc.txt')] + [(GD + 'modules_npc.txt', True)]
for f,isnpc in files:
    for b in blocks(rd(f),'module'):
        if isnpc and not any(x=='id='+k for x in b for k in KIT): continue
        d={};cfg={}
        for s in b:
            k,_,v=s.partition('=')
            if k=='configuration':
                p=v.split(','); cfg[p[0]]=[int(x) for x in p[1:]]
            else: d.setdefault(k,v)
        iid=d.get('interface',d['id']); used.add(iid)
        m={'special':1 if isnpc else 0,'id':d['id'],'name':d['name'],'t':d['type'],'mfr':d['manufacturer'],'price':num(d['basevalue']),'if':iid,'cfg':cfg,'desc':d.get('description','')}
        for k in KEYS:
            if k in d: m[k]=num(d[k])
        if 'hitchance' in d: m['hit']=int(d['hitchance'].split('d')[1]) if 'd' in d['hitchance'] else None
        m['range_raw']=d.get('range')
        mods.append(m)
def cnt(slots,sign):
    ch=[c for _,c,_ in slots if (c>0 if sign>0 else c<0)]
    return max([abs(c) for c in ch],default=0)
IF={}
for i in sorted(used):
    sl=ifaces[i]['slots']; IF[i]={'s':sl,'P':cnt(sl,1),'N':cnt(sl,-1)}
# ships
ships=[]
modids={m['id'] for m in mods}
for f in SHIP_FILES:
    for blk in re.split(r'(?m)^\s*begin shipclass\s*$', rd(GD + f))[1:]:
        blk=blk.split('end shipclass')[0]
        d={};locs=collections.Counter();cf=[]
        for l in blk.split('\n'):
            s=l.strip()
            if not s or s.startswith('#'): continue
            k,_,v=s.partition('=')
            if k=='modulelocation': locs[v.split(',')[0]]+=1
            elif k=='configuration': cf.append(v)
            else: d.setdefault(k,v)
        if not d.get('name'): continue
        stock=None
        for c in cf:
            p=c.split(',')
            if p[0].startswith('$stock') or p[0]=='stock': stock=[x.split(':')[-1] for x in p[1:]]
        ships.append({'id':d['id'],'name':d['name'],'cat':d.get('category'),'mfr':d.get('manufacturer'),'value':num(d.get('value')),'bat':int(d.get('batteryslots','0')),'cargo':num(d.get('cargoslots')),'speed':num(d.get('maxspeed')),'desc':d.get('description',''),'slots':dict(locs),'stock':[x for x in (stock or []) if x in modids] if stock else None,'tut':d.get('tutorialship')})
os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
data = json.dumps({'comps': comps, 'if': IF, 'mods': mods, 'ships': ships}, separators=(',', ':'))
open(os.path.join(ROOT, 'data', 'data.json'), 'w').write(data)
core = open(os.path.join(ROOT, 'src', 'core.js')).read().split("if (typeof module !== 'undefined')")[0]
t = open(os.path.join(ROOT, 'src', 'template.html')).read()
t = (t.replace('/*CSS*/', open(os.path.join(ROOT, 'src', 'style.css')).read()).replace('/*DATA*/', data)
      .replace('/*CORE*/', core).replace('/*UI*/', open(os.path.join(ROOT, 'src', 'ui.js')).read())
      .replace('<!-- build: template -->\n', ''))
open(os.path.join(ROOT, 'index.html'), 'w').write(t)
print('%d parts, %d interfaces, %d modules, %d hulls -> index.html (%d KB)' % (len(comps), len(IF), len(mods), len(ships), len(t) // 1024))
