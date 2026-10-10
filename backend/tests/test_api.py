import json
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import api  # noqa: E402
import common  # noqa: E402
import ingest  # noqa: E402
from logic import classify, esi_of, is_anomaly, moisture_score  # noqa: E402
from store import MemoryStore  # noqa: E402


def call(fn, method, path, body=None, query=None, headers=None):
    res = fn({"rawPath": path, "requestContext": {"http": {"method": method}}, "queryStringParameters": query,
              "headers": headers or {}, "body": json.dumps(body) if body is not None else None})
    return res["statusCode"], json.loads(res["body"])


_tick = [0]


def reading(area="a1", raw=900, ts=None, **kw):
    _tick[0] += 1  # every default reading gets its own timestamp, so none is mistaken for a retry
    return {"device_id": "glove-01", "area_id": area, "timestamp": ts or int(time.time() * 1000) - 60_000 + _tick[0], "moisture_raw": raw, **kw}


class Base(unittest.TestCase):
    def setUp(self):
        os.environ.pop("WRITE_API_KEY", None)
        self.store = MemoryStore()
        common.set_store(self.store)
        self.store.put_area({"id": "a1", "name": "Alpha", "ward": "W1", "lat": 28.7, "lon": 77.1})
        self.store.put_area({"id": "a2", "name": "Beta", "ward": "W2", "lat": 28.6, "lon": 77.2})


class LogicTests(unittest.TestCase):
    def test_score_and_class(self):
        self.assertEqual(moisture_score(1023), 0.0)
        self.assertEqual(moisture_score(0), 1.0)
        self.assertEqual(classify(0.1), "dry")
        self.assertEqual(classify(0.5), "uncertain")
        self.assertEqual(classify(0.9), "wet")

    def test_esi_bounds(self):
        w = {"w1": 0.5, "w2": 0.3, "w3": 0.2}
        self.assertAlmostEqual(esi_of(0, 1, 0, w), 100)
        self.assertAlmostEqual(esi_of(1, 0, 1, w), 0)

    def test_anomaly(self):
        calm = [0.2, 0.22, 0.18, 0.21, 0.19, 0.2, 0.23, 0.17, 0.2]
        self.assertTrue(is_anomaly(0.95, None, calm))
        self.assertFalse(is_anomaly(0.25, None, calm))
        self.assertTrue(is_anomaly(0.2, 900, calm))  # gas spike
        self.assertFalse(is_anomaly(0.95, None, calm[:3]))  # not enough history


class IngestTests(Base):
    def test_ingest_classifies_and_updates_stats(self):
        code, body = call(ingest.handler, "POST", "/readings", reading(raw=950))
        self.assertEqual(code, 200)
        self.assertEqual(body["class"], "dry")
        code, body = call(ingest.handler, "POST", "/readings", reading(raw=100))
        self.assertEqual(body["class"], "wet")
        (row,) = [r for (a, _), r in self.store.stats.items() if a == "a1"]
        self.assertEqual((row["count"], row["dry"]), (2, 1))

    def test_validation(self):
        code, body = call(ingest.handler, "POST", "/readings", {"device_id": "g", "moisture_raw": 5000})
        self.assertEqual(code, 400)
        self.assertTrue(body["details"])
        code, body = call(ingest.handler, "POST", "/readings", reading(area="nope"))
        self.assertEqual(code, 400)
        code, _ = call(ingest.handler, "POST", "/readings", reading(ts=int(time.time() * 1000) + 3600_000))
        self.assertEqual(code, 400)

    def test_retry_is_not_double_counted(self):
        r = reading(raw=900)
        call(ingest.handler, "POST", "/readings", r)
        code, body = call(ingest.handler, "POST", "/readings", r)
        self.assertEqual((code, body.get("duplicate")), (200, True))
        (row,) = [x for (a, _), x in self.store.stats.items() if a == "a1"]
        self.assertEqual(row["count"], 1)

    def test_worker_id_is_stored_as_opaque_id(self):
        call(ingest.handler, "POST", "/readings", reading(worker_id="w-17"))
        self.assertEqual(self.store.readings[0]["worker_id"], "w-17")

    def test_batch_partial_failure(self):
        batch = [reading(raw=900), reading(area="nope"), reading(raw=120)]
        code, body = call(ingest.handler, "POST", "/readings/batch", batch)
        self.assertEqual(code, 207)
        self.assertEqual(body["stored"], 2)
        self.assertEqual(len(body["failed"]), 1)

    def test_api_key_enforced_when_set(self):
        os.environ["WRITE_API_KEY"] = "secret"
        code, _ = call(ingest.handler, "POST", "/readings", reading())
        self.assertEqual(code, 401)
        code, _ = call(ingest.handler, "POST", "/readings", reading(), headers={"X-Api-Key": "secret"})
        self.assertEqual(code, 200)


