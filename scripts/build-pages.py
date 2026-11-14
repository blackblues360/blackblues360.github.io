"""Build an allowlisted public artifact; never copy drafts, SQL, tests or backups."""
import argparse,pathlib,subprocess,re,json
from html.parser import HTMLParser

class ToolPage(HTMLParser):
    def __init__(self):super().__init__();self.protected=False;self.entries=[];self.styles=[];self.gate=False;self.other_scripts=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='html':self.protected='data-tool-page' in attrs
        if attrs.get('id')=='toolAccessGate':self.gate=True
        if tag=='link':self.styles.append(attrs.get('href',''))
        if tag=='script':
            if attrs.get('src')=='../../assets/js/account/tool-access.mjs' and attrs.get('type')=='module' and attrs.get('data-tool-entry'):self.entries.append(attrs['data-tool-entry'])
            elif attrs.get('src')!='../../script.js':self.other_scripts.append(attrs.get('src','inline'))
parser=argparse.ArgumentParser();parser.add_argument('--index',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'.local/pages';out.mkdir(parents=True,exist_ok=True)
assert not any(out.iterdir()),'Use a fresh output directory; do not mix old artifacts'
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
count=0;tool_pages=0
assert 'tools/qpcr-analyzer/published/index.html' in files, 'Build and commit qPCR Pages files with npm run build:pages'
for name in files:
    if not name:continue
    path=pathlib.PurePosixPath(name)
    if path.parts[:2] == ('tools', 'qpcr-analyzer'):
        if path.parts[2:3] != ('published',):continue
        path=pathlib.PurePosixPath(*path.parts[:2],*path.parts[3:])
    public_directory=path.parts[0] in ['assets','account','tools','config'] or path.parts[:2]==('games','minesweeper')
    if name not in ['index.html','script.js','CNAME','favicon.svg'] and not (public_directory and 'tests' not in path.parts and path.suffix.lower() in ['.html','.css','.js','.mjs','.json','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.txt']):continue
    data=subprocess.check_output(['git','show',':'+name],cwd=root) if args.index else (root/name).read_bytes()
    if path.parts[0]=='tools' and path.suffix=='.html':
        page=ToolPage();page.feed(data.decode('utf8'))
        assert page.protected and page.gate and len(page.entries)==1 and '../../assets/css/tool-access.css' in page.styles and not page.other_scripts,'Tool must use the shared login gate: '+name
        tool_pages+=1
    if path.suffix in ['.html','.css','.js','.mjs','.json','.txt']:
        text=data.decode('utf8')
        assert not re.search(r'\b(?:sb_secret_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{24,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,})',text),'Potential secret in '+name
    target=out/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);count+=1
if tool_pages:
    assert (out/'assets/css/tool-access.css').is_file() and (out/'assets/js/account/tool-access.mjs').is_file(),'Missing shared tool login assets'
config=(out/'assets/js/account/config.mjs').read_text()
assert 'https://orjmbavlxuuccxdphepi.supabase.co' in config and 'sb_publishable_' in config and 'localhost' not in config and '127.0.0.1' not in config
assert (out/'CNAME').read_text().strip()=='blackblues.xyz'
(out/'.nojekyll').touch()
print(json.dumps({'public_files':count+1,'output':str(out),'production_config_verified':True}))
