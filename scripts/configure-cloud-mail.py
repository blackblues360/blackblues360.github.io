"""Public sender/rate settings only. SMTP secrets remain in the official integration."""
import json
import pathlib
import urllib.request

token=(pathlib.Path.home()/'.supabase'/'access-token').read_text().strip();assert token.startswith('sbp_')
endpoint='https://api.supabase.com/v1/projects/orjmbavlxuuccxdphepi/config/auth'
headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
with urllib.request.urlopen(urllib.request.Request(endpoint,headers=headers),timeout=30) as response:current=json.load(response)
assert current.get('smtp_host')=='smtp.resend.com','Connect the approved Resend integration first'
settings={'smtp_admin_email':'noreply@auth.blackblues.xyz','smtp_sender_name':'blackblues','rate_limit_email_sent':10}
with urllib.request.urlopen(urllib.request.Request(endpoint,data=json.dumps(settings).encode(),headers=headers,method='PATCH'),timeout=30) as response:actual=json.load(response)
assert all(actual.get(key)==value for key,value in settings.items())
print('Verified sender noreply@auth.blackblues.xyz; project email cap 10/hour; SMTP secrets not read or changed.')
