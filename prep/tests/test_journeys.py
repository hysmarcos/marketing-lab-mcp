import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE = ROOT / "data" / "journeys_sample.json"
CHANNELS = {"display", "paid_social", "paid_search", "email", "organic_search", "direct"}


@pytest.fixture(scope="module")
def sample() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def last_touch_shares(sample: dict) -> dict[str, float]:
    credit = dict.fromkeys(sample["channels"], 0)
    for j in sample["journeys"]:
        credit[j["path"][-1]] += j["conversions"]
    total = sum(credit.values())
    return {c: v / total for c, v in credit.items()}


def test_sample_has_the_documented_shape(sample):
    assert sample["source"] == "simulated, seed 42"
    assert set(sample["channels"]) == CHANNELS and len(sample["channels"]) == 6
    assert set(sample["truth"]) == CHANNELS
    for j in sample["journeys"]:
        assert 1 <= len(j["path"]) <= 8 and set(j["path"]) <= CHANNELS
        assert j["conversions"] >= 0 and j["nulls"] >= 0 and j["conversions"] + j["nulls"] >= 1


def test_paths_are_unique(sample):
    paths = [tuple(j["path"]) for j in sample["journeys"]]
    assert len(paths) == len(set(paths))


def test_users_total_20000(sample):
    assert sum(j["conversions"] + j["nulls"] for j in sample["journeys"]) == 20000


def test_conversion_rate_is_realistic(sample):
    conversions = sum(j["conversions"] for j in sample["journeys"])
    assert 0.08 <= conversions / 20000 <= 0.25


def test_truth_shares_are_proper_shares(sample):
    shares = sample["truth"].values()
    assert all(0 < s < 1 for s in shares)
    assert abs(sum(shares) - 1) < 1e-9


def test_display_is_undervalued_by_last_touch(sample):
    assert sample["truth"]["display"] > last_touch_shares(sample)["display"]


def test_direct_is_overvalued_by_last_touch(sample):
    assert last_touch_shares(sample)["direct"] > sample["truth"]["direct"]
