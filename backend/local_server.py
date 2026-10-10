"""Run the exact Lambda handlers locally against an in-memory store (no AWS, no SAM needed).

    python local_server.py            -> http://localhost:8787
    python local_server.py seed.json  -> also loads {"areas": [...], "readings": [...]} through the real ingest path

Data is lost on restart. For persistence use `sam local start-api` with LocalStack, or deploy.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent / "src"))

import api  # noqa: E402
import common  # noqa: E402
import ingest  # noqa: E402
from store import MemoryStore  # noqa: E402

store = MemoryStore()
common.set_store(store)


def seed(path):
    data = json.loads(Path(path).read_text())
    for a in data.get("areas", []):
        store.put_area(a)
    readings = data.get("readings", [])
    for i in range(0, len(readings), 500):
        res = ingest.handler({"rawPath": "/readings/batch", "body": json.dumps(readings[i:i + 500])})
        body = json.loads(res["body"])
        if body.get("failed"):
            print(f"seed: {len(body['failed'])} rejected, first: {body['failed'][0]}")
    print(f"seeded {len(data.get('areas', []))} areas, {len(readings)} readings")


class H(BaseHTTPRequestHandler):
    def _go(self):
        u = urlparse(self.path)
        n = int(self.headers.get("content-length") or 0)
        event = {
            "rawPath": u.path,
            "requestContext": {"http": {"method": self.command}},
            "queryStringParameters": dict(p.split("=", 1) for p in u.query.split("&") if "=" in p) or None,
            "headers": dict(self.headers),
            "body": self.rfile.read(n).decode() if n else None,
        }
        fn = ingest.handler if u.path.startswith("/readings") and self.command == "POST" else api.handler
        res = fn(event)
        self.send_response(res["statusCode"])
        for k, v in res["headers"].items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(res["body"].encode())

    do_GET = do_POST = do_PUT = do_OPTIONS = _go

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    if len(sys.argv) > 1:
        seed(sys.argv[1])
    print("MOIST local API on http://localhost:8787")
    ThreadingHTTPServer(("127.0.0.1", 8787), H).serve_forever()