class ApiTests(Base):
    def feed(self, area, raws):
        now = int(time.time() * 1000)
        for i, raw in enumerate(raws):
            call(ingest.handler, "POST", "/readings", reading(area=area, raw=raw, ts=now - (len(raws) - i) * 1000))

    def test_areas_summary_and_rank(self):
        self.feed("a1", [950] * 10)  # dry area
        self.feed("a2", [100] * 10)  # wet area
        code, body = call(api.handler, "GET", "/areas")
        self.assertEqual(code, 200)
        by = {a["id"]: a for a in body["areas"]}
        self.assertEqual(by["a1"]["stats"]["dryFraction"], 1.0)
        self.assertEqual(by["a1"]["rankAll"], 1)
        self.assertEqual(by["a2"]["stats"]["status"], "blue")
        self.assertEqual(by["a2"]["recommendation"]["type"], "campaign")
        self.assertEqual(by["a1"]["stats"]["status"], "amber")  # ESI above pickup threshold
        self.assertEqual(by["a1"]["recommendation"]["type"], "pickup")

    def test_area_detail_and_404(self):
        self.feed("a1", [900] * 6)
        code, body = call(api.handler, "GET", "/areas/a1")
        self.assertEqual(code, 200)
        self.assertEqual(body["trend"][0]["count"], 6)
        self.assertEqual(call(api.handler, "GET", "/areas/zzz")[0], 404)

    def test_readings_query(self):
        self.feed("a1", [900] * 4)
        self.feed("a2", [900] * 3)
        _, body = call(api.handler, "GET", "/readings")
        self.assertEqual(body["count"], 7)
        _, body = call(api.handler, "GET", "/readings", query={"area_id": "a2"})
        self.assertEqual(body["count"], 3)
        self.assertEqual(call(api.handler, "GET", "/readings", query={"from": "garbage"})[0], 400)

    def test_insights(self):
        self.feed("a1", [950] * 10)
        self.feed("a2", [100] * 10)
        _, body = call(api.handler, "GET", "/insights")
        self.assertEqual(body["pickup"][0]["area_id"], "a1")
        self.assertEqual(body["campaign"][0]["area_id"], "a2")

    def test_actions_roundtrip_and_validation(self):
        code, _ = call(api.handler, "PUT", "/actions/a1%3Apickup", {"state": "scheduled"})
        self.assertEqual(code, 200)
        _, body = call(api.handler, "GET", "/actions")
        self.assertEqual(body["actions"], {"a1:pickup": "scheduled"})
        self.assertEqual(call(api.handler, "PUT", "/actions/a1%3Apickup", {"state": "bogus"})[0], 400)

    def test_config_validation_and_effect(self):
        self.assertEqual(call(api.handler, "PUT", "/config", {"weights": {"w1": 0.9}})[0], 400)  # sum != 1
        self.assertEqual(call(api.handler, "PUT", "/config", {"thresholds": {"anomalyAmber": 0.5}})[0], 400)
        self.feed("a1", [950] * 10)
        call(api.handler, "PUT", "/config", {"thresholds": {"pickupEsiMin": 99.9}})
        _, body = call(api.handler, "GET", "/areas")
        self.assertEqual({a["id"]: a for a in body["areas"]}["a1"]["stats"]["status"], "green")

    def test_put_area_validation(self):
        self.assertEqual(call(api.handler, "PUT", "/areas/x", {"name": "X"})[0], 400)
        code, _ = call(api.handler, "PUT", "/areas/x", {"name": "X", "lat": 28.1, "lon": 77.1})
        self.assertEqual(code, 200)
        self.assertEqual(call(api.handler, "GET", "/nope")[0], 404)


if __name__ == "__main__":
    unittest.main()


class ClassifierTests(Base):
    """The trained-model path (forest / logistic export) and the uncertain band."""

    def setUp(self):
        super().setUp()
        import model as model_mod

        self.model_mod = model_mod
        self.saved = model_mod._model
        # One-split tree on moisture_raw (feature 0): raw <= 500 -> wet, else dry; leaves are deliberately not 100% sure.
        tree = [{"f": 0, "t": 500, "l": 1, "r": 2}, {"p": [0.1, 0.9]}, {"p": [0.95, 0.05]}]
        model_mod._model = {**__import__("logic").DEFAULT_MODEL, "confidence": 0.8,
                            "classifier": {"type": "forest", "classes": ["dry", "wet"], "trees": [tree]}}

    def tearDown(self):
        self.model_mod._model = self.saved

    def test_forest_decides_and_flags_uncertain(self):
        _, a = call(ingest.handler, "POST", "/readings", reading(raw=900))
        _, b = call(ingest.handler, "POST", "/readings", reading(raw=100))
        self.assertEqual((a["class"], b["class"]), ("dry", "wet"))
        self.model_mod._model["confidence"] = 0.97  # now neither leaf is confident enough
        _, c = call(ingest.handler, "POST", "/readings", reading(raw=900))
        self.assertEqual(c["class"], "uncertain")
        self.assertIn("confidence", self.store.readings[0])

    def test_logistic_export(self):
        from logic import predict_proba

        spec = {"type": "logistic", "classes": ["dry", "wet"], "mean": [0] * 6, "scale": [1] * 6,
                "coef": [-0.01, 0, 0, 0, 0, 0], "intercept": 5.0}
        self.assertGreater(predict_proba(spec, [0, 0, 0, 0, 0, 0])[1], 0.99)  # raw 0 -> wet
        self.assertLess(predict_proba(spec, [1000, 0, 0, 0, 0, 0])[1], 0.01)  # raw 1000 -> dry
