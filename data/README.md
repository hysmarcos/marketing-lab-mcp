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

## Marketing mix model results

File: `mmm_results.json` (about 140 KB). Used by the `budget_simulate` and `budget_optimize` tools.

- **Source:** the `marketing-mix-model` project, <https://github.com/hysmarcos/marketing-mix-model>,
  file `site/data/resultados.json` at commit `d570d33`. It is a Bayesian marketing mix model
  (PyMC-Marketing) fitted on Meta Robyn's simulated demo dataset (`dt_simulated_weekly`).
- **License:** MIT, from [Robyn](https://github.com/facebookexperimental/Robyn) (the demo data) and
  the source project. The data is simulated, so it describes no real business.
- **What it contains:** `meta` (13-week horizon, adstock length 8, 200 posterior draws),
  `history` (the last weeks of real spend per channel, needed for the carry-over effect),
  `channels` and `channel_labels` (tv, ooh, print, facebook, search), `scales`, `draws`
  (posterior draws of the saturation and carry-over parameters per channel and of the weekly
  baseline), `spend_max_weekly` (the highest weekly spend seen per channel), and `plans` (the
  current plan, about $41,100 per week, and the optimum the source project found). The file also
  carries fields the tools do not read (contributions, ROI, holdout, diagnostics, headline).
- **Fixed snapshot:** the file is copied as is and is not rebuilt here. To update it, copy the file
  again from the source project and say which commit it came from. `tests/fixtures/simulator_cases.json`
  (a reduced results object plus four plans with the values the Python model gives) is copied from
  the same commit; the tests use it to check that the TypeScript port matches Python.
