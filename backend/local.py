"""Run the same Lambda handler on your laptop (no AWS account needed): http://localhost:8787

    python backend/local.py               # data kept in backend/local-data.json
    python backend/seed.py                # optional: demo areas + 30 days of simulated history

The Bedrock brief needs AWS credentials; without them the brief falls back to the rule-based text.
"""
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "src"))
os.environ.setdefault("GATEWAY_URL", "http://localhost:8790")  # the gateway status endpoint on this laptop
os.environ.setdefault("BRIEF_AI", "1" if os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE") else "0")

import app  # noqa: E402
from store import FileStore  # noqa: E402

PORT = int(os.environ.get("PORT", 8787))


class Handler(BaseHTTPRequestHandler):
    def _run(self):
        u = urlparse(self.path)
        n = int(self.headers.get("content-length") or 0)
        res = app.handler({
            "requestContext": {"http": {"method": self.command}},
            "rawPath": u.path,
            "queryStringParameters": dict(parse_qsl(u.query)),
            "headers": dict(self.headers),
            "body": self.rfile.read(n).decode() if n else None,
        })
        body = res["body"].encode()
        self.send_response(res["statusCode"])
        for k, v in res["headers"].items():
            self.send_header(k, v)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_OPTIONS = _run

    def log_message(self, fmt, *args):
        if "/live" not in self.path:  # the dashboard polls /live every 2 s
            super().log_message(fmt, *args)


if __name__ == "__main__":
    app.set_store(FileStore(str(HERE / "local-data.json")))
    print(f"MØIST API (local) on http://localhost:{PORT}")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
