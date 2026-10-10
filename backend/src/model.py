"""Loads the exported classifier/calibration file from S3 once per Lambda container (report section 10.2).
Falls back to the built-in calibration when no bucket is configured or the file is missing."""
import json
import os

from logic import DEFAULT_MODEL

_model = None


def load_model():
    global _model
    if _model is not None:
        return _model
    model = dict(DEFAULT_MODEL)
    bucket = os.environ.get("MODEL_BUCKET")
    if bucket:
        try:
            import boto3

            body = boto3.client("s3").get_object(Bucket=bucket, Key=os.environ.get("MODEL_KEY", "model.json"))["Body"]
            model.update(json.loads(body.read()))
        except Exception as exc:  # missing file is expected before training
            print(f"model.json not loaded, using defaults: {exc}")
    _model = model
    return _model
