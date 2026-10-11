"""MØIST gateway: glove (USB serial) -> MØIST API (local backend or AWS API Gateway).

    pip install pyserial
    python gateway/gateway.py                                   # COM5 -> http://localhost:8787
    python gateway/gateway.py --api https://xxx.execute-api.ap-south-1.amazonaws.com --key <WriteApiKey>
    python gateway/gateway.py --area-id ward12 --area-name "Ward 12 bin" --lat 28.70 --lon 77.11

Readings that cannot be sent (no Wi-Fi, API down) wait in gateway/outbox.jsonl and are sent when the API is back.

Status endpoint (for ngrok): GET http://localhost:8790/status says whether the glove is plugged in, the last reading
and how many readings are queued. `ngrok http 8790` makes it reachable, and the AWS API reads it so the hosted
dashboard can show the glove's live state. Protect it with --status-token (sent as the x-gateway-token header).
"""
import argparse
import json
import os
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUTBOX = Path(__file__).parent / "outbox.jsonl"
STATE = {"glove_connected": False, "sent": 0, "last_reading": None, "last_seen": None}


def queued():
    return sum(1 for l in OUTBOX.read_text(encoding="utf-8").splitlines() if l.strip()) if OUTBOX.exists() else 0


def status_server(port, token):
    """Read-only status for the cloud dashboard, reached through ngrok."""
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] != "/status":
                return self._send(404, {"error": "not found"})
            if token and self.headers.get("x-gateway-token") != token:
                return self._send(401, {"error": "bad token"})
            self._send(200, {**STATE, "queued": queued(), "now": int(time.time() * 1000)})

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"status on http://localhost:{port}/status  (expose with: ngrok http {port})")


def to_reading(line, area_id, now_ms):
    """One serial line from the glove -> API body, or None for status/garbled lines."""
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        r = json.loads(line)
    except json.JSONDecodeError:
        return None  # half a line right after the board resets
    if not isinstance(r, dict) or "moisture_raw" not in r:
        return None
    r.pop("class", None)  # the server classifies; the glove's own verdict is already on its LEDs
    return {**{k: v for k, v in r.items() if v is not None}, "area_id": area_id, "timestamp": now_ms}


def call(api, key, method, path, body):
    req = urllib.request.Request(api.rstrip("/") + path, data=json.dumps(body).encode(), method=method,
                                 headers={"content-type": "application/json", "x-api-key": key})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


def flush(api, key, lock):
    """Send everything waiting in the outbox (oldest first). Keeps it if the API is unreachable."""
    with lock:
        if not OUTBOX.exists():
            return
        rows = [json.loads(l) for l in OUTBOX.read_text(encoding="utf-8").splitlines() if l.strip()]
        try:
            for i in range(0, len(rows), 500):
                call(api, key, "POST", "/readings", rows[i:i + 500])
            OUTBOX.unlink()
            print(f"sent {len(rows)} queued readings")
        except Exception as e:
            print(f"outbox: still offline ({e})")


def send(api, key, r, lock):
    try:
        res = call(api, key, "POST", "/readings", r)
        STATE["sent"] += 1
        flag = f"  ANOMALY: {res['anomaly_reason']}" if res.get("anomaly") else ""
        print(f"{res['class']:>9}  score={res['moisture_score']}  raw={r['moisture_raw']}{flag}")
    except Exception as e:
        print(f"offline, queued ({e})")
        with lock, OUTBOX.open("a", encoding="utf-8") as f:
            f.write(json.dumps(r) + "\n")


def main():
    env = Path(__file__).parent / ".env"  # gateway/.env: MOIST_API, MOIST_API_KEY, MOIST_GATEWAY_TOKEN (gitignored)
    for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        if "=" in line and not line.lstrip().startswith("#"):
            os.environ.setdefault(*map(str.strip, line.split("=", 1)))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default="COM5", help="Arduino serial port")
    ap.add_argument("--api", default=os.environ.get("MOIST_API") or "http://localhost:8787")
    ap.add_argument("--key", default=os.environ.get("MOIST_API_KEY", ""))
    ap.add_argument("--area-id", default="demo-bench")
    ap.add_argument("--area-name", default="Demo bench")
    ap.add_argument("--ward", default="Lab")
    ap.add_argument("--kind", default="collection_point", choices=["collection_point", "transfer_station", "colony"])
    ap.add_argument("--lat", type=float, default=28.6139)  # where the glove is used: shown on the map
    ap.add_argument("--lon", type=float, default=77.2090)
    ap.add_argument("--status-port", type=int, default=8790, help="local status endpoint for ngrok (0 = off)")
    ap.add_argument("--status-token", default=os.environ.get("MOIST_GATEWAY_TOKEN", ""))
    a = ap.parse_args()

    import serial  # pyserial

    area = {"name": a.area_name, "ward": a.ward, "kind": a.kind, "lat": a.lat, "lon": a.lon}
    while True:
        try:
            call(a.api, a.key, "PUT", f"/areas/{a.area_id}", area)
            break
        except Exception as e:
            print(f"waiting for API at {a.api}: {e}")
            time.sleep(3)
    print(f"API ok: {a.api}  (area: {a.area_name})")

    STATE.update(port=a.port, area_id=a.area_id, api=a.api)
    if a.status_port:
        status_server(a.status_port, a.status_token)
    lock = threading.Lock()
    flush(a.api, a.key, lock)
    last_flush = time.time()
    while True:
        try:
            with serial.Serial(a.port, 115200, timeout=1) as s:
                print(f"glove connected on {a.port}")
                STATE["glove_connected"] = True
                while True:
                    r = to_reading(s.readline().decode("utf-8", "replace"), a.area_id, int(time.time() * 1000))
                    if r:
                        STATE.update(last_reading=r, last_seen=r["timestamp"])
                        send(a.api, a.key, r, lock)
                    if OUTBOX.exists() and time.time() - last_flush > 30:
                        flush(a.api, a.key, lock)
                        last_flush = time.time()
        except Exception as e:  # unplugged, port busy (close the Arduino IDE Serial Monitor!), ...
            STATE["glove_connected"] = False
            print(f"waiting for glove on {a.port}: {e}")
            time.sleep(2)


if __name__ == "__main__":
    main()
