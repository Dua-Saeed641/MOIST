"""python backend/test_backend.py  -> prints ok"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))
import app  # noqa: E402
import logic  # noqa: E402
from store import FileStore  # noqa: E402


def call(method, path, body=None, q=None, key="k" * 16):
    res = app.handler({"requestContext": {"http": {"method": method}}, "rawPath": path, "queryStringParameters": q,
                       "headers": {"x-api-key": key}, "body": json.dumps(body) if body is not None else None})
    return res["statusCode"], json.loads(res["body"])


import os  # noqa: E402

os.environ["WRITE_API_KEY"] = "k" * 16
os.environ["BRIEF_AI"] = "0"
app.set_store(FileStore())

assert logic.score_of(990) == 0 and logic.score_of(800) == 1 and logic.classify(0.5) == "uncertain"
assert call("PUT", "/areas/bench", {"name": "Bench", "lat": 28.6, "lon": 77.2})[0] == 200
assert call("POST", "/readings", {"device_id": "g", "area_id": "bench", "moisture_raw": 990}, key="bad")[0] == 401
assert call("POST", "/readings", {"device_id": "g", "area_id": "nope", "moisture_raw": 990})[0] == 400

now = int(time.time() * 1000)
s, r = call("POST", "/readings", {"device_id": "glove-01", "area_id": "bench", "moisture_raw": 812, "timestamp": now - 5000})
assert s == 200 and r["class"] == "wet" and r["anomaly"] is False, r
s, r = call("POST", "/readings", {"device_id": "glove-01", "area_id": "bench", "moisture_raw": 40, "timestamp": now - 4000})
assert r["anomaly"] and r["anomaly_reason"].startswith("Probe shorted"), r
batch = [{"device_id": "g", "area_id": "bench", "moisture_raw": 985, "timestamp": now - 100_000 - i} for i in range(6)]
assert call("POST", "/readings", batch) == (200, {"stored": 6})

s, live = call("GET", "/live", q={"since": str(now - 4500)})
assert [x["moisture_raw"] for x in live["readings"]] == [40], live["readings"]
s, ov = call("GET", "/overview", q={"range": "7d"})
a = ov["areas"][0]
assert ov["kpis"]["checks"] == 8 and a["stats"]["dry"] == 6 and a["stats"]["status"] == "inspect", a["stats"]
assert call("GET", "/alerts")[1]["alerts"][0]["area_name"] == "Bench"
assert call("PUT", "/actions/bench:inspect", {"state": "done"})[0] == 200
assert call("GET", "/actions")[1]["actions"] == {"bench:inspect": "done"}
assert call("POST", "/brief")[1]["source"] == "rules"
assert call("GET", "/overview", q={"range": "1y"})[0] == 400
assert app.handler({})["source"] == "rules"  # scheduled event path
assert call("POST", "/ask", {"question": "x"})[0] == 400
assert call("POST", "/ask", {"question": "Which area is driest?"})[0] == 503  # no Bedrock locally
assert call("GET", "/gateway") == (200, {"configured": False})
os.environ["BRIEF_AI"] = "1"
app.answer = lambda areas, q, period: f"{len(areas)} areas; asked: {q}"
assert call("POST", "/ask", {"question": "Which area is driest?"})[1]["answer"] == "1 areas; asked: Which area is driest?"
app.ASK_PER_HOUR = 1
assert call("POST", "/ask", {"question": "Again?"})[0] == 429
print("ok")
