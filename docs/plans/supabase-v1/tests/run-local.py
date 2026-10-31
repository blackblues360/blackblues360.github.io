"""Isolated local Supabase validation. No remote commands or credentials in output.

Run in Linux/WSL with Docker, Python 3 and a portable Supabase CLI.
The supplied project directory must be dedicated to these synthetic tests.
"""
import argparse
import pathlib
import re
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--cli', required=True)
parser.add_argument('--project', required=True)
parser.add_argument('--db-only', action='store_true', help='Start only the Supabase PostgreSQL container when other images are unavailable.')
args = parser.parse_args()
project = pathlib.Path(args.project).resolve()
source = pathlib.Path(__file__).resolve().parent.parent
if str(project).startswith('/mnt/') or project == pathlib.Path.home():
    sys.exit('Use a dedicated Linux temporary directory, not the website or home directory.')
project.mkdir(parents=True, exist_ok=True)
config = project / 'supabase/config.toml'
if not config.exists():
    subprocess.run([args.cli, 'init', '--yes'], cwd=project, check=True, capture_output=True)
text = config.read_text()
if 'project_id = "project"' not in text and 'project_id = "blackblues-stage-a"' not in text:
    sys.exit('Refusing to use an unrelated Supabase project.')
text = text.replace('project_id = "project"', 'project_id = "blackblues-stage-a"')
for old, new in [('54321','57321'),('54322','57322'),('54320','57320'),('54323','57323'),('54324','57324'),('54327','57327'),('54329','57329')]:
    text = text.replace(old, new)
for section in ['realtime','storage','studio','inbucket','analytics','edge_runtime']:
    pattern = rf'(?ms)(^\[{section}\]\s*\n)(.*?)(?=^\[|\Z)'
    text = re.sub(pattern, lambda match: match[1] + re.sub(r'^enabled\s*=\s*true\s*$', 'enabled = false', match[2], flags=re.M), text)
for section in ['api','auth']:
    pattern = rf'(?ms)(^\[{section}\]\s*\n)(.*?)(?=^\[|\Z)'
    enabled = 'false' if args.db_only else 'true'
    text = re.sub(pattern, lambda match: match[1] + re.sub(r'^enabled\s*=\s*(?:true|false)\s*$', f'enabled = {enabled}', match[2], flags=re.M), text)
config.write_text(text)
for folder in ['migrations', 'tests']:
    (project / 'supabase' / folder).mkdir(exist_ok=True)
for index, file in enumerate(sorted((source / 'sql').glob('*.sql')), 1):
    shutil.copyfile(file, project / 'supabase/migrations' / f'20261030000{index}00_{file.name}')
shutil.copyfile(source / 'tests/permissions.test.sql', project / 'supabase/tests/permissions.test.sql')

# Exclude UI, storage, realtime and telemetry. Keep Auth, REST and the gateway.
excluded = 'studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit'
if args.db_only:
    excluded += ',gotrue,kong,postgrest'
print('Starting isolated local Supabase services (status credentials suppressed)...', flush=True)
try:
    result = subprocess.run([args.cli, 'start', '-x', excluded, '--output', 'json'], cwd=project, capture_output=True, text=True, timeout=600)
except subprocess.TimeoutExpired:
    sys.exit('Local Supabase startup exceeded 600 seconds; no success claimed.')
if result.returncode:
    # Normal error output only; never print stdout status credentials or enable --debug.
    print('\n'.join(result.stderr.splitlines()[-25:]))
    sys.exit(result.returncode)
print(f'Local Supabase {"database only" if args.db_only else "API/Auth/database"} started; ordered migrations applied by CLI.', flush=True)
container = 'supabase_db_blackblues-stage-a'
subprocess.run(['docker','exec',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','create extension if not exists pgtap with schema extensions;'], check=True)
result = subprocess.run([args.cli, 'test', 'db'], cwd=project, capture_output=True, text=True)
print(result.stdout)
print(result.stderr)
if result.returncode:
    sys.exit(result.returncode)
print('pgTAP passed. Services are still running for explicit concurrency/HTTP validation.', flush=True)
