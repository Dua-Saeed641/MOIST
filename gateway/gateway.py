"""MØIST gateway: glove (USB serial) -> local API the dashboard reads.

    pip install pyserial
    python gateway/gateway.py                  # COM5, area from AREA below
    python gateway/gateway.py --port COM7 --area-name "Ward 12 bin" --lat 28.70 --lon 77.11

Then set VITE_API_URL=http://localhost:8787 in web/.env and run the dashboard.
Readings are kept in gateway/readings.jsonl, so nothing is lost when it restarts.
"""
import argparse
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).parent
READINGS_FILE = HERE / "readings.jsonl"
ACTIONS_FILE = HERE / "actions.json"
API_PORT = 8787
SHORTED_RAW = 300  # moisture_raw far below anything wet (~650+): metal shorting the probe -> flag as anomaly

lock = threading.Lock()
readings = [json.loads(l) for l in READINGS_FILE.open(encoding="utf-8")] if READINGS_FILE.exists() else []
actions = json.loads(ACTIONS_FILE.read_text()) if ACTIONS_FILE.exists() else {}


def to_reading(line, area_id, now_ms):
    """One serial line from the glove -> API reading, or None for status/garbled lines."""
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        r = json.loads(line)
    except json.JSONDecodeError:
        return None  # half a line right after the board resets
    if "moisture_raw" not in r or "class" not in r:
        return None
    r.update(id=uuid.uuid4().hex, ts=now_ms, area_id=area_id, anomaly=r["moisture_raw"] < SHORTED_RAW)
    return r


def read_serial(port, area_id):
    import serial  # pyserial

    while True:
        try:
            with serial.Serial(port, 115200, timeout=1) as s:
                print(f"glove connected on {port}")
                while True:
                    r = to_reading(s.readline().decode("utf-8", "replace"), area_id, int(time.time() * 1000))
                    if r:
                        with lock:
                            readings.append(r)
                            with READINGS_FILE.open("a", encoding="utf-8") as f:
                                f.write(json.dumps(r) + "\n")
                        print(f"{r['class']:>9}  score={r['moisture_score']}  raw={r['moisture_raw']}")
        except Exception as e:  # unplugged, port busy (close Arduino IDE Serial Monitor!), ...
            print(f"waiting for glove on {port}: {e}")
            time.sleep(2)


def make_handler(area):
    class Handler(BaseHTTPRequestHandler):
        def send(self, code, body=None):
            data = json.dumps(body).encode() if body is not None else b""
            self.send_response(code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-api-key")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send(204)

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            if u.path == "/areas":
                return self.send(200, {"areas": [area]})
            if u.path == "/readings":
                since = int(q.get("from", ["0"])[0])
                limit = int(q.get("limit", ["1000"])[0])
                with lock:
                    rows = [r for r in readings if r["ts"] >= since][:limit]
                return self.send(200, {"readings": rows})
            if u.path == "/actions":
                return self.send(200, {"actions": actions})
            self.send(404, {"error": "not found"})

        def do_PUT(self):
            u = urlparse(self.path)
            if not u.path.startswith("/actions/"):
                return self.send(404, {"error": "not found"})
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            if body.get("state") not in ("open", "scheduled", "done"):
                return self.send(400, {"error": "state must be open, scheduled or done"})
            with lock:
                actions[unquote(u.path[len("/actions/"):])] = body["state"]
                ACTIONS_FILE.write_text(json.dumps(actions))
            self.send(200, {"ok": True})

        def log_message(self, *args):  # keep the console for glove readings
            pass

    return Handler


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", default="COM5", help="Arduino serial port")
    ap.add_argument("--area-id", default="demo-bench")
    ap.add_argument("--area-name", default="Demo bench")
    ap.add_argument("--ward", default="Lab")
    ap.add_argument("--lat", type=float, default=28.6139)  # where the glove is used: shown on the map
    ap.add_argument("--lon", type=float, default=77.2090)
    a = ap.parse_args()
    area = {"id": a.area_id, "name": a.area_name, "ward": a.ward, "kind": "collection_point", "lat": a.lat, "lon": a.lon}

    threading.Thread(target=read_serial, args=(a.port, a.area_id), daemon=True).start()
    print(f"API on http://localhost:{API_PORT}  (area: {a.area_name})")
    ThreadingHTTPServer(("", API_PORT), make_handler(area)).serve_forever()
