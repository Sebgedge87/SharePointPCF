# Compares the generated customizations.xml / solution.xml with real exported ones (CoE Starter Kit), structure only.
# Usage: python3 tests/compare_xml.py <customizations.xml> <solution.xml> <folder of exported Entity.xml files saved as ent_*.xml,
#        Other/Relationships/*.xml saved as o_Other_Relationships_*.xml and Other/Solution.xml, Other/Customizations.xml
#        saved as o_Other_Solution.xml, o_Other_Customizations.xml>. Prints what our files lack or add per element.
import sys, glob, collections, xml.etree.ElementTree as ET
ours = ET.parse(sys.argv[1]).getroot(); oursol = ET.parse(sys.argv[2]).getroot(); refdir = sys.argv[3]
refs = [ET.parse(f).getroot() for f in glob.glob(refdir + '/ent_*.xml')]
kids = lambda e: [c.tag for c in e]
def report(title, mine, theirs_list):
    if not theirs_list: print(f'  {title}: no reference'); return
    sets = [set(kids(t)) for t in theirs_list]; always = set.intersection(*sets); ever = set.union(*sets)
    m = set(kids(mine)); miss = sorted(always - m); extra = sorted(m - ever)
    if miss or extra: print(f'  {title}:  MISSING {miss}  UNKNOWN {extra}')
    else: print(f'  {title}: ok')
    # order check against the first reference that has all of mine
    for t in theirs_list:
        order = [k for k in kids(t) if k in m]
        if set(order) >= m - set(extra):
            mo = [k for k in kids(mine) if k in set(order)]
            ded = list(dict.fromkeys(order))
            if [k for k in ded if k in mo] != list(dict.fromkeys(mo)): print(f'    order differs: ours {list(dict.fromkeys(mo))}\n                 ref  {ded}')
            break
print('ENTITY')
for ent in ours.find('Entities'):
    e = ent.find('EntityInfo/entity')
    if e is None or e.get('unmodified'): continue
    report('Entity', ent, refs); report('entity', e, [r.find('EntityInfo/entity') for r in refs])
    for lab in ('LocalizedNames', 'LocalizedCollectionNames', 'Descriptions'):
        report(lab, e.find(lab), [r.find('EntityInfo/entity/' + lab) for r in refs if r.find('EntityInfo/entity/' + lab) is not None])
    break
print('ATTRIBUTES')
refattrs = collections.defaultdict(list)
for r in refs:
    for a in r.iter('attribute'):
        if a.find('Type') is not None: refattrs[a.findtext('Type')].append(a)
seen = set()
for ent in ours.find('Entities'):
    for a in ent.iter('attribute'):
        t = a.findtext('Type'); key = t + ('/primaryname' if a.findtext('DisplayMask', '').find('PrimaryName') >= 0 else '')
        if key in seen: continue
        seen.add(key)
        cands = [x for x in refattrs.get(t, []) if (('PrimaryName' in x.findtext('DisplayMask', '')) == ('PrimaryName' in a.findtext('DisplayMask', '')))] or refattrs.get(t, [])
        print(f' [{key}] {a.findtext("LogicalName")}  refs={len(cands)}')
        report('attribute', a, cands)
        for sub in ('displaynames', 'Descriptions', 'optionset', 'optionset/options', 'optionset/options/option', 'optionset/options/option/labels', 'optionset/displaynames', 'optionset/Descriptions'):
            mine = a.find(sub)
            if mine is None: continue
            report(sub, mine, [x.find(sub) for x in cands if x.find(sub) is not None])
print('RELATIONSHIPS')
rrefs = [ET.parse(f).getroot() for f in glob.glob(refdir + '/o_Other_Relationships_*.xml')]
rr = [x for r in rrefs for x in r.iter('EntityRelationship')]
for kind in ('OneToMany', 'ManyToMany'):
    mine = [x for x in ours.iter('EntityRelationship') if x.findtext('EntityRelationshipType') == kind]
    theirs = [x for x in rr if x.findtext('EntityRelationshipType') == kind]
    if mine:
        print(f' [{kind}] refs={len(theirs)}'); report('EntityRelationship', mine[0], theirs)
        report('EntityRelationshipRoles', mine[0].find('EntityRelationshipRoles'), [t.find('EntityRelationshipRoles') for t in theirs if t.find('EntityRelationshipRoles') is not None])
        rm = mine[0].find('EntityRelationshipRoles/EntityRelationshipRole'); rt = [t for x in theirs for t in x.iter('EntityRelationshipRole')]
        if rm is not None: report('EntityRelationshipRole', rm, rt)
print('SOLUTION')
rs = ET.parse(refdir + '/o_Other_Solution.xml').getroot()
report('ImportExportXml', oursol, [rs]); report('SolutionManifest', oursol.find('SolutionManifest'), [rs.find('SolutionManifest')])
report('Publisher', oursol.find('SolutionManifest/Publisher'), [rs.find('SolutionManifest/Publisher')])
print('CUSTOMIZATIONS ROOT')
rc = ET.parse(refdir + '/o_Other_Customizations.xml').getroot(); report('ImportExportXml', ours, [rc])
