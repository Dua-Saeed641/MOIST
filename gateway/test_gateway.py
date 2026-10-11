from gateway import to_reading

line = '{"device_id":"glove-01","moisture_raw":812,"moisture_slope":-5,"moisture_score":0.937,"class":"wet","air_temp_c":32.4,"air_rh_pct":60.0,"gas_raw":null,"distance_cm":12}'
r = to_reading(line, "demo-bench", 1000)
assert r["class"] == "wet" and r["area_id"] == "demo-bench" and r["ts"] == 1000 and r["anomaly"] is False and r["id"]
assert to_reading(line.replace("812", "40"), "a", 1)["anomaly"] is True  # shorted probe
assert to_reading("# moist glove ready", "a", 1) is None
assert to_reading('{"device_id":"glo', "a", 1) is None  # half line after reset
print("ok")
