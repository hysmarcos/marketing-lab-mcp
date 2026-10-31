"""Downloads the raw datasets into .cache/raw/ (gitignored). Raw files are never committed.

Usage from other prep modules: `path = fetch("hillstrom")`.
"""

import gzip
import hashlib
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / ".cache" / "raw"
TIMEOUT_SECONDS = 120

# name -> (file name in .cache/raw/, primary URL)
SOURCES = {
    "hillstrom": (
        "hillstrom.csv",
        "http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv",
    ),
    # Kaggle answers GET with a 302 to a signed URL (HEAD returns 404); urllib follows it.
    "olist": (
        "olist.zip",
        "https://www.kaggle.com/api/v1/datasets/download/olistbr/brazilian-ecommerce",
    ),
    "olist_funnel": (
        "olist_funnel.zip",
        "https://www.kaggle.com/api/v1/datasets/download/olistbr/marketing-funnel-olist",
    ),
}

# Used when the primary host fails: (URL, md5 of the gzip file).
FALLBACKS = {
    "hillstrom": (
        "https://hillstorm1.s3.us-east-2.amazonaws.com/hillstorm_no_indices.csv.gz",
        "a68a81291f53a14f4e29002629803ba3",
    ),
}


def _download(url: str, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "marketing-lab-prep/0.1"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response, tmp.open("wb") as f:
        shutil.copyfileobj(response, f)
    tmp.replace(dest)


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _fetch_fallback(name: str, dest: Path) -> None:
    url, expected_md5 = FALLBACKS[name]
    gz_path = dest.with_name(dest.name + ".gz")
    _download(url, gz_path)
    try:
        if _md5(gz_path) != expected_md5:
            raise RuntimeError(f"checksum mismatch for the fallback mirror of {name}")
        with gzip.open(gz_path, "rb") as src, dest.open("wb") as out:
            shutil.copyfileobj(src, out)
    finally:
        gz_path.unlink(missing_ok=True)


def fetch(name: str) -> Path:
    """Returns the local path of dataset `name`, downloading it if it is not cached."""
    if name not in SOURCES:
        raise KeyError(f"unknown dataset {name!r}; known: {', '.join(sorted(SOURCES))}")
    filename, url = SOURCES[name]
    dest = RAW_DIR / filename
    if dest.exists():
        return dest
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _download(url, dest)
    except Exception as error:  # network, HTTP or TLS failure
        if name not in FALLBACKS:
            raise
        print(f"primary source failed ({error}); trying the fallback mirror")
        _fetch_fallback(name, dest)
    return dest
