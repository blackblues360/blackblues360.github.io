"""Build an allowlisted public artifact; never copy drafts, SQL, tests or backups."""
import argparse,pathlib,subprocess,re,json
parser=argparse.ArgumentParser();parser.add_argument('--index',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'.local/pages';out.mkdir(parents=True,exist_ok=True)
assert not any(out.iterdir()),'Use a fresh output directory; do not mix old artifacts'
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
count=0
for name in files:
    if not name:continue
    path=pathlib.PurePosixPath(name)
    if name not in ['index.html','script.js','CNAME','favicon.svg'] and not (path.parts[0] in ['assets','account','tools','config'] and 'tests' not in path.parts and path.suffix.lower() in ['.html','.css','.js','.mjs','.json','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.txt']):continue
    data=subprocess.check_output(['git','show',':'+name],cwd=root) if args.index else (root/name).read_bytes()
    if path.suffix in ['.html','.css','.js','.mjs','.json','.txt']:
        text=data.decode('utf8')
        assert not re.search(r'\b(?:sb_secret_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{24,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,})',text),'Potential secret in '+name
    target=out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);count+=1
config=(out/'assets/js/account/config.mjs').read_text()
assert 'https://orjmbavlxuuccxdphepi.supabase.co' in config and 'sb_publishable_' in config and 'localhost' not in config and '127.0.0.1' not in config
assert (out/'CNAME').read_text().strip()=='blackblues.xyz'
(out/'.nojekyll').touch()
print(json.dumps({'public_files':count+1,'output':str(out),'production_config_verified':True}))
