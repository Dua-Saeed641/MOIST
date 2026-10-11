"""Daily dispatch brief: Claude on Amazon Bedrock turns the computed area numbers into a short note for the officer.
The model only explains numbers we already computed; it never classifies waste. Falls back to a rule-based brief."""
import json
import os

MODEL = os.environ.get("BRIEF_MODEL", "anthropic.claude-opus-5-5")

SYSTEM = """You write the morning dispatch brief for a municipal solid-waste officer in India.
You receive per-area statistics from moisture-sensing gloves (computed by our system, last 7 days).
ESI is the Energy Suitability Index (0-100): high means dry, low-moisture waste that suits refuse-derived fuel.
Write plain text, no markdown headings. Start with one sentence on the overall picture, then up to four lines
that each start with "- " and name an area and the concrete action (send dry load to the energy plant, run a
segregation drive, inspect, or watch). Use only the numbers given; never invent figures. Under 130 words."""


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


ASK_SYSTEM = """You answer questions from a municipal solid-waste officer in India about data from moisture-sensing gloves.
You receive the officer's question and per-area statistics computed by our system for the chosen period.
ESI is the Energy Suitability Index (0-100): high means dry, low-moisture waste that suits refuse-derived fuel.
Status values: pickup (send to energy plant), wet (segregation drive needed), inspect (many faulty readings), watch, ok, idle (too few readings).
Answer in plain text, at most 120 words, using only the numbers given and naming areas. If the data cannot answer
the question, say so in one sentence and suggest what the officer could look at instead."""


def ai_enabled():
    return os.environ.get("BRIEF_AI", "1") == "1"


def claude(system, content, max_tokens=2000):
    from anthropic import AnthropicBedrockMantle

    client = AnthropicBedrockMantle(aws_region=os.environ.get("BEDROCK_REGION") or os.environ.get("AWS_REGION", "us-east-1"))
    msg = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        output_config={"effort": "low"},
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    if msg.stop_reason == "refusal":
        raise RuntimeError("model declined")
    return next(b.text for b in msg.content if b.type == "text").strip()


def bedrock_brief(areas):
    return claude(SYSTEM, json.dumps(facts(areas)))


def answer(areas, question, period):
    """Ask Claude a free-text question about the computed area numbers. Raises if Bedrock is not available."""
    return claude(ASK_SYSTEM, json.dumps({"question": question, "period": period, "areas": facts(areas)}), max_tokens=1200)


def make_brief(areas, use_ai=True):
    if use_ai and ai_enabled():
        try:
            return {"text": bedrock_brief(areas), "source": "bedrock", "model": MODEL}
        except Exception as e:  # no Bedrock access, no credentials, package missing locally...
            print(f"bedrock brief failed, using rules: {e!r}")
    return {"text": rule_brief(areas), "source": "rules"}
