"""Repository-local preview server; authentication query strings are never logged."""
import argparse
import functools
import http.server
import pathlib
import sys
import urllib.parse
parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=8765)
args=parser.parse_args()
class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        parts=pathlib.PurePosixPath(urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)).parts
        if any(part.startswith('.') or part=='node_modules' for part in parts):
            self.send_error(404);return None
        return super().send_head()
    def log_message(self,format,*values):
        sys.stderr.write(f'{self.command} {urllib.parse.urlsplit(self.path).path}\n')
root=pathlib.Path(__file__).resolve().parent.parent
server=http.server.ThreadingHTTPServer(('127.0.0.1',args.port),functools.partial(Handler,directory=str(root)))
print(f'Local: http://127.0.0.1:{args.port}/',flush=True)
server.serve_forever()
