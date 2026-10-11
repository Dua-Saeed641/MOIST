import json
import urllib.error
import urllib.request

from gateway import status_server, to_reading

line = '{"device_id":"glove-01","moisture_raw":812,"moisture_slope":-5,"moisture_score":0.937,"class":"wet","air_temp_c":32.4,"air_rh_pct":60.0,"gas_raw":null,"distance_cm":12}'
r = to_reading(line, "demo-bench", 1000)
assert r["area_id"] == "demo-bench" and r["timestamp"] == 1000 and r["moisture_raw"] == 812
assert "class" not in r and "gas_raw" not in r  # server classifies; nulls dropped
assert to_reading("# moist glove ready", "a", 1) is None
assert to_reading('{"device_id":"glo', "a", 1) is None  # half line after reset
status_server(8799, "tok")
req = lambda h: urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8799/status", headers=h), timeout=3)
assert json.loads(req({"x-gateway-token": "tok"}).read())["glove_connected"] is False
try:
    req({})
    raise AssertionError("status served without token")
except urllib.error.HTTPError as e:
    assert e.code == 401
print("ok")
