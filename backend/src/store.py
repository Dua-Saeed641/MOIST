"""Storage. DynamoStore on AWS; FileStore for local runs and tests (same methods)."""
import json
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal

DAY = 86_400_000


def day_of(ts):
    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


class FileStore:
    """Everything in memory, saved to one JSON file (or nowhere when path is None)."""

    def __init__(self, path=None):
        self.path, self.lock = path, threading.Lock()
        data = json.load(open(path, encoding="utf-8")) if path and os.path.exists(path) else {}
        self.readings = data.get("readings", [])
        self.areas = data.get("areas", {})
        self.state = data.get("state", {})

    def _save(self):
        if self.path:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump({"readings": self.readings, "areas": self.areas, "state": self.state}, f)

    def put_reading(self, r):
        with self.lock:
            if any(x["area_id"] == r["area_id"] and x["ts"] == r["ts"] for x in self.readings[-500:]):
                return False  # a retry from the gateway
            self.readings.append(r)
            self.readings.sort(key=lambda x: x["ts"])
            self._save()
            return True

    def put_readings(self, rs):
        with self.lock:
            self.readings += rs
            self.readings.sort(key=lambda x: x["ts"])
            self._save()

    def readings_between(self, frm, to, area_id=None):
        return [r for r in self.readings if frm <= r["ts"] <= to and (area_id is None or r["area_id"] == area_id)]

    def list_areas(self):
        return sorted(self.areas.values(), key=lambda a: a["name"])

    def get_area(self, area_id):
        return self.areas.get(area_id)

    def put_area(self, a):
        with self.lock:
            self.areas[a["id"]] = a
            self._save()

    def get_state(self, kind, key):
        return self.state.get(f"{kind}/{key}")

    def put_state(self, kind, key, item):
        with self.lock:
            self.state[f"{kind}/{key}"] = {"key": key, **item}
            self._save()

    def list_state(self, kind):
        return [v for k, v in self.state.items() if k.startswith(kind + "/")]


def _dec(o):
    if isinstance(o, float):
        return Decimal(str(o))
    if isinstance(o, dict):
        return {k: _dec(v) for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [_dec(v) for v in o]
    return o


def _undec(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    if isinstance(o, dict):
        return {k: _undec(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_undec(v) for v in o]
    return o


class DynamoStore:
    """Tables (template.yaml): Readings(area_id, ts) + GSI byDay(day, ts), Areas(area_id), State(kind, key)."""

    def __init__(self):
        import boto3

        db = boto3.resource("dynamodb")
        self.t_readings = db.Table(os.environ["READINGS_TABLE"])
        self.t_areas = db.Table(os.environ["AREAS_TABLE"])
        self.t_state = db.Table(os.environ["STATE_TABLE"])

    def put_reading(self, r):
        from botocore.exceptions import ClientError

        try:
            self.t_readings.put_item(Item=_dec({**r, "day": day_of(r["ts"])}),
                                     ConditionExpression="attribute_not_exists(area_id)")
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def put_readings(self, rs):
        with self.t_readings.batch_writer(overwrite_by_pkeys=["area_id", "ts"]) as b:
            for r in rs:
                b.put_item(Item=_dec({**r, "day": day_of(r["ts"])}))

    def _query(self, **kw):
        items = []
        while True:
            res = self.t_readings.query(**kw)
            items += res["Items"]
            if "LastEvaluatedKey" not in res:
                return items
            kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def readings_between(self, frm, to, area_id=None):
        from boto3.dynamodb.conditions import Key

        if area_id:
            items = self._query(KeyConditionExpression=Key("area_id").eq(area_id) & Key("ts").between(frm, to))
        else:
            # ponytail: one query per day partition; precompute daily stats if a range ever holds >100k readings
            items, d = [], frm - frm % DAY
            while d <= to:
                items += self._query(IndexName="byDay", KeyConditionExpression=Key("day").eq(day_of(d)) & Key("ts").between(frm, to))
                d += DAY
        return sorted((_undec(i) for i in items), key=lambda r: r["ts"])

    def list_areas(self):
        items, kw = [], {}
        while True:
            res = self.t_areas.scan(**kw)
            items += res["Items"]
            if "LastEvaluatedKey" not in res:
                break
            kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]
        return sorted((_undec(i) for i in items), key=lambda a: a["name"])

    def get_area(self, area_id):
        i = self.t_areas.get_item(Key={"id": area_id}).get("Item")
        return _undec(i) if i else None

    def put_area(self, a):
        self.t_areas.put_item(Item=_dec(a))

    def get_state(self, kind, key):
        i = self.t_state.get_item(Key={"kind": kind, "key": key}).get("Item")
        return _undec(i) if i else None

    def put_state(self, kind, key, item):
        self.t_state.put_item(Item=_dec({"kind": kind, "key": key, **item}))

    def list_state(self, kind):
        from boto3.dynamodb.conditions import Key

        return [_undec(i) for i in self.t_state.query(KeyConditionExpression=Key("kind").eq(kind))["Items"]]
