import gzip
import hashlib
import json
from pathlib import Path

import pytest

from prep import download

ROOT = Path(__file__).resolve().parent.parent.parent
CELLS = ROOT / "data" / "hillstrom_cells.json"
EMAIL_REFERENCE = ROOT / "tests" / "fixtures" / "email_reference.json"
ARMS = {"mens", "womens", "control"}
DIMENSIONS = {"overall", "history_segment", "zip_code", "channel", "newbie", "mens", "womens"}


@pytest.fixture(scope="module")
def summary() -> dict:
    return json.loads(CELLS.read_text(encoding="utf-8"))


def cells(summary: dict, dimension: str) -> list[dict]:
    return [c for c in summary["cells"] if c["dimension"] == dimension]


def test_has_source_and_license_note(summary):
    assert "Hillstrom" in summary["source"]
    assert "aggregated" in summary["source"].lower()
    assert "Kevin Hillstrom" in summary["license_note"]
    assert "2008" in summary["license_note"]


def test_cells_have_the_documented_shape(summary):
    keys = {"arm", "dimension", "value", "n", "visits", "conversions", "spend_sum", "spend_sq_sum"}
    for cell in summary["cells"]:
        assert set(cell) == keys
        assert cell["arm"] in ARMS
        assert cell["dimension"] in DIMENSIONS
        assert cell["visits"] <= cell["n"]
        assert cell["conversions"] <= cell["visits"]
        assert cell["spend_sq_sum"] >= 0


def test_overall_cells_sum_to_64000_rows_with_a_third_per_arm(summary):
    overall = cells(summary, "overall")
    assert {c["arm"] for c in overall} == ARMS
    assert sum(c["n"] for c in overall) == 64000
    for cell in overall:
        assert cell["value"] == "all"
        assert abs(cell["n"] / 64000 - 1 / 3) < 0.01


@pytest.mark.parametrize("dimension", sorted(DIMENSIONS - {"overall"}))
def test_each_dimension_adds_up_to_the_overall_cell(summary, dimension):
    overall = {c["arm"]: c for c in cells(summary, "overall")}
    for arm in ARMS:
        rows = [c for c in cells(summary, dimension) if c["arm"] == arm]
        assert rows, f"{dimension} has no cells for {arm}"
        for field in ("n", "visits", "conversions"):
            assert sum(c[field] for c in rows) == overall[arm][field]
        assert sum(c["spend_sum"] for c in rows) == pytest.approx(overall[arm]["spend_sum"])
        assert sum(c["spend_sq_sum"] for c in rows) == pytest.approx(overall[arm]["spend_sq_sum"])


def test_no_misspelled_suburban_remains(summary):
    assert "Surburban" not in CELLS.read_text(encoding="utf-8")
    zips = {c["value"] for c in cells(summary, "zip_code")}
    assert zips == {"Rural", "Suburban", "Urban"}


def test_coded_dimensions_use_readable_values(summary):
    assert {c["value"] for c in cells(summary, "newbie")} == {"new", "existing"}
    assert {c["value"] for c in cells(summary, "mens")} == {"bought", "not_bought"}
    assert {c["value"] for c in cells(summary, "womens")} == {"bought", "not_bought"}
    assert {c["value"] for c in cells(summary, "channel")} == {"Phone", "Web", "Multichannel"}
    assert len({c["value"] for c in cells(summary, "history_segment")}) == 7


def test_fixture_exists_with_overall_and_zip_cases():
    ref = json.loads(EMAIL_REFERENCE.read_text(encoding="utf-8"))
    keys = {(c["metric"], c["segment_by"], c["segment"]) for c in ref["cases"]}
    assert ("conversion", None, "all") in keys
    assert ("spend", None, "all") in keys
    for zip_code in ("Rural", "Suburban", "Urban"):
        assert ("conversion", "zip_code", zip_code) in keys
        assert ("spend", "zip_code", zip_code) in keys


@pytest.mark.raw
def test_cells_match_the_raw_rows(summary):
    import pandas as pd

    raw = pd.read_csv(download.fetch("hillstrom"))
    assert len(raw) == 64000
    arm = {"Mens E-Mail": "mens", "Womens E-Mail": "womens", "No E-Mail": "control"}
    for name, group in raw.groupby("segment"):
        cell = next(c for c in cells(summary, "overall") if c["arm"] == arm[name])
        assert cell["n"] == len(group)
        assert cell["visits"] == group["visit"].sum()
        assert cell["conversions"] == group["conversion"].sum()
        assert cell["spend_sum"] == pytest.approx(group["spend"].sum())
        assert cell["spend_sq_sum"] == pytest.approx((group["spend"] ** 2).sum())


def test_fetch_uses_the_fallback_mirror_when_the_primary_fails(tmp_path, monkeypatch):
    csv = b"recency,segment\n1,No E-Mail\n"
    gz = gzip.compress(csv)
    monkeypatch.setattr(download, "RAW_DIR", tmp_path)
    monkeypatch.setitem(
        download.FALLBACKS,
        "hillstrom",
        ("https://mirror.example/h.csv.gz", hashlib.md5(gz).hexdigest()),
    )

    def fake_download(url: str, dest: Path) -> None:
        if url.startswith("http://www.minethatdata.com"):
            raise OSError("primary down")
        dest.write_bytes(gz)

    monkeypatch.setattr(download, "_download", fake_download)
    path = download.fetch("hillstrom")
    assert path.read_bytes() == csv
    assert not list(tmp_path.glob("*.gz"))
    assert download.fetch("hillstrom") == path  # cached: no second download


def test_fetch_rejects_a_corrupt_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(download, "RAW_DIR", tmp_path)

    def fake_download(url: str, dest: Path) -> None:
        if url.startswith("http://www.minethatdata.com"):
            raise OSError("primary down")
        dest.write_bytes(gzip.compress(b"tampered"))

    monkeypatch.setattr(download, "_download", fake_download)
    with pytest.raises(RuntimeError, match="checksum"):
        download.fetch("hillstrom")
    assert not (tmp_path / "hillstrom.csv").exists()
