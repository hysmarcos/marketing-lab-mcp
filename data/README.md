# Data summaries

This folder holds the small JSON files the tools read at run time. The raw datasets are never
committed: `prep/` downloads them to `.cache/raw/` (ignored by git), turns them into the summaries
here, and the server only ever reads the summaries. To rebuild a file you need
[uv](https://docs.astral.sh/uv/) and an internet connection; the download is cached after the first
run.

## Hillstrom e-mail experiment

File: `hillstrom_cells.json` (about 12 KB). Used by the `email_test_analyze` tool.

- **Source:** Kevin Hillstrom, "MineThatData E-Mail Analytics And Data Mining Challenge", 2008.
  <http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv>
  (if that host is down, `prep/download.py` falls back to a public mirror and checks its checksum).
- **License:** the dataset states none. The raw rows are not redistributed here. The JSON keeps
  only aggregated counts and sums, and carries a `license_note` that credits the source.
- **Rebuild:** `uv run python -m prep hillstrom`. The same command also writes
  `tests/fixtures/email_reference.json`, the scipy/statsmodels reference values used by the tests.
- **What the summary keeps:** 64,000 customers were split at random into three arms: `mens`
  (men's merchandise e-mail), `womens` and `control` (no e-mail). For each arm there is one cell
  per value of `overall`, `history_segment`, `zip_code`, `channel`, `newbie` (`new` or `existing`),
  `mens` and `womens` (`bought` or `not_bought` before). Each cell stores `n` (customers), `visits`,
  `conversions`, `spend_sum` and `spend_sq_sum` (sum of squared spend). The two spend sums are
  enough to compute the mean and the sample variance, so the server can run a Welch t-test without
  any customer row. `Surburban` in the raw file is corrected to `Suburban`.
