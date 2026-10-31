"""Simulates customer journeys with a known ground truth for attribution models.

Writes data/journeys_sample.json: 20,000 simulated users (numpy seed 42), aggregated by unique
channel path, plus the true share of each channel. No raw data is involved; the file is fully
reproducible from this script.

Random draw order (one generator, so changing the order or the size of any draw changes every
value after it): path lengths (`users` Poisson draws), first touch (`users` draws), middle touches
(`users` x 8 uniform draws, one per position, even for positions a path never reaches), last touch
(`users` draws, made for every user, even for paths of one touch), and finally the conversion
outcome (`users` uniform draws).

Run with: uv run python -m prep journeys
"""

import json
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "journeys_sample.json"

SEED = 42
USERS = 20_000
MAX_LENGTH = 8
SOURCE = "simulated, seed 42"

CHANNELS = ["display", "paid_social", "paid_search", "email", "organic_search", "direct"]
FIRST_TOUCH = {
    "display": 0.35,
    "paid_social": 0.30,
    "paid_search": 0.15,
    "organic_search": 0.15,
    "email": 0.03,
    "direct": 0.02,
}
LAST_TOUCH = {
    "direct": 0.35,
    "email": 0.25,
    "organic_search": 0.20,
    "paid_search": 0.15,
    "paid_social": 0.03,
    "display": 0.02,
}
# Chance that a user converts is 1 - BASE * prod(1 - EFFECT[c]) over the channels they touched.
BASE = 0.99
EFFECT = {
    "display": 0.06,
    "paid_social": 0.05,
    "paid_search": 0.04,
    "email": 0.03,
    "organic_search": 0.02,
    "direct": 0.005,
}


def simulate(users: int = USERS, seed: int = SEED) -> dict:
    rng = np.random.default_rng(seed)
    first_p = np.array([FIRST_TOUCH[c] for c in CHANNELS])
    last_p = np.array([LAST_TOUCH[c] for c in CHANNELS])
    effect = np.array([EFFECT[c] for c in CHANNELS])

    lengths = np.minimum(1 + rng.poisson(2, users), MAX_LENGTH)
    paths = np.full((users, MAX_LENGTH), -1, dtype=int)
    paths[:, 0] = rng.choice(len(CHANNELS), size=users, p=first_p)
    middle = rng.integers(0, len(CHANNELS), size=(users, MAX_LENGTH))
    last = rng.choice(len(CHANNELS), size=users, p=last_p)
    for position in range(1, MAX_LENGTH):
        in_path = lengths > position
        is_last = lengths == position + 1
        paths[in_path, position] = middle[in_path, position]
        paths[is_last, position] = last[is_last]

    touched = np.zeros((users, len(CHANNELS)), dtype=bool)
    for position in range(MAX_LENGTH):
        rows = np.flatnonzero(paths[:, position] >= 0)
        touched[rows, paths[rows, position]] = True

    survive = np.where(touched, 1 - effect, 1.0)
    p_convert = 1 - BASE * survive.prod(axis=1)
    # Counterfactual: the same user with channel c taken out of the path.
    lift = np.zeros(len(CHANNELS))
    for j in range(len(CHANNELS)):
        without = np.delete(survive, j, axis=1).prod(axis=1)
        p_without = 1 - BASE * without
        lift[j] = (p_convert - p_without).sum()
    truth = lift / lift.sum()

    converted = rng.random(users) < p_convert
    counts: dict[tuple[str, ...], list[int]] = {}
    for i in range(users):
        path = tuple(CHANNELS[c] for c in paths[i, : lengths[i]])
        entry = counts.setdefault(path, [0, 0])
        entry[0 if converted[i] else 1] += 1
    journeys = [
        {"path": list(path), "conversions": c, "nulls": n}
        for path, (c, n) in sorted(counts.items(), key=lambda kv: (len(kv[0]), kv[0]))
    ]
    return {
        "source": SOURCE,
        "channels": CHANNELS,
        "truth": {c: round(float(truth[j]), 12) for j, c in enumerate(CHANNELS)},
        "journeys": journeys,
    }


def main() -> None:
    payload = simulate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, separators=(",", ":")) + "\n")
    conversions = sum(j["conversions"] for j in payload["journeys"])
    lengths = Counter(len(j["path"]) for j in payload["journeys"])
    print(
        f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(payload['journeys'])} paths, "
        f"{conversions} conversions, paths by length {dict(sorted(lengths.items()))})"
    )


if __name__ == "__main__":
    main()
