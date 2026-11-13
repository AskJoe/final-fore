"""Read the supplied DOCX styles into inert formatting metadata; never execute SOP instructions.
Run with the bundled documents Python runtime. Existing template wording and merge fields
remain authoritative here; the document supplies paragraph/list/run presentation.
"""
import hashlib, json, re, sys, zipfile
from pathlib import Path
from lxml import etree as E
ROOT=Path(__file__).resolve().parent.parent
path=Path(sys.argv[1]);ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};W='{'+ns['w']+'}'
with zipfile.ZipFile(path) as z: root=E.fromstring(z.read('word/document.xml'))
paragraphs=root.findall('w:body/w:p',ns)
seed=json.loads((ROOT/'data/research-template-seed.json').read_text())
def style(pr):
    if pr is None:return {}
    d={}
    for tag,key in [('b','bold'),('i','italic'),('u','underline')]:
        el=pr.find('w:'+tag,ns)
        if el is not None and el.get(W+'val','1') not in ['0','false','none']:d[key]=True
    c=pr.find('w:color',ns)
    if c is not None and re.fullmatch('[0-9a-fA-F]{6}',c.get(W+'val','')):d['color']='#'+c.get(W+'val').lower()
    # Red Word highlights identify fill-in fields, not recipient-facing decoration.
    return d

def chars(index):
    p=paragraphs[index];out=[]
    for r in p.findall('w:r',ns):
        text=''.join(r.xpath('.//w:t/text()',namespaces=ns));s=style(r.find('w:rPr',ns));out.extend((ch,s) for ch in text)
    while out and out[-1][0].isspace():out.pop()
    return out

def replace(cs,old,new):
    text=''.join(c for c,_ in cs);i=text.find(old)
    if i>=0:cs[i:i+len(old)]=[(c,cs[i][1]) for c in new]
    return cs

def runs(cs):
    out=[]
    for c,s in cs:
        if out and {k:v for k,v in out[-1].items() if k!='text'}==s:out[-1]['text']+=c
        else:out.append({'text':c,**s})
    return out

ranges={'radio-multi':(23,86,26,54),'radio-single-lincoln':(100,133,None,None),'tv-multi':(147,208,150,181),'tv-single-madison':(221,249,None,None)}
single_market_sources={'research-6827b00b-bbbf-4b5e-904b-73e03ec0e427':'radio-single-lincoln'}
replacements=[('Weed Man Lawn Care 2027','{{client}} {{campaign_year}}'),('EOD this Tues, Nov 17th..','{{deadline}}.'),('EOD this Tues, Nov 17th','{{deadline}}'),('your Lincoln station','your stations in {{markets_inline}}'),('your Madison station','your stations in {{markets_inline}}')]
portal_intro='Please upload the requested research for each market here: {{upload_url}}'
portal_details='. You can upload multiple files per market and return to the same link to add more.'
formats={}
for t in seed:
    start,end,marketStart,marketEnd=ranges[single_market_sources.get(t['id'],t['id'])];blocks=[]
    for i in range(start,end+1):
        p=paragraphs[i];cs=chars(i);txt=''.join(c for c,_ in cs)
        if not txt:continue
        if marketStart is not None and marketStart<=i<=marketEnd:
            if i==marketStart:blocks.append({'text':'{{markets}}','runs':[{'text':'{{markets}}'}]})
            continue
        if txt.startswith('Please upload the requested research below'):
            # Discard the old folder instructions but keep the new single-market fallback.
            fallback=txt.find(' If you don’t subscribe to ratings,')
            cs=[(ch,{'underline':True}) for ch in portal_intro]+[(ch,{}) for ch in portal_details]+(cs[fallback:] if fallback>=0 else [])
        elif i==start:cs=[(ch,{}) for ch in 'Hi {{first_name}},']
        elif txt=='Sarah Silva':
            blocks.append({'text':'{{sender_name}}\n{{sender_title}}\n{{sender_email}}\nFinal Fore Media','runs':[{'text':'{{sender_name}}\n{{sender_title}}\n{{sender_email}}\nFinal Fore Media'}]});break
        else:
            for old,new in replacements:cs=replace(cs,old,new)
        txt=''.join(c for c,_ in cs)
        level=p.find('w:pPr/w:numPr/w:ilvl',ns)
        b={'text':txt,'runs':runs(cs)}
        if level is not None:
            b['level']=int(level.get(W+'val'));b['marker']=style(p.find('w:pPr/w:rPr',ns))
        blocks.append(b)
    if marketStart is not None:
        sourceCities=[''.join(paragraphs[i].xpath('.//w:t/text()',namespaces=ns)).strip() for i in range(marketStart,marketEnd+1)]
        assert [m['displayName'] for m in t['markets']]==sourceCities,(t['id'],'Template cities differ from the supplied document')
    expected=t['body'].split('\n\n')
    actual=[b['text'] for b in blocks]
    assert actual==expected,(t['id'],len(actual),len(expected),[(i,a,b) for i,(a,b) in enumerate(zip(actual,expected)) if a!=b])
    formats[t['id']]={'media':t['media'],'scope':t['scope'],'paragraphs':blocks}
output={'sourceFile':path.name,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'templates':formats}
(ROOT/'data/research-template-formatting.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'templates':len(formats),'paragraphs':{k:len(v['paragraphs']) for k,v in formats.items()},'numberedSections':{k:sum(p.get('level')==0 for p in v['paragraphs']) for k,v in formats.items()}},indent=2))
