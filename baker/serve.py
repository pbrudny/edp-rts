"""Static server for the baker + POST /save/<name> writes into ./out (PNG data URLs are decoded)."""
import base64, http.server, os, re, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        m = re.fullmatch(r"/save/([\w.-]+)", self.path)
        if not m: self.send_error(404); return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        if data.startswith(b"data:image/png;base64,"): data = base64.b64decode(data.split(b",", 1)[1])
        with open(os.path.join(OUT, m.group(1)), "wb") as f: f.write(data)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8767), H).serve_forever()
