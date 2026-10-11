"""Daily dispatch brief and Q&A: an LLM turns the computed area numbers into plain language for the officer.
The model only explains numbers we already computed; it never classifies waste.

Providers, tried in order until one answers:
  1. OpenRouter, one attempt per key in OPENROUTER_KEYS (comma-separated); OpenRouter itself falls back across OPENROUTER_MODELS
  2. Amazon Bedrock (Amazon Nova 2 Lite), when the account has Bedrock quota
  3. a rule-based brief (questions get an error instead)
"""
import json
import os
import time
import urllib.error
import urllib.request

BEDROCK_MODEL = os.environ.get("BRIEF_MODEL", "us.amazon.nova-2-lite-v1:0")  # US cross-region inference profile
OPENROUTER_MODELS = os.environ.get(
    "OPENROUTER_MODELS", "nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free").split(",")
# measured on the brief prompt: Nemotron Super ~11 s; the Gemmas are often rate-limited upstream (429)
# not "openrouter/free": it can route to a non-chat model (e.g. a safety classifier that replies "User Safety: safe")
DEADLINE_S = 25  # API Gateway cuts requests at 30 s

SYSTEM = """You write the morning dispatch brief for a municipal solid-waste officer in India.
You receive per-area statistics from moisture-sensing gloves (computed by our system, last 7 days).
ESI is the Energy Suitability Index (0-100): high means dry, low-moisture waste that suits refuse-derived fuel.
Write plain text, no markdown headings or bold. Start with one sentence on the overall picture, then up to four lines
that each start with "- " and name an area and the concrete action (send dry load to the energy plant, run a
segregation drive, inspect, or watch). Use only the numbers given; never invent figures. Under 130 words."""

ASK_SYSTEM = """You answer questions from a municipal solid-waste officer in India about data from moisture-sensing gloves.
You receive the officer's question and per-area statistics computed by our system for the chosen period.
ESI is the Energy Suitability Index (0-100): high means dry, low-moisture waste that suits refuse-derived fuel.
Status values: pickup (send to energy plant), wet (segregation drive needed), inspect (many faulty readings), watch, ok, idle (too few readings).
Answer in plain text without markdown, at most 120 words, using only the numbers given and naming areas. If the data
cannot answer the question, say so in one sentence and suggest what the officer could look at instead."""


def rule_brief(areas):
    rated = [a for a in areas if a["stats"]["status"] != "idle"]
    if not rated:
        return "Not enough readings yet. Each collection point needs at least 5 readings before it is rated."
    best = max(rated, key=lambda a: a["stats"]["esi"])
    lines = [f"{len(rated)} collection points rated over the last 7 days. Highest ESI: {best['name']} ({best['stats']['esi']:.0f})."]
    for a in sorted(rated, key=lambda a: -a["stats"]["esi"]):
        if a["stats"]["status"] != "ok":
            lines.append(f"- {a['name']}: {a['recommendation']['title'].lower()}. {a['recommendation']['detail']}")
    return "\n".join(lines[:5])


def facts(areas):
    return [{"area": a["name"], "ward": a.get("ward"), **{k: a["stats"][k] for k in
            ("count", "dryShare", "meanMoisture", "esi", "anomalyShare", "trend", "status")}} for a in areas]


def openrouter_keys():
    return [k.strip() for k in os.environ.get("OPENROUTER_KEYS", "").split(",") if k.strip()]


def ai_enabled():
    return os.environ.get("BRIEF_AI", "1") == "1"


def openrouter(key, system, content, max_tokens, timeout):
    # reasoning models (Nemotron) spend tokens thinking before they answer: keep it short and leave room for the text
    body = {"models": OPENROUTER_MODELS, "max_tokens": max_tokens, "temperature": 0.3, "reasoning": {"effort": "low", "exclude": True},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(), headers={
        "Authorization": f"Bearer {key}", "content-type": "application/json",
        "HTTP-Referer": "https://github.com/Dua-Saeed641/Analytical-Core", "X-Title": "MOIST"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    text = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if len(text.strip()) < 40:  # empty or a non-answer: try the next key
        raise RuntimeError(f"no usable answer: {str(d.get('error') or text or d)[:120]}")
    return text.strip(), d.get("model", OPENROUTER_MODELS[0])


def bedrock(system, content, max_tokens):
    import boto3

    region = os.environ.get("BEDROCK_REGION") or os.environ.get("AWS_REGION", "us-east-1")
    r = boto3.client("bedrock-runtime", region_name=region).converse(
        modelId=BEDROCK_MODEL,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": content}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
    )
    if r.get("stopReason") == "content_filtered":
        raise RuntimeError("model declined")
    return "".join(b.get("text", "") for b in r["output"]["message"]["content"]).strip(), BEDROCK_MODEL


def generate(system, content, max_tokens=2000):
    """(text, provider, model) from the first provider that answers. Raises when none does."""
    start, errors = time.monotonic(), []
    for i, key in enumerate(openrouter_keys(), 1):
        left = DEADLINE_S - (time.monotonic() - start)
        if left < 4:
            break
        try:
            text, model = openrouter(key, system, content, max_tokens, timeout=min(20, left))
            return text, "openrouter", model
        except urllib.error.HTTPError as e:  # 401 bad key, 402 no credit, 429 rate limit, 5xx: next key
            errors.append(f"openrouter key {i}: HTTP {e.code}")
        except Exception as e:
            errors.append(f"openrouter key {i}: {e!r}"[:160])
    if os.environ.get("BEDROCK_FALLBACK", "1") == "1" and DEADLINE_S - (time.monotonic() - start) > 4:
        try:
            text, model = bedrock(system, content, max_tokens)
            return text, "bedrock", model
        except Exception as e:
            errors.append(f"bedrock: {e!r}"[:160])
    raise RuntimeError("; ".join(errors) or "no AI provider configured")


def answer(areas, question, period):
    """(text, model) for a free-text question about the computed area numbers. Raises if no provider answers."""
    text, _, model = generate(ASK_SYSTEM, json.dumps({"question": question, "period": period, "areas": facts(areas)}))
    return text, model


def make_brief(areas, use_ai=True):
    if use_ai and ai_enabled():
        try:
            text, provider, model = generate(SYSTEM, json.dumps(facts(areas)))
            return {"text": text, "source": provider, "model": model}
        except Exception as e:
            print(f"AI brief failed, using rules: {e}")
    return {"text": rule_brief(areas), "source": "rules"}
