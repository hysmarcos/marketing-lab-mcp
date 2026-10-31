import gzip
import hashlib

import pytest

from prep import download


def _fake_download(content: bytes):
    def fake(url, dest):
        dest.write_bytes(content)

    return fake


def test_fallback_writes_through_a_part_file(tmp_path, monkeypatch):
    payload = gzip.compress(b"a,b\n1,2\n")
    monkeypatch.setitem(
        download.FALLBACKS, "hillstrom", ("http://x", hashlib.md5(payload).hexdigest())
    )
    monkeypatch.setattr(download, "_download", _fake_download(payload))
    dest = tmp_path / "hillstrom.csv"
    download._fetch_fallback("hillstrom", dest)
    assert dest.read_bytes() == b"a,b\n1,2\n"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["hillstrom.csv"]


def test_fallback_leaves_no_destination_when_the_gzip_is_corrupt(tmp_path, monkeypatch):
    payload = gzip.compress(b"x" * 10_000)[:-20]  # truncated gzip stream
    monkeypatch.setitem(
        download.FALLBACKS, "hillstrom", ("http://x", hashlib.md5(payload).hexdigest())
    )
    monkeypatch.setattr(download, "_download", _fake_download(payload))
    dest = tmp_path / "hillstrom.csv"
    with pytest.raises((EOFError, OSError)):
        download._fetch_fallback("hillstrom", dest)
    assert list(tmp_path.iterdir()) == []
