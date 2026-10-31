"""Pinned read-only TLS diagnostic; stdin carries credentials, never logs them."""
import ipaddress
import json
import pathlib
import sys
import psycopg

settings=json.load(sys.stdin)
address=str(ipaddress.ip_address(settings['address']))
try:
    certificate=pathlib.Path(__file__).resolve().parent.parent/'.local'/'certs'/'prod-ca-2021.crt'
    with psycopg.connect(host='aws-0-ap-southeast-1.pooler.supabase.com',hostaddr=address,port=5432,user='postgres.orjmbavlxuuccxdphepi',dbname='postgres',password=settings['password'],sslmode='verify-full',sslrootcert=str(certificate),connect_timeout=10) as connection:
        connection.execute('set transaction read only')
        version=connection.execute('show server_version').fetchone()[0]
        print(json.dumps({'connected':True,'tls_mode':'verify-full','server_version':version}))
except psycopg.Error as error:
    print(json.dumps({'connected':False,'error':str(error).splitlines()[0][:240]}));sys.exit(1)
