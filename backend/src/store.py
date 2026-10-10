"""Storage layer. MemoryStore for tests / local dev, DynamoStore for AWS (same interface)."""
import os
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal


def day_of(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def days_between(from_ms, to_ms):
    out, d = [], from_ms - (from_ms % 86400000)
    while d <= to_ms:
        out.append(day_of(d))
        d += 86400000
    return out


class MemoryStore:
    def __init__(self):
        self.readings = []  # dicts, kept sorted by ts on read
        self.stats = {}  # (area_id, date) -> row
        self.areas = {}
        self.state = {}  # (kind, key) -> item

    # readings
    def put_reading(self, r):
        """Returns False if this reading (same area + timestamp) is already stored, so retries are harmless."""
        if any(x["area_id"] == r["area_id"] and x["ts"] == r["ts"] for x in self.readings):
            return False
        self.readings.append(r)
        return True

    def query_readings(self, from_ms, to_ms, area_id=None, limit=5000):
        rs = [r for r in self.readings if from_ms <= r["ts"] <= to_ms and (area_id is None or r["area_id"] == area_id)]
        return sorted(rs, key=lambda r: r["ts"])[-limit:]

    def recent_scores(self, area_id, n=30):
        rs = sorted((r for r in self.readings if r["area_id"] == area_id), key=lambda r: r["ts"])[-n:]
        return [r["moisture_score"] for r in rs]

    # stats
    def add_stats(self, area_id, date, d):
        row = self.stats.setdefault((area_id, date), {"area_id": area_id, "date": date, "count": 0, "dry": 0,
                                                      "unc": 0, "anomalies": 0, "sum_m": 0.0})
        for k, v in d.items():
            row[k] += v

    def set_stats(self, area_id, date, row):
        self.stats[(area_id, date)] = {"area_id": area_id, "date": date, **row}

    def get_stats(self, from_date, to_date):
        by = defaultdict(list)
        for (a, d), row in sorted(self.stats.items(), key=lambda kv: kv[0][1]):
            if from_date <= d <= to_date:
                by[a].append(row)
        return by

    # areas
    def list_areas(self):
        return sorted(self.areas.values(), key=lambda a: a["name"])

    def get_area(self, area_id):
        return self.areas.get(area_id)

    def put_area(self, a):
        self.areas[a["id"]] = a

    # app state (actions, config)
    def get_state(self, kind, key):
        return self.state.get((kind, key))

    def put_state(self, kind, key, item):
        self.state[(kind, key)] = {"kind": kind, "key": key, **item}

    def list_state(self, kind):
        return [v for (k, _), v in self.state.items() if k == kind]


def _dec(o):
    """Floats -> Decimal for DynamoDB."""
    if isinstance(o, float):
        return Decimal(str(o))
    if isinstance(o, dict):
        return {k: _dec(v) for k, v in o.items()}
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
    """Tables (see template.yaml): Readings(area_id, ts; GSI byDay(day, ts)), AreaStats(area_id, date),
    Areas(area_id), AppState(kind, key)."""

    def __init__(self):
        import boto3  # imported lazily so tests run without it

        db = boto3.resource("dynamodb")
        self.t_readings = db.Table(os.environ["READINGS_TABLE"])
        self.t_stats = db.Table(os.environ["STATS_TABLE"])
        self.t_areas = db.Table(os.environ["AREAS_TABLE"])
        self.t_state = db.Table(os.environ["STATE_TABLE"])

    def put_reading(self, r):
        from botocore.exceptions import ClientError

        try:
            self.t_readings.put_item(Item=_dec({**r, "day": day_of(r["ts"])}), ConditionExpression="attribute_not_exists(area_id)")
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def _query(self, **kw):
        from_key, items, limit = None, [], kw.pop("limit")
        while len(items) < limit:
            if from_key:
                kw["ExclusiveStartKey"] = from_key
            res = self.t_readings.query(**kw)
            items += res["Items"]
            from_key = res.get("LastEvaluatedKey")
            if not from_key:
                break
        return [_undec(i) for i in items[:limit]]

    def query_readings(self, from_ms, to_ms, area_id=None, limit=5000):
        from boto3.dynamodb.conditions import Key

        if area_id:
            items = self._query(KeyConditionExpression=Key("area_id").eq(area_id) & Key("ts").between(from_ms, to_ms),
                                limit=limit)
        else:
            items = []
            for day in days_between(from_ms, to_ms):
                items += self._query(IndexName="byDay",
                                     KeyConditionExpression=Key("day").eq(day) & Key("ts").between(from_ms, to_ms),
                                     limit=limit)
        return sorted(items, key=lambda r: r["ts"])[-limit:]

    def recent_scores(self, area_id, n=30):
        from boto3.dynamodb.conditions import Key

        res = self.t_readings.query(KeyConditionExpression=Key("area_id").eq(area_id), ScanIndexForward=False, Limit=n)
        return [float(i["moisture_score"]) for i in res["Items"]]

    def add_stats(self, area_id, date, d):
        self.t_stats.update_item(
            Key={"area_id": area_id, "date": date},
            UpdateExpression="ADD #c :c, dry :d, unc :u, anomalies :a, sum_m :s",
            ExpressionAttributeNames={"#c": "count"},
            ExpressionAttributeValues=_dec({":c": d["count"], ":d": d["dry"], ":u": d["unc"],
                                            ":a": d["anomalies"], ":s": d["sum_m"]}),
        )

    def set_stats(self, area_id, date, row):
        self.t_stats.put_item(Item=_dec({"area_id": area_id, "date": date, **row}))

    def get_stats(self, from_date, to_date):
        from boto3.dynamodb.conditions import Attr

        items, kw = [], {"FilterExpression": Attr("date").between(from_date, to_date)}
        while True:
            res = self.t_stats.scan(**kw)
            items += res["Items"]
            if "LastEvaluatedKey" not in res:
                break
            kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]
        by = defaultdict(list)
        for i in sorted((_undec(i) for i in items), key=lambda i: i["date"]):
            by[i["area_id"]].append(i)
        return by

    def list_areas(self):
        items, kw = [], {}
        while True:
            res = self.t_areas.scan(**kw)
            items += res["Items"]
            if "LastEvaluatedKey" not in res:
                break
            kw["ExclusiveStartKey"] = res["LastEvaluatedKey"]
        return sorted((_undec(i) | {"id": i["area_id"]} for i in items), key=lambda a: a["name"])

    def get_area(self, area_id):
        i = self.t_areas.get_item(Key={"area_id": area_id}).get("Item")
        return (_undec(i) | {"id": i["area_id"]}) if i else None

    def put_area(self, a):
        self.t_areas.put_item(Item=_dec({**a, "area_id": a["id"]}))

    def get_state(self, kind, key):
        i = self.t_state.get_item(Key={"kind": kind, "key": key}).get("Item")
        return _undec(i) if i else None

    def put_state(self, kind, key, item):
        self.t_state.put_item(Item=_dec({"kind": kind, "key": key, **item}))

    def list_state(self, kind):
        from boto3.dynamodb.conditions import Key

        return [_undec(i) for i in self.t_state.query(KeyConditionExpression=Key("kind").eq(kind))["Items"]]
